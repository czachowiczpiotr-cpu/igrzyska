// Warstwa danych: Supabase (gdy jest config) albo DEMO w localStorage (te same funkcje).
const TABLES = ['profiles', 'categories', 'rounds', 'duels', 'predictions'];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now());

const tipOpen = (d) => !!d && d.status !== 'done' && !d.tips_locked;
function matches(row, m) { return Object.entries(m).every(([k, v]) => row[k] === v); }

/* ---------------- Supabase ---------------- */
async function cloudApi(cfg) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, storageKey: 'igrzyska.auth' } });
  const t = (name) => sb.from('ig_' + name);
  const ok = ({ data, error }) => { if (error) throw new Error(plError(error.message)); return data; };
  let listeners = [];
  return {
    mode: 'cloud',
    async session() { const { data } = await sb.auth.getSession(); return data.session ? { id: data.session.user.id, email: data.session.user.email, meta: data.session.user.user_metadata || {} } : null; },
    async signUp({ email, password, full_name, nickname }) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { ig_full_name: full_name, ig_nickname: nickname || null }, emailRedirectTo: location.origin + location.pathname } });
      if (error) throw new Error(plError(error.message));
      return { needsConfirm: !data.session };
    },
    async signIn({ email, password }) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw new Error(plError(error.message)); },
    async resetPassword(email) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw new Error(plError(error.message)); },
    async setPassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) throw new Error(plError(error.message)); },
    async signOut() { await sb.auth.signOut(); },
    async isAdmin() { const { data } = await sb.rpc('ig_is_admin'); return !!data; },
    async load() {
      const res = await Promise.all(TABLES.map((n) => t(n).select('*')));
      const out = {}; TABLES.forEach((n, i) => (out[n] = ok(res[i]) || [])); return out;
    },
    async insert(table, rows) { return ok(await t(table).insert(rows).select()); },
    async update(table, m, patch) { let q = t(table).update(patch); for (const [k, v] of Object.entries(m)) q = q.eq(k, v); return ok(await q.select()); },
    async upsert(table, row) { return ok(await t(table).upsert(row).select()); },
    async remove(table, m) { let q = t(table).delete(); for (const [k, v] of Object.entries(m)) q = q.eq(k, v); return ok(await q); },
    onChange(cb) {
      listeners.push(cb);
      if (listeners.length === 1) {
        const ch = sb.channel('igrzyska');
        TABLES.forEach((n) => ch.on('postgres_changes', { event: '*', schema: 'public', table: 'ig_' + n }, () => listeners.forEach((f) => f())));
        ch.subscribe();
      }
    },
    onAuth(cb) { sb.auth.onAuthStateChange((ev) => cb(ev)); },
  };
}

function plError(m) {
  const map = [
    [/Invalid login credentials/i, 'Zły e-mail lub hasło.'],
    [/User already registered/i, 'Ten e-mail ma już konto — zaloguj się.'],
    [/Password should be at least/i, 'Hasło musi mieć min. 6 znaków.'],
    [/Email not confirmed/i, 'Najpierw potwierdź e-mail (link w skrzynce).'],
    [/rate limit/i, 'Za dużo prób, spróbuj za chwilę.'],
    [/row-level security|permission denied/i, 'Brak uprawnień do tej akcji.'],
    [/invalid.*email|Unable to validate email/i, 'Nieprawidłowy e-mail.'],
  ];
  for (const [re, pl] of map) if (re.test(m)) return pl;
  return m;
}

/* ---------------- DEMO (localStorage) ---------------- */
function demoApi() {
  const KEY = 'igrzyska.demo.v1';
  const blank = () => ({ users: [], session: null, admins: [], tables: Object.fromEntries(TABLES.map((n) => [n, []])) });
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || blank(); } catch { return blank(); } };
  let db = read();
  const listeners = [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} setTimeout(() => listeners.forEach((f) => f()), 0); };
  window.addEventListener('storage', (e) => { if (e.key === KEY) { db = read(); listeners.forEach((f) => f()); } });
  const me = () => db.users.find((u) => u.id === db.session);
  const admin = () => { const u = me(); return !!u && db.admins.includes(u.email); };
  const need = (cond) => { if (!cond) throw new Error('Brak uprawnień do tej akcji.'); };
  const canWrite = (table, row) => {
    if (admin()) return true;
    const u = me(); if (!u) return false;
    if (table === 'profiles') return row.id === u.id;
    if (table === 'predictions') return row.user_id === u.id;
    return false;
  };
  const defaults = (table, r) => {
    const base = { ...r };
    if (table !== 'predictions' && !base.id) base.id = uid();
    if (table === 'predictions' && !base.user_id) base.user_id = me()?.id;
    base.created_at = base.created_at || new Date().toISOString();
    if (table === 'duels') Object.assign(base, { status: base.status || 'pending', ord: base.ord ?? 0 });
    if (table === 'profiles') base.is_player = base.is_player ?? false;
    return base;
  };
  const sameKey = (table, a, b) => (table === 'predictions' ? a.duel_id === b.duel_id && a.user_id === b.user_id : a.id === b.id);
  const cascade = (table, row) => {
    const T = db.tables;
    if (table === 'rounds') T.duels.filter((d) => d.round_id === row.id).forEach((d) => cascade('duels', d)), (T.duels = T.duels.filter((d) => d.round_id !== row.id));
    if (table === 'duels') T.predictions = T.predictions.filter((p) => p.duel_id !== row.id);
    if (table === 'categories') T.duels.forEach((d) => d.category_id === row.id && (d.category_id = null));
    if (table === 'profiles') { T.predictions = T.predictions.filter((p) => p.user_id !== row.id && p.pick !== row.id); T.duels.forEach((d) => { ['p1', 'p2', 'winner'].forEach((k) => d[k] === row.id && (d[k] = null)); }); }
  };
  return {
    mode: 'demo',
    async session() { const u = me(); return u ? { id: u.id, email: u.email, meta: u.meta } : null; },
    async signUp({ email, password, full_name, nickname }) {
      email = email.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Nieprawidłowy e-mail.');
      if ((password || '').length < 6) throw new Error('Hasło musi mieć min. 6 znaków.');
      if (db.users.some((u) => u.email === email)) throw new Error('Ten e-mail ma już konto — zaloguj się.');
      const u = { id: uid(), email, password, meta: { ig_full_name: full_name, ig_nickname: nickname || null } };
      db.users.push(u); if (!db.admins.length) db.admins.push(email); db.session = u.id; save();
      return { needsConfirm: false };
    },
    async signIn({ email, password }) {
      const u = db.users.find((x) => x.email === email.trim().toLowerCase() && x.password === password);
      if (!u) throw new Error('Zły e-mail lub hasło.'); db.session = u.id; save();
    },
    async resetPassword() { throw new Error('W trybie demo nie ma wysyłki maili.'); },
    async setPassword(p) { const u = me(); if (u) { u.password = p; save(); } },
    async signOut() { db.session = null; save(); },
    async isAdmin() { return admin(); },
    async load() { db = read(); return JSON.parse(JSON.stringify(db.tables)); },
    async insert(table, rows) {
      rows = (Array.isArray(rows) ? rows : [rows]).map((r) => defaults(table, r));
      rows.forEach((r) => need(canWrite(table, r)));
      if (table === 'profiles') rows.forEach((r) => need(admin() || !r.is_player));
      if (table === 'predictions') rows.forEach((r) => need(tipOpen(db.tables.duels.find((d) => d.id === r.duel_id))));
      db.tables[table].push(...rows); save(); return rows;
    },
    async update(table, m, patch) {
      const hit = db.tables[table].filter((r) => matches(r, m));
      hit.forEach((r) => need(canWrite(table, r)));
      if (table === 'profiles' && 'is_player' in patch) need(admin());
      hit.forEach((r) => Object.assign(r, patch)); save(); return hit;
    },
    async upsert(table, row) {
      const ex = db.tables[table].find((r) => sameKey(table, r, defaults(table, row)));
      if (ex) { need(canWrite(table, ex)); if (table === 'predictions') need(tipOpen(db.tables.duels.find((d) => d.id === ex.duel_id))); Object.assign(ex, row); save(); return [ex]; }
      return this.insert(table, row);
    },
    async remove(table, m) {
      const hit = db.tables[table].filter((r) => matches(r, m));
      hit.forEach((r) => need(canWrite(table, r)));
      hit.forEach((r) => cascade(table, r));
      db.tables[table] = db.tables[table].filter((r) => !matches(r, m)); save();
    },
    onChange(cb) { listeners.push(cb); },
    onAuth() {},
    // tylko demo: przykładowe dane do pooglądania
    seed() {
      const names = [['Adam Nowak', 'Nowy'], ['Paweł Sikora', 'Sikor'], ['Kuba Wiśniewski', 'Kubi'], ['Marta Zielińska', 'Martusia'], ['Bartek Lewandowski', 'Bartas'], ['Zosia Kamińska', 'Zoska'], ['Michał Wójcik', 'Misiek'], ['Natalia Dąbrowska', 'Nati'], ['Kacper Kozłowski', 'Kacz'], ['Ola Jankowska', 'Olka'], ['Filip Mazur', 'Filo'], ['Wiktor Krawczyk', 'Wiktor']];
      const T = db.tables;
      names.forEach(([full_name, nickname]) => { if (!T.profiles.some((p) => p.full_name === full_name)) T.profiles.push(defaults('profiles', { full_name, nickname, is_player: true })); });
      const cats = [['🎂', 'Kto upiecze lepsze ciasto', 'Jury: wszyscy niegrający. Ocena 1–10, liczy się smak i wygląd.'], ['👟', 'Kto zrobi więcej kroków', 'Od 00:00 do 23:59 jednego dnia. Zrzut ekranu z apki zdrowia.'], ['🏀', 'Rzuty za 3', '10 rzutów, kto trafi więcej. Remis = dogrywka po 5.'], ['🧠', 'Quiz wiedzy ogólnej', '20 pytań, Olek prowadzi.'], ['🍝', 'Kto zje szybciej', 'Talerz spaghetti, start na gwizdek.'], ['🎯', 'Rzutki', 'Do 301, podwójne zakończenie.'], ['🧊', 'Kto dłużej utrzyma plank', 'Bez kolan na ziemi. Mierzymy stoperem.'], ['🎤', 'Karaoke', 'Wynik z apki karaoke + głos publiczności.'], ['🃏', 'Poker heads-up', 'Po 1000 żetonów, blindy rosną co 10 min.'], ['🧩', 'Kostka Rubika', 'Kto szybciej ułoży (może być z poradnikiem).'], ['🏃', 'Sprint 100 m', 'Bieżnia na Orliku.'], ['🎮', 'FIFA 1v1', 'Jeden mecz, 6 min połowy.']];
      cats.forEach(([emoji, name, description]) => { if (!T.categories.some((c) => c.name === name)) T.categories.push(defaults('categories', { emoji, name, description })); });
      save();
    },
    reset() { localStorage.removeItem(KEY); db = blank(); save(); },
  };
}

export async function makeApi() {
  const cfg = window.IG_CONFIG || {};
  if (cfg.supabaseUrl && cfg.supabaseKey) return cloudApi(cfg);
  return demoApi();
}
