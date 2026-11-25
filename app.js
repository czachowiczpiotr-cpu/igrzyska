import { makeApi } from './api.js?v=10';

const api = await makeApi();
const S = {
  data: { profiles: [], categories: [], rounds: [], duels: [], predictions: [] },
  user: null, me: null, admin: false, loading: true,
  route: (location.hash.slice(2) || 'arena'), modal: null, draft: null, catFilter: 'all', dirty: false,
};
const app = document.getElementById('app');

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = (id) => S.data.profiles.find((p) => p.id === id);
const C = (id) => S.data.categories.find((c) => c.id === id);
const R = (id) => S.data.rounds.find((r) => r.id === id);
const D = (id) => S.data.duels.find((d) => d.id === id);
const nm = (p) => (p ? p.nickname || p.full_name : 'TBA');
// Bez maila: login z nazwy -> techniczny adres (nigdy nie dostaje poczty, potwierdzanie maili jest wyłączone).
const LOGIN_DOMAIN = 'gracz.igrzyska.example.com';
const slug = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
const toEmail = (id) => { id = id.trim(); if (id.includes('@')) return id.toLowerCase(); const s = slug(id); if (!s) throw new Error('Wpisz nazwę albo e-mail.'); return `${s}@${LOGIN_DOMAIN}`; };
const loginName = (email = '') => (email.endsWith('@' + LOGIN_DOMAIN) ? email.split('@')[0] : email);
const sub = (p) => (p?.nickname ? p.full_name : '');
const canTipOn = (d) => d && d.status !== 'done' && !d.tips_locked && d.p1 && d.p2;
function tipRanking() {
  const pts = {};
  S.data.predictions.forEach((pr) => {
    const d = D(pr.duel_id); const o = (pts[pr.user_id] ||= { hit: 0, all: 0 });
    if (d?.status === 'done' && d.winner) { o.all++; if (d.winner === pr.pick) o.hit++; }
  });
  return Object.entries(pts).map(([id, o]) => ({ p: P(id), ...o })).filter((r) => r.p && r.all).sort((a, b) => b.hit - a.hit || a.all - b.all);
}
const hue = (id = '') => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (p) => (p ? (p.nickname || p.full_name).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '?');
const av = (p, cls = '') => `<span class="av ${cls}" style="--h:${p ? hue(p.id) : 0}">${p ? esc(initials(p)) : '?'}</span>`;
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rounds = () => [...S.data.rounds].sort((a, b) => (!!a.bracket - !!b.bracket) || a.ord - b.ord || a.created_at.localeCompare(b.created_at));
const duelsOf = (rid) => S.data.duels.filter((d) => d.round_id === rid).sort((a, b) => a.ord - b.ord);
const players = () => S.data.profiles.filter((p) => p.is_player);
const isBye = (d) => !!d.p1 !== !!d.p2;
const loserOf = (d) => (d.status === 'done' && d.winner && d.p1 && d.p2 ? (d.winner === d.p1 ? d.p2 : d.p1) : null);
const usedCatIds = () => new Set(S.data.duels.map((d) => d.category_id).filter(Boolean));
const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many}`;
const predsOf = (did) => S.data.predictions.filter((p) => p.duel_id === did);

function record(pid) {
  let w = 0, l = 0;
  S.data.duels.forEach((d) => { if (d.status !== 'done' || isBye(d)) return; if (d.winner === pid) w++; else if (d.p1 === pid || d.p2 === pid) l++; });
  return { w, l };
}
function champion() {
  const rs = rounds(); if (!rs.length) return null;
  const ds = duelsOf(rs[rs.length - 1].id);
  return ds.length === 1 && ds[0].status === 'done' && !isBye(ds[0]) ? ds[0].winner : null;
}
function status(pid) {
  if (champion() === pid) return 'champ';
  const rs = rounds();
  for (let i = rs.length - 1; i >= 0; i--) {
    const d = duelsOf(rs[i].id).find((x) => x.p1 === pid || x.p2 === pid);
    if (d) return loserOf(d) === pid ? (i === 0 && !rs[0].bracket && bracketHasSpace() ? 'baraz' : 'out') : 'in';
  }
  return 'in';
}
// czy w 1. rundzie drabinki są jeszcze wolne miejsca (przegrani z 1. rundy mogą wrócić)
function bracketHasSpace() {
  const f = rounds().find((r) => r.bracket); if (!f) return true;
  return duelsOf(f.id).some((d) => !d.p1 || !d.p2);
}
const isPow2 = (n) => n >= 1 && (n & (n - 1)) === 0;
const bracketName = (duels) => (duels === 1 ? 'Finał' : duels === 2 ? 'Półfinały' : duels === 4 ? 'Ćwierćfinały' : duels === 8 ? '1/8 finału' : `Runda ${S.data.rounds.length + 1}`);
const bracketRounds = () => rounds().filter((r) => r.bracket);
// następna runda drabinki: gdy ostatnia runda drabinki jest skończona i ma ≥2 walki
function nextBracket() {
  const br = bracketRounds(); const last = br[br.length - 1]; if (!last) return null;
  const ds = duelsOf(last.id); if (ds.length < 2 || ds.some((d) => d.status !== 'done' || !d.winner)) return null;
  if (rounds().some((r) => rounds().indexOf(r) > rounds().indexOf(last) && r.bracket)) return null;
  const w = ds.map((d) => d.winner); const pairs = [];
  for (let i = 0; i < w.length; i += 2) pairs.push([w[i], w[i + 1] || null, null]);
  return { from: last, pairs, name: bracketName(pairs.length) };
}

function nextDuel() {
  const all = rounds().flatMap((r) => duelsOf(r.id));
  return all.find((d) => d.status === 'live') || all.find((d) => d.status === 'pending' && d.p1 && d.p2) || null;
}

/* ---------- data ---------- */
async function refresh() {
  try {
    S.data = await api.load();
    S.user = await api.session();
    S.admin = S.user ? await api.isAdmin() : false;
    S.me = S.user ? P(S.user.id) || null : null;
    if (S.user && !S.me && S.user.meta?.ig_full_name && !S.creatingProfile) {
      S.creatingProfile = true;
      try { await api.insert('profiles', { id: S.user.id, full_name: S.user.meta.ig_full_name, nickname: S.user.meta.ig_nickname || null }); S.data = await api.load(); S.me = P(S.user.id); } catch (e) { console.warn(e); } finally { S.creatingProfile = false; }
    }
  } catch (e) { toast('Nie udało się wczytać danych: ' + e.message, 'err'); }
  S.loading = false;
  if (S.user && !S.me && !S.modal) S.modal = { type: 'profile-setup' };
  safeRender();
}
function safeRender() {
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest('#app')) { S.dirty = true; return; }
  render();
}
async function act(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); await refresh(); } catch (e) { toast(e.message || String(e), 'err'); }
}

/* ---------- toast ---------- */
let toastT;
function toast(msg, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.className = 'toast show ' + kind; el.textContent = msg;
  clearTimeout(toastT); toastT = setTimeout(() => (el.className = 'toast ' + kind), 2800);
}

/* ---------- views ---------- */
const NAV = [['arena', 'Arena'], ['drabinka', 'Drabinka'], ['zawodnicy', 'Zawodnicy'], ['typy', 'Typy'], ['kategorie', 'Kategorie']];

function header() {
  const nav = [...NAV, ...(S.admin ? [['admin', 'Panel']] : [])];
  return `<header class="top">
    <a class="brand" href="#/arena"><span class="brand-mark">◆</span><span class="brand-word">IGRZYSKA</span></a>
    <nav class="nav">${nav.map(([k, l]) => `<a href="#/${k}" class="${S.route === k ? 'on' : ''}">${l}${k === 'admin' ? ' <i class="dot-admin"></i>' : ''}</a>`).join('')}</nav>
    <div class="who">${S.user
      ? `<a class="chip-me" href="#/profil">${av(S.me, 'sm')}<span>${esc(nm(S.me))}</span></a>`
      : `<button class="btn btn-gold sm" data-act="login">Zaloguj się</button>`}</div>
  </header>${api.mode === 'demo' ? `<div class="demo-bar">Tryb demo — dane zapisują się tylko w tej przeglądarce.</div>` : ''}`;
}

function duelMini(d, labels = []) {
  const a = P(d.p1), b = P(d.p2), c = C(d.category_id);
  const row = (p, pid, score, lab) => {
    const win = d.status === 'done' && d.winner && d.winner === pid, lose = d.status === 'done' && d.winner && pid && d.winner !== pid;
    return `<div class="dm-row ${win ? 'win' : ''} ${lose ? 'lose' : ''}">${av(p, 'xs')}<span class="dm-name">${pid ? esc(nm(p)) : `<em>${isBye(d) && d.status === 'done' ? 'wolny los' : esc(lab || 'do ustalenia')}</em>`}</span>${score ? `<span class="dm-score">${esc(score)}</span>` : ''}${win ? '<span class="crown">♛</span>' : ''}</div>`;
  };
  return `<button class="duel-mini spot ${d.status}" data-act="duel" data-id="${d.id}">
    ${row(a, d.p1, d.score1, labels[0])}${row(b, d.p2, d.score2, labels[1])}
    <div class="dm-foot">${isBye(d) && d.status === 'done' ? '<span class="muted">Awans bez walki</span>' : !d.p1 && !d.p2 ? `<span class="muted">${S.admin ? 'kliknij, żeby wpisać osoby' : 'czeka na zawodników'}</span>` : c ? `<span class="cat-chip">${esc(c.emoji || '•')} ${esc(c.name)}</span>` : '<span class="muted">Kategoria: ?</span>'}
    ${d.status === 'live' ? '<span class="live-tag">TRWA</span>' : d.when_at && d.status === 'pending' ? `<span class="muted">${esc(d.when_at)}</span>` : ''}</div>
  </button>`;
}

function viewArena() {
  const ps = players(), rs = rounds(), ch = champion();
  const alive = ps.filter((p) => status(p.id) !== 'out').length;
  const played = S.data.duels.filter((d) => d.status === 'done' && !isBye(d)).length;
  const unused = S.data.categories.filter((c) => !usedCatIds().has(c.id));
  const nx = nextDuel();
  const allD = rounds().flatMap((r) => duelsOf(r.id));
  const live = allD.filter((d) => d.status === 'live');
  const upcoming = allD.filter((d) => d.status === 'pending' && d.p1 && d.p2).slice(0, 6);
  const recent = allD.filter((d) => d.status === 'done' && d.p1 && d.p2).sort((x, y) => (y.updated_at || '').localeCompare(x.updated_at || '')).slice(0, 4);
  const champ = ch ? P(ch) : null;
  return `
  <section class="hero">
    <div class="hero-grid"></div>
    <p class="eyebrow">Edycja ${new Date().getFullYear()} · ${ps.length || 12} zawodników · 1 korona</p>
    <h1 class="shine">Kto jest<br>najlepszy?</h1>
    <p class="lead">Pojedynki 1 na 1 w losowych kategoriach. Od ciasta po liczbę kroków. Drabinka jak w pucharze: przegrywasz — odpadasz. Prawie zawsze — 2 osoby wrócą do ósemki, ale jak, to na razie tajemnica.</p>
    <div class="stats">
      <div class="stat spot"><b>${alive}<small>/${ps.length}</small></b><span>w grze</span></div>
      <div class="stat spot"><b>${played}</b><span>rozegranych walk</span></div>
      <div class="stat spot"><b>${unused.length}</b><span>kategorii w puli</span></div>
    </div>
  </section>
  ${champ ? finals(champ) : ''}
  ${live.length ? `<section class="block"><div class="block-head"><h2>Trwa teraz <span class="muted">${live.length}</span></h2><a class="btn ghost sm" href="#/drabinka">Drabinka →</a></div><div class="live-grid">${live.map(featured).join('')}</div></section>` : rs.length ? `<section class="block"><div class="block-head"><h2>Trwa teraz</h2><a class="btn ghost sm" href="#/drabinka">Drabinka →</a></div><div class="empty spot"><p class="muted">W tej chwili nie trwa żadna walka.</p></div></section>` : ''}
  ${upcoming.length ? `<section class="block"><div class="block-head"><h2>Następne walki</h2></div><div class="grid duels-open">${upcoming.map((d) => duelMini(d)).join('')}</div></section>` : ''}
  ${recent.length ? `<section class="block"><div class="block-head"><h2>Ostatnie wyniki</h2></div><div class="grid duels-open">${recent.map((d) => duelMini(d)).join('')}</div></section>` : ''}
  ${rs.length ? '' : `<section class="block"><div class="empty spot"><div class="empty-ico">⚔︎</div><h3>Igrzyska jeszcze się nie zaczęły</h3><p class="muted">${ps.length ? `${ps.length} zawodników czeka na 1. rundę.` : 'Najpierw zapiszcie się i poczekajcie, aż admin doda was jako zawodników.'}</p>${S.admin ? `<a class="btn btn-gold" href="#/admin">Ułóż 1. rundę</a>` : ''}</div></section>`}
  ${unused.length ? `<section class="marquee" aria-label="Kategorie w puli"><div class="mq-track">${[...unused, ...unused].map((c) => `<span>${esc(c.emoji || '◆')} ${esc(c.name)}</span>`).join('')}</div></section>` : ''}`;
}

function viewBracketPage() {
  const br = bracketRounds(), r1 = rounds().find((r) => !r.bracket);
  const r1done = r1 && duelsOf(r1.id).length && duelsOf(r1.id).every((d) => d.status === 'done');
  return `${S.admin ? `<div class="admin-strip spot"><span class="dot-admin"></span><span class="muted small">Admin: kliknij dowolną walkę w drabince, żeby wpisać lub zmienić osoby, kategorię i wynik. Zwycięzca sam przechodzi dalej.</span>
      <span class="row-gap">${!br.length ? '<button class="btn btn-gold sm" data-act="bracket-create">Rozrysuj drabinkę (8 osób)</button>' : ''}${r1done ? '<button class="btn ghost sm" data-act="bracket-fill">🎲 Wpisz zwycięzców 1. rundy losowo</button>' : ''}<a class="btn ghost sm" href="#/admin">Rundy dodatkowe / baraże</a></span></div>` : ''}
  ${bracketView()}
  ${elimView()}`;
}

function elimView() {
  const el = rounds().filter((r) => !r.bracket); if (!el.length) return '';
  return `<section class="block">
    <div class="block-head"><h2>Eliminacje</h2><span class="muted small">1. runda i ewentualne rundy dodatkowe</span></div>
    <div class="rounds" id="rounds">${el.map((r) => {
      const ds = duelsOf(r.id), done = ds.filter((d) => d.status === 'done').length;
      return `<div class="round"><div class="round-head"><h3>${esc(r.name)}</h3><span class="pill">${done}/${ds.length}</span></div>${ds.map(duelMini).join('')}</div>`;
    }).join('')}</div>
  </section>`;
}

function bracketView() {
  const br = bracketRounds();
  const first = br.length ? duelsOf(br[0].id).length : 4;
  const cols = []; let n = first, k = 0;
  while (n >= 1) { cols.push({ r: br[k], n }); n = n / 2; k++; if (!isPow2(first)) break; }
  const ghost = (txt1, txt2) => `<div class="duel-mini ghost-card"><div class="dm-row"><span class="av xs ghost-av">?</span><span class="dm-name muted">${txt1}</span></div><div class="dm-row"><span class="av xs ghost-av">?</span><span class="dm-name muted">${txt2}</span></div></div>`;
  const ch = champion() && br.length && duelsOf(br[br.length - 1].id).length === 1 ? P(champion()) : null;
  return `<section class="block">
    <div class="block-head"><h2>Drabinka</h2><span class="muted small">${br.length ? 'puchar — przegrany odpada' : 'ósemka ustali się po 1. rundzie'}</span></div>
    <div class="bracket" id="bracket">${cols.map((c, ci) => {
      const ds = c.r ? duelsOf(c.r.id) : [];
      const labs = (j) => (ci === 0 ? ['Miejsce w ósemce', 'Miejsce w ósemce'] : [`Zwycięzca walki ${2 * j + 1}`, `Zwycięzca walki ${2 * j + 2}`]);
      const slots = Array.from({ length: Math.max(c.n, ds.length) }, (_, j) => ds[j]
        ? duelMini(ds[j], labs(j))
        : ci === 0 ? ghost('Miejsce w ósemce', 'Miejsce w ósemce') : ghost(`Zwycięzca walki ${2 * j + 1}`, `Zwycięzca walki ${2 * j + 2}`));
      return `<div class="br-col"><div class="round-head"><h3>${esc(c.r?.name || bracketName(c.n))}</h3>${c.r ? `<span class="pill">${ds.filter((d) => d.status === 'done').length}/${ds.length}</span>` : '<span class="pill">wkrótce</span>'}</div><div class="br-cards">${slots.map((h) => `<div class="br-slot">${h}</div>`).join('')}</div></div>`;
    }).join('')}
    <div class="br-col trophy-col"><div class="round-head"><h3>Mistrz</h3></div><div class="br-cards"><div class="br-slot"><div class="trophy spot ${ch ? 'won' : ''}">${ch ? `${av(ch, 'md')}<b>${esc(nm(ch))}</b>` : '<span class="trophy-ico">🏆</span><span class="muted small">kto zgarnie koronę?</span>'}</div></div></div></div>
    </div>
  </section>`;
}

function finals(champ) {
  const top = tipRanking()[0];
  return `<section class="finals">
    <div class="champ spot"><div class="champ-glow"></div><span class="eyebrow">Mistrz Igrzysk</span>${av(champ, 'xl')}<h2>${esc(nm(champ))}</h2><p class="muted">Najlepszy z najlepszych · ${plural(record(champ.id).w, 'wygrana', 'wygrane', 'wygranych')}</p></div>
    ${top ? `<div class="champ spot alt"><div class="champ-glow"></div><span class="eyebrow">Mistrz Typowania</span>${av(top.p, 'xl')}<h2>${esc(nm(top.p))}</h2><p class="muted">${top.hit} z ${top.all} trafionych typów</p></div>` : ''}
  </section>`;
}

function featured(d) {
  const a = P(d.p1), b = P(d.p2), c = C(d.category_id), r = R(d.round_id);
  return `<section class="featured spot ${d.status}" data-act="duel" data-id="${d.id}" role="button" tabindex="0">
    <div class="ft-top"><span class="eyebrow">${d.status === 'live' ? '<span class="live-tag">TRWA</span>' : 'Następny pojedynek'} · ${esc(r?.name || '')}</span>${d.when_at ? `<span class="muted">${esc(d.when_at)}</span>` : ''}</div>
    <div class="vs">
      <div class="vs-side">${av(a, 'lg')}<b>${esc(nm(a))}</b><small>${esc(sub(a))}</small></div>
      <div class="vs-mid"><span>VS</span></div>
      <div class="vs-side">${av(b, 'lg')}<b>${esc(nm(b))}</b><small>${esc(sub(b))}</small></div>
    </div>
    <div class="ft-cat">${c ? `<span class="cat-big">${esc(c.emoji || '◆')}</span><span><b>${esc(c.name)}</b>${c.description ? `<small>${esc(c.description)}</small>` : ''}</span>` : '<span class="muted">Kategoria zostanie wylosowana</span>'}</div>
  </section>`;
}

function viewPlayers() {
  const ps = players().map((p) => ({ p, s: status(p.id), r: record(p.id) }))
    .sort((a, b) => (a.s === 'champ' ? -1 : 0) - (b.s === 'champ' ? -1 : 0) || (a.s === 'out') - (b.s === 'out') || b.r.w - a.r.w || nm(a.p).localeCompare(nm(b.p)));
  const fans = S.data.profiles.filter((p) => !p.is_player);
  const badge = { champ: '<span class="badge gold">♛ Mistrz</span>', in: '<span class="badge green">W grze</span>', baraz: '<span class="badge gold">Może wrócić</span>', out: '<span class="badge">Odpadł(a)</span>' };
  return `<section class="block">
    <div class="block-head"><h2>Zawodnicy <span class="muted">${ps.length}</span></h2></div>
    ${ps.length ? `<div class="grid players">${ps.map(({ p, s, r }) => `<div class="pcard spot ${s}">${av(p, 'md')}<div class="pc-txt"><b>${esc(nm(p))}</b>${sub(p) ? `<small>${esc(sub(p))}</small>` : ''}</div><div class="pc-side">${badge[s]}<span class="wl">${r.w}–${r.l}</span></div></div>`).join('')}</div>`
    : `<div class="empty spot"><h3>Brak zawodników</h3><p class="muted">Admin oznacza, kto bierze udział, w panelu.</p></div>`}
    ${S.user && S.me && !S.me.is_player ? `<p class="hint">Jesteś na liście kibiców. Zawodników dodają admini.</p>` : ''}
    ${fans.length ? `<h3 class="sub-h">Kibice</h3><div class="fans">${fans.map((p) => `<span class="fan">${av(p, 'xs')}${esc(nm(p))}</span>`).join('')}</div>` : ''}
  </section>`;
}

function viewCategories() {
  const used = usedCatIds();
  const f = S.catFilter;
  const list = S.data.categories.filter((c) => (f === 'all' ? true : f === 'free' ? !used.has(c.id) : used.has(c.id))).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const usedIn = (cid) => S.data.duels.filter((d) => d.category_id === cid);
  return `<section class="block">
    <div class="block-head"><h2>Kategorie <span class="muted">${S.data.categories.length}</span></h2>
      ${S.admin ? `<div class="row-gap"><button class="btn ghost sm" data-act="cat-bulk">Wklej listę</button><button class="btn btn-gold sm" data-act="cat-new">+ Dodaj</button></div>` : ''}</div>
    <div class="seg">${[['all', 'Wszystkie'], ['free', 'Do wylosowania'], ['used', 'Rozegrane']].map(([k, l]) => `<button class="${f === k ? 'on' : ''}" data-act="cat-filter" data-f="${k}">${l}</button>`).join('')}</div>
    ${list.length ? `<div class="grid cats">${list.map((c) => {
      const ds = usedIn(c.id);
      return `<${S.admin ? 'button' : 'div'} class="ccard spot ${ds.length ? 'used' : ''}" ${S.admin ? `data-act="cat-edit" data-id="${c.id}"` : ''}>
        <span class="cc-emoji">${esc(c.emoji || '◆')}</span><b>${esc(c.name)}</b>${c.description ? `<p>${esc(c.description)}</p>` : ''}
        <span class="cc-foot">${ds.length ? ds.map((d) => `${esc(nm(P(d.p1)))} vs ${esc(nm(P(d.p2)))}`).join(' · ') : 'Czeka w puli'}</span>
      </${S.admin ? 'button' : 'div'}>`;
    }).join('')}</div>`
    : `<div class="empty spot"><h3>${S.data.categories.length ? 'Nic tu nie ma' : 'Kategorie są tajne… na razie'}</h3><p class="muted">${S.admin ? 'Dodaj je przyciskiem wyżej albo wklej całą listę.' : 'Zna je tylko pomysłodawca. Pojawią się tutaj.'}</p></div>`}
  </section>`;
}

function viewTips() {
  const rows = tipRanking();
  const open = rounds().flatMap((r) => duelsOf(r.id)).filter(canTipOn);
  return `<section class="block">
    <div class="block-head"><h2>Typy</h2></div>
    <p class="lead small">Przed każdym pojedynkiem obstaw, kto wygra. 1 punkt za trafienie. Typowanie zamykają moderatorzy (albo samo, gdy walka się skończy). Na koniec igrzysk obok Mistrza Igrzysk ogłaszamy też Mistrza Typowania.</p>
    ${rows.length ? `<div class="typer-lead spot">${av(rows[0].p, 'md')}<div><span class="eyebrow">${champion() ? 'Mistrz Typowania' : 'Prowadzi w typowaniu'}</span><b>${esc(nm(rows[0].p))}</b></div><b class="tl-pts">${rows[0].hit} pkt</b></div>` : ''}
    ${open.length ? `<h3 class="sub-h">Do obstawienia</h3><div class="grid duels-open">${open.map((d) => {
      const mine = S.user && predsOf(d.id).find((p) => p.user_id === S.user.id);
      return `<button class="open-tip spot" data-act="duel" data-id="${d.id}">${av(P(d.p1), 'xs')}<b>${esc(nm(P(d.p1)))}</b><span class="muted">vs</span><b>${esc(nm(P(d.p2)))}</b>${av(P(d.p2), 'xs')}<span class="ot-state ${mine ? 'done' : ''}">${mine ? '✓ ' + esc(nm(P(mine.pick))) : 'Typuj →'}</span></button>`;
    }).join('')}</div>` : ''}
    <h3 class="sub-h">Ranking typerów</h3>
    ${rows.length ? `<ol class="rank">${rows.map((r, i) => `<li class="spot ${S.user?.id === r.p.id ? 'me' : ''}"><span class="rk">${i + 1}</span>${av(r.p, 'sm')}<span class="rn">${esc(nm(r.p))}</span><span class="muted">${r.hit}/${r.all}</span><b>${r.hit} pkt</b></li>`).join('')}</ol>`
    : `<div class="empty spot"><p class="muted">Ranking pojawi się po pierwszym rozstrzygniętym pojedynku.</p></div>`}
  </section>`;
}

function viewProfile() {
  if (!S.user) return `<section class="block"><div class="empty spot"><h3>Nie jesteś zalogowany</h3><button class="btn btn-gold" data-act="login">Zaloguj się</button></div></section>`;
  const p = S.me || {};
  return `<section class="block narrow">
    <div class="block-head"><h2>Profil</h2></div>
    <div class="profile-card spot">${av(S.me, 'lg')}<div><b>${esc(nm(S.me))}</b><small class="muted">Logujesz się: ${S.user.email.endsWith('@' + LOGIN_DOMAIN) ? 'nazwą „' + esc(loginName(S.user.email)) + '”' : 'mailem ' + esc(S.user.email)}</small>${S.admin ? '<span class="badge gold">Admin</span>' : ''}${p.is_player ? '<span class="badge green">Zawodnik</span>' : '<span class="badge">Kibic</span>'}</div></div>
    <form class="form" data-form="profile">
      <label>Nazwa<input name="full_name" required maxlength="40" value="${esc(nm(S.me) === 'TBA' ? '' : nm(S.me))}"></label>
      <button class="btn btn-gold">Zapisz</button>
    </form>
    <form class="form" data-form="password"><label>Nowe hasło<input name="password" type="password" minlength="6" required autocomplete="new-password"></label><button class="btn ghost">Zmień hasło</button></form>
    <button class="btn ghost danger" data-act="logout">Wyloguj się</button>
  </section>`;
}

/* ---------- admin ---------- */
function poolFor(source) {
  if (source === 'all') return players().map((p) => p.id);
  if (source === 'alive') return players().filter((p) => status(p.id) === 'in').map((p) => p.id);
  const [k, rid] = source.split(':');
  const ds = duelsOf(rid);
  return k === 'w' ? ds.filter((d) => d.status === 'done' && d.winner).map((d) => d.winner) : ds.map(loserOf).filter(Boolean);
}
function suggestName(source, n) {
  if (source.startsWith('l:')) return 'Runda dodatkowa';
  const pairs = Math.ceil(n / 2);
  if (isPow2(n) && n >= 2) return bracketName(n / 2);
  return S.data.rounds.length ? `Runda dodatkowa ${S.data.rounds.filter((r) => !r.bracket).length}` : 'Runda 1';
}
function defaultSource() {
  const rs = rounds(); const last = rs[rs.length - 1];
  return last ? 'alive' : 'all';
}
function ensureDraft() {
  if (S.draft) return S.draft;
  const source = defaultSource();
  const pool = new Set(poolFor(source));
  return (S.draft = { source, pool, name: suggestName(source, pool.size), named: false, randomCats: true, start: 'live', pairs: null, bracket: null });
}

function viewAdmin() {
  if (!S.admin) return `<section class="block"><div class="empty spot"><h3>Tylko dla adminów</h3></div></section>`;
  const dr = ensureDraft(), rs = rounds(), nb = nextBracket();
  if (!dr.custom && !dr.pairs && !dr.srcTouched) dr.source = defaultSource();
  if (!dr.custom && !dr.pairs) { dr.pool = new Set(poolFor(dr.source)); if (!dr.named) dr.name = suggestName(dr.source, dr.pool.size); }
  const isBr = dr.bracket ?? (!bracketRounds().length && isPow2(dr.pool.size) && dr.pool.size >= 2 && !dr.source.startsWith('l:'));
  const sources = [['alive', 'Wszyscy, którzy są jeszcze w grze'], ['all', 'Wszyscy zawodnicy'], ...rs.flatMap((r) => [['w:' + r.id, `Zwycięzcy: ${r.name}`], ['l:' + r.id, `Przegrani: ${r.name}`]])];
  const people = [...S.data.profiles].sort((a, b) => b.is_player - a.is_player || nm(a).localeCompare(nm(b), 'pl'));
  return `<section class="block">
    <div class="block-head"><h2>Panel admina</h2></div>
    <div class="admin-grid">
    <div class="panel spot">
      <h3>🎲 Nowa runda</h3>
      ${nb ? `<div class="next-br"><div><b>${esc(nb.name)} wg drabinki</b><span class="muted small">${nb.pairs.map((p) => `${esc(nm(P(p[0])))} vs ${esc(nm(P(p[1])))}`).join(' · ')}</span></div><button class="btn btn-gold sm" data-act="draft-bracket">Przygotuj →</button></div>` : ''}
      <p class="muted small fmt">Format: drabinka (puchar), przegrany odpada. Tu układacie 1. rundę i ewentualne rundy dodatkowe/baraże. Po 1. rundzie zwycięzcy same wpiszą się losowo do drabinki; 2 wolne miejsca uzupełniacie w zakładce Drabinka (kliknij walkę) — ręcznie albo po barażu.</p>
      <label class="lbl">Kto wchodzi do rundy<select data-act="draft-source">${sources.map(([v, l]) => `<option value="${v}" ${dr.source === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <div class="pool">${players().map((p) => `<label class="pool-item ${dr.pool.has(p.id) ? 'on' : ''} st-${status(p.id)}" title="${{ in: 'w grze', baraz: 'może wrócić', out: 'odpadł(a)', champ: 'mistrz' }[status(p.id)]}"><input type="checkbox" data-act="draft-pool" value="${p.id}" ${dr.pool.has(p.id) ? 'checked' : ''}>${av(p, 'xs')}${esc(nm(p))}</label>`).join('') || '<p class="muted">Najpierw oznacz zawodników w liście „Ludzie”.</p>'}</div>
      <p class="muted small">${plural(dr.pool.size, 'osoba', 'osoby', 'osób')} → ${plural(Math.floor(dr.pool.size / 2), 'pojedynek', 'pojedynki', 'pojedynków')}${dr.pool.size % 2 ? ' + 1 wolny los' : ''}</p>
      ${!bracketRounds().length && rs.length && !isPow2(dr.pool.size) && dr.pool.size < 8 && !dr.source.startsWith('l:') ? `<p class="small warn">Do pełnej ósemki brakuje ${8 - dr.pool.size}. Kliknij osoby oznaczone ↺ (mogą wrócić), żeby je dobrać.</p>` : ''}
      <label class="check"><input type="checkbox" data-act="draft-br" ${isBr ? 'checked' : ''}> Runda drabinki (ćwierćfinały, półfinały, finał)</label>
      <label class="lbl">Nazwa rundy<input data-act="draft-name" value="${esc(dr.name)}" maxlength="40"></label>
      <label class="check"><input type="checkbox" data-act="draft-cats" ${dr.randomCats ? 'checked' : ''}> Od razu losuj kategorie (można też później)</label>
      <label class="lbl">Start walk<select data-act="draft-start"><option value="live" ${dr.start !== 'pending' ? 'selected' : ''}>Wszystkie trwają od razu (równolegle)</option><option value="pending" ${dr.start === 'pending' ? 'selected' : ''}>Czekają — startujemy ręcznie</option></select></label>
      <div class="row-gap">${rs.length
        ? `<button class="btn btn-gold" data-act="draft-roll" ${dr.pool.size < 2 ? 'disabled' : ''}>${dr.pairs ? 'Losuj ponownie' : '🎲 Losuj pary'}</button><button class="btn ghost" data-act="draft-manual">Ułóż ręcznie</button>`
        : `<button class="btn ${dr.pairs ? 'ghost' : 'btn-gold'}" data-act="draft-manual">✍︎ Ułóż pary ręcznie</button><button class="btn ghost" data-act="draft-roll" ${dr.pool.size < 2 ? 'disabled' : ''}>🎲 Losuj</button>`}${dr.pairs ? `<button class="btn btn-gold" data-act="draft-save">Zatwierdź rundę ✓</button>` : ''}</div>
      ${!rs.length && !dr.pairs ? '<p class="muted small mt-s">Pierwsza runda jest już rozlosowana? Kliknij „Ułóż pary ręcznie” i wybierz w każdej parze, kto z kim gra. Konkurencje możecie dopisać później.</p>' : ''}
      ${dr.pairs ? (dr.rolling
        ? `<div class="pairs rolling">${dr.pairs.map((pr, i) => `<div class="pair"><span class="pn">${i + 1}</span>${av(P(pr[0]), 'xs')}<b>${esc(nm(P(pr[0])))}</b><span class="muted">vs</span>${pr[1] ? `<b>${esc(nm(P(pr[1])))}</b>${av(P(pr[1]), 'xs')}` : '<em class="muted">wolny los</em>'}</div>`).join('')}</div>`
        : `<p class="muted small mt-s">Możesz poprawić każdą parę i kategorię przed zatwierdzeniem.</p><div class="pairs">${dr.pairs.map((pr, i) => pairEditor(pr, i)).join('')}<button class="btn ghost sm" data-act="pair-add">+ Dodaj parę</button></div>`) : ''}
    </div>
    <div class="panel spot">
      <h3>Rundy</h3>
      ${rs.length ? rs.map((r) => `<div class="adm-row"><b>${esc(r.name)}</b><span class="muted">${plural(duelsOf(r.id).length, 'walka', 'walki', 'walk')}</span><span class="grow"></span><span class="row-gap"><button class="btn ghost xs" data-act="round-cats" data-id="${r.id}" title="Wylosuj kategorie walkom, które jeszcze ich nie mają">🎲 Kategorie</button><button class="btn ghost xs" data-act="round-start" data-id="${r.id}">▶ Start</button><button class="btn ghost xs" data-act="round-add" data-id="${r.id}">+ Walka</button><button class="btn ghost xs" data-act="round-rename" data-id="${r.id}">Nazwa</button><button class="btn ghost xs danger" data-act="round-del" data-id="${r.id}">Usuń</button></span></div>`).join('') : '<p class="muted">Brak rund.</p>'}
      <h3 class="mt">Ludzie <span class="muted">${S.data.profiles.length}</span></h3>
      <p class="muted small">Zaznacz, kto jest zawodnikiem. Reszta to kibice (mogą typować).</p>
      ${people.map((p) => `<div class="adm-row">${av(p, 'xs')}<b>${esc(nm(p))}</b><span class="muted small">${esc(sub(p))}</span><span class="grow"></span><label class="switch"><input type="checkbox" data-act="toggle-player" data-id="${p.id}" ${p.is_player ? 'checked' : ''}><span></span></label><button class="btn ghost xs" data-act="person-rename" data-id="${p.id}" title="Zmień nazwę" aria-label="Zmień nazwę">✎</button><button class="btn ghost xs danger" data-act="person-del" data-id="${p.id}" title="Usuń profil">✕</button></div>`).join('')}
      ${api.mode === 'demo' ? `<h3 class="mt">Demo</h3><div class="row-gap"><button class="btn ghost sm" data-act="demo-seed">Wczytaj przykładowych ludzi i kategorie</button><button class="btn ghost sm danger" data-act="demo-reset">Wyczyść wszystko</button></div>` : ''}
    </div>
    </div>
  </section>`;
}

function pairEditor(pr, i) {
  const used = new Set(S.draft.pairs.flatMap((x, j) => (j === i ? [] : [x[0], x[1]])).filter(Boolean));
  const pOpts = (sel, empty) => `<option value="">${empty}</option>` + players().map((p) => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${used.has(p.id) && sel !== p.id ? '· ' : ''}${esc(nm(p))}</option>`).join('');
  const usedC = new Set([...usedCatIds(), ...S.draft.pairs.filter((x, j) => j !== i).map((x) => x[2]).filter(Boolean)]);
  const cOpts = `<option value="">— kategoria później —</option>` + S.data.categories.filter((c) => !usedC.has(c.id) || c.id === pr[2]).map((c) => `<option value="${c.id}" ${pr[2] === c.id ? 'selected' : ''}>${esc((c.emoji || '') + ' ' + c.name)}</option>`).join('');
  return `<div class="pair edit"><span class="pn">${i + 1}</span><select data-act="pair-sel" data-i="${i}" data-k="0">${pOpts(pr[0], '— wybierz —')}</select><span class="muted">vs</span><select data-act="pair-sel" data-i="${i}" data-k="1">${pOpts(pr[1], '— wolny los —')}</select><select class="pair-cat" data-act="pair-sel" data-i="${i}" data-k="2">${cOpts}</select><button class="btn ghost xs danger" data-act="pair-del" data-i="${i}" aria-label="Usuń parę">✕</button></div>`;
}

/* ---------- modals ---------- */
function modalHtml() {
  const m = S.modal; if (!m) return '';
  let body = '';
  if (m.type === 'login') body = loginModal(m);
  if (m.type === 'profile-setup') body = `<h2>Jeszcze jedno</h2><p class="muted">Jak mamy cię wyświetlać?</p><form class="form" data-form="profile"><label>Nazwa<input name="full_name" required maxlength="40"></label><button class="btn btn-gold">Gotowe</button></form>`;
  if (m.type === 'duel') body = duelModal(D(m.id));
  if (m.type === 'cat') body = catModal(m.id ? C(m.id) : null);
  if (m.type === 'cat-bulk') body = `<h2>Wklej listę kategorii</h2><p class="muted small">Jedna kategoria w linii. Format: <code>emoji Nazwa — opis</code> (emoji i opis opcjonalne).</p><form class="form" data-form="cat-bulk"><textarea name="txt" rows="10" placeholder="🎂 Kto upiecze lepsze ciasto — ocenia jury&#10;👟 Kto zrobi więcej kroków — w ciągu jednego dnia"></textarea><button class="btn btn-gold">Dodaj wszystkie</button></form>`;
  if (m.type === 'newpass') body = `<h2>Ustaw nowe hasło</h2><form class="form" data-form="password"><label>Nowe hasło<input name="password" type="password" minlength="6" required autocomplete="new-password"></label><button class="btn btn-gold">Zapisz</button></form>`;
  if (!body) return '';
  return `<div class="modal-bg" data-act="close-bg"><div class="modal ${m.type === 'duel' ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="x" data-act="close" aria-label="Zamknij">✕</button>${body}</div></div>`;
}

function loginModal(m) {
  const tab = m.tab || 'in';
  return `<div class="seg full">${[['in', 'Logowanie'], ['up', 'Nowe konto']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="login-tab" data-t="${k}">${l}</button>`).join('')}</div>
  ${tab === 'in'
    ? `<form class="form" data-form="signin"><label>Nazwa lub e-mail<input name="email" required autocomplete="username" autocapitalize="none" placeholder="to, co podałeś przy rejestracji"></label><label>Hasło<input name="password" type="password" required autocomplete="current-password"></label><button class="btn btn-gold">Wejdź na arenę</button>${api.mode === 'cloud' ? '<button type="button" class="link" data-act="forgot">Nie pamiętam hasła</button>' : ''}</form>`
    : `<form class="form" data-form="signup"><label>Nazwa <span class="muted">(tak będą cię widzieć inni)</span><input name="full_name" required maxlength="40" autocomplete="nickname" placeholder="np. Kowal"></label><label>E-mail <span class="muted">(opcjonalnie — jeśli podasz, logujesz się mailem i możesz odzyskać hasło)</span><input name="email" type="email" autocomplete="email"></label><label>Hasło <span class="muted">(min. 6 znaków)</span><input name="password" type="password" minlength="6" required autocomplete="new-password"></label><button class="btn btn-gold">Załóż konto</button></form>`}`;
}

function duelModal(d) {
  if (!d) return '<p>Pojedynek usunięty.</p>';
  const a = P(d.p1), b = P(d.p2), c = C(d.category_id), r = R(d.round_id);
  const preds = predsOf(d.id), mine = S.user && preds.find((p) => p.user_id === S.user.id);
  const n1 = preds.filter((p) => p.pick === d.p1).length, n2 = preds.filter((p) => p.pick === d.p2).length, tot = n1 + n2;
  const pct1 = tot ? Math.round((n1 / tot) * 100) : 50;
  const side = (p, pid, score) => `<div class="vs-side ${d.status === 'done' && d.winner === pid ? 'winner' : d.status === 'done' && d.winner ? 'loser' : ''}">${d.status === 'done' && d.winner === pid ? '<span class="crown big">♛</span>' : ''}${av(p, 'lg')}<b>${pid ? esc(nm(p)) : isBye(d) && d.status === 'done' ? 'wolny los' : 'do ustalenia'}</b><small>${esc(sub(p))}</small>${score ? `<span class="score">${esc(score)}</span>` : ''}</div>`;
  const canTip = S.user && canTipOn(d);
  return `<p class="eyebrow">${esc(r?.name || '')} · ${d.status === 'live' ? '<span class="live-tag">TRWA</span>' : d.status === 'done' ? 'Zakończony' : 'Oczekuje'}${d.when_at ? ' · ' + esc(d.when_at) : ''}</p>
  <div class="vs modal-vs">${side(a, d.p1, d.score1)}<div class="vs-mid"><span>VS</span></div>${side(b, d.p2, d.score2)}</div>
  <div class="cat-box" id="cat-box">${c ? `<span class="cat-big">${esc(c.emoji || '◆')}</span><div><b>${esc(c.name)}</b>${c.description ? `<p>${esc(c.description)}</p>` : ''}</div>` : `<span class="cat-big">?</span><div><b>Kategoria jeszcze nie wylosowana</b></div>`}</div>
  ${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}
  ${d.p1 && d.p2 ? `<div class="tips">
    <div class="tips-head"><b>${canTipOn(d) ? 'Kto wygra?' : 'Typy'}</b>${!canTipOn(d) && d.status !== 'done' ? '<span class="muted small">typowanie zamknięte</span>' : ''}<span class="muted small">${plural(tot, 'typ', 'typy', 'typów')}</span></div>
    ${canTip ? `<div class="tip-btns"><button class="btn ${mine?.pick === d.p1 ? 'btn-gold' : 'ghost'}" data-act="tip" data-id="${d.id}" data-pick="${d.p1}">${esc(nm(a))}</button><button class="btn ${mine?.pick === d.p2 ? 'btn-gold' : 'ghost'}" data-act="tip" data-id="${d.id}" data-pick="${d.p2}">${esc(nm(b))}</button></div>` : !S.user && canTipOn(d) ? `<button class="btn ghost full" data-act="login">Zaloguj się, żeby typować</button>` : ''}
    <div class="bar"><span style="width:${pct1}%"></span></div><div class="bar-l"><span>${esc(nm(a))} ${tot ? pct1 + '%' : ''}</span><span>${tot ? 100 - pct1 + '% ' : ''}${esc(nm(b))}</span></div>
  </div>` : ''}
  ${S.admin ? duelAdmin(d) : ''}`;
}

function duelAdmin(d) {
  const opts = (sel) => `<option value="">— brak —</option>` + players().map((p) => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(nm(p))}</option>`).join('');
  const used = usedCatIds();
  const catOpts = `<option value="">— brak —</option>` + [...S.data.categories].sort((x, y) => x.name.localeCompare(y.name, 'pl')).map((c) => `<option value="${c.id}" ${d.category_id === c.id ? 'selected' : ''}>${esc((c.emoji || '') + ' ' + c.name)}${used.has(c.id) && c.id !== d.category_id ? ' (użyta)' : ''}</option>`).join('');
  return `<details class="adm" ${d.status !== 'done' ? 'open' : ''}><summary>Moderacja <i class="dot-admin"></i></summary>
  <form class="form" data-form="duel" data-id="${d.id}">
    <div class="seg full">${[['pending', 'Oczekuje'], ['live', 'Trwa'], ['done', 'Zakończony']].map(([k, l]) => `<label class="${d.status === k ? 'on' : ''}"><input type="radio" name="status" value="${k}" ${d.status === k ? 'checked' : ''}>${l}</label>`).join('')}</div>
    <div class="two"><label>Zawodnik 1<select name="p1">${opts(d.p1)}</select></label><label>Zawodnik 2<select name="p2">${opts(d.p2)}</select></label></div>
    <div class="two"><label>Wynik 1<input name="score1" maxlength="30" value="${esc(d.score1 || '')}" placeholder="np. 12 430 kroków"></label><label>Wynik 2<input name="score2" maxlength="30" value="${esc(d.score2 || '')}"></label></div>
    <label>Zwycięzca<select name="winner"><option value="">— jeszcze nie —</option>${[d.p1, d.p2].filter(Boolean).map((id) => `<option value="${id}" ${d.winner === id ? 'selected' : ''}>${esc(nm(P(id)))}</option>`).join('')}</select></label>
    <div class="two cat-row"><label>Kategoria<select name="category_id" id="cat-sel">${catOpts}</select></label><button type="button" class="btn ghost" data-act="roll-cat">🎲 Losuj</button></div>
    <label>…albo wpisz konkurencję <span class="muted">(np. wylosowaną wcześniej — doda się do listy kategorii)</span><input name="new_cat" maxlength="80" placeholder="np. 🎂 Kto upiecze lepsze ciasto"></label>
    <label class="check"><input type="checkbox" name="tips_locked" ${d.tips_locked ? 'checked' : ''}> Zamknij typowanie</label>
    <label>Kiedy <span class="muted">(dowolny tekst)</span><input name="when_at" maxlength="40" value="${esc(d.when_at || '')}" placeholder="np. sobota 18:00, u Olka"></label>
    <label>Notatka<textarea name="note" rows="2" maxlength="300">${esc(d.note || '')}</textarea></label>
    <div class="row-gap"><button class="btn btn-gold">Zapisz</button><button type="button" class="btn ghost danger" data-act="duel-del" data-id="${d.id}">Usuń pojedynek</button></div>
  </form></details>`;
}

function catModal(c) {
  return `<h2>${c ? 'Edytuj kategorię' : 'Nowa kategoria'}</h2>
  <form class="form" data-form="cat" data-id="${c?.id || ''}">
    <div class="two narrow-first"><label>Emoji<input name="emoji" maxlength="8" value="${esc(c?.emoji || '')}" placeholder="🎂"></label><label>Nazwa<input name="name" required maxlength="80" value="${esc(c?.name || '')}" placeholder="Kto upiecze lepsze ciasto"></label></div>
    <label>Zasady / opis<textarea name="description" rows="3" maxlength="500">${esc(c?.description || '')}</textarea></label>
    <div class="row-gap"><button class="btn btn-gold">Zapisz</button>${c ? `<button type="button" class="btn ghost danger" data-act="cat-del" data-id="${c.id}">Usuń</button>` : ''}</div>
  </form>`;
}

/* ---------- render ---------- */
function render() {
  S.dirty = false;
  const sc = document.getElementById('rounds')?.scrollLeft || 0;
  const sb = document.getElementById('bracket')?.scrollLeft || 0;
  const views = { arena: viewArena, drabinka: viewBracketPage, zawodnicy: viewPlayers, kategorie: viewCategories, typy: viewTips, admin: viewAdmin, profil: viewProfile };
  const v = views[S.route] || viewArena;
  app.innerHTML = header() + `<main>${S.loading ? '<div class="loader"><span></span></div>' : v()}</main><footer class="foot">Igrzyska · zrobione dla ekipy</footer>` + modalHtml();
  const rEl = document.getElementById('rounds'); if (rEl) rEl.scrollLeft = sc;
  const bEl = document.getElementById('bracket'); if (bEl) bEl.scrollLeft = sb;
  document.body.classList.toggle('modal-open', !!S.modal);
}

/* ---------- events ---------- */
window.addEventListener('hashchange', () => { S.route = location.hash.slice(2) || 'arena'; S.modal = null; render(); scrollTo(0, 0); });
document.addEventListener('focusout', () => setTimeout(() => { if (S.dirty && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) render(); }, 50));
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest?.('.spot'); if (!el) return;
  const r = el.getBoundingClientRect(); el.style.setProperty('--x', e.clientX - r.left + 'px'); el.style.setProperty('--y', e.clientY - r.top + 'px');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.modal && S.modal.type !== 'profile-setup') { S.modal = null; render(); }
  if (e.key === 'Enter' && e.target.matches?.('.featured')) e.target.click();
});

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act, id = t.dataset.id;
  if (['draft-pool', 'draft-cats', 'draft-br', 'toggle-player'].includes(a)) return; // obsługa w 'change'
  if (a === 'close-bg' && e.target !== t) return;
  if (a === 'close' || a === 'close-bg') { if (S.modal?.type === 'profile-setup') return; S.modal = null; return render(); }
  if (a === 'login') { S.modal = { type: 'login', tab: 'in' }; return render(); }
  if (a === 'login-tab') { S.modal.tab = t.dataset.t; return render(); }
  if (a === 'duel') { S.modal = { type: 'duel', id }; return render(); }
  if (a === 'cat-filter') { S.catFilter = t.dataset.f; return render(); }
  if (a === 'cat-new') { S.modal = { type: 'cat' }; return render(); }
  if (a === 'cat-edit') { S.modal = { type: 'cat', id }; return render(); }
  if (a === 'cat-bulk') { S.modal = { type: 'cat-bulk' }; return render(); }
  if (a === 'logout') { await api.signOut(); S.modal = null; location.hash = '#/arena'; return refresh(); }
  if (a === 'forgot') {
    const email = app.querySelector('[data-form="signin"] [name="email"]').value.trim();
    if (!email) return toast('Wpisz najpierw e-mail.', 'err');
    if (!email.includes('@')) return toast('Bez maila nie da się odzyskać hasła — napisz do Piotrka lub Olka.', 'err');
    return act(() => api.resetPassword(email), 'Wysłaliśmy link do zmiany hasła.');
  }
  if (a === 'tip') { e.preventDefault(); return act(() => api.upsert('predictions', { duel_id: id, user_id: S.user.id, pick: t.dataset.pick }), 'Typ zapisany'); }
  if (a === 'duel-del') { if (!confirm('Usunąć ten pojedynek?')) return; S.modal = null; return act(() => api.remove('duels', { id }), 'Usunięto'); }
  if (a === 'cat-del') { if (!confirm('Usunąć kategorię?')) return; S.modal = null; return act(() => api.remove('categories', { id }), 'Usunięto'); }
  if (a === 'round-del') { if (!confirm('Usunąć rundę razem ze wszystkimi jej pojedynkami?')) return; S.draft = null; return act(() => api.remove('rounds', { id }), 'Runda usunięta'); }
  if (a === 'round-rename') { const n = prompt('Nowa nazwa rundy', R(id)?.name); if (n?.trim()) act(() => api.update('rounds', { id }, { name: n.trim() })); return; }
  if (a === 'person-rename') {
    const n = prompt(`Nowa nazwa dla „${nm(P(id))}” .\nUwaga: login tej osoby się nie zmienia.`, nm(P(id)));
    if (n == null) return; const v = n.trim().slice(0, 40);
    if (!v) return toast('Nazwa nie może być pusta.', 'err');
    return act(() => api.update('profiles', { id }, { full_name: v, nickname: null }), 'Nazwa zmieniona');
  }
  if (a === 'person-del') { if (!confirm(`Usunąć profil ${nm(P(id))}? (konto logowania zostaje, profil i typy znikną)`)) return; return act(() => api.remove('profiles', { id }), 'Usunięto'); }
  if (a === 'demo-seed') { api.seed(); S.draft = null; return refresh(); }
  if (a === 'demo-reset') { if (!confirm('Wyczyścić całe demo (też konta)?')) return; api.reset(); S.draft = null; S.modal = null; return refresh(); }
  if (a === 'roll-cat') return rollCategory();
  if (a === 'draft-roll') return rollPairs();
  if (a === 'draft-save') return saveDraft();
  if (a === 'bracket-create') return act(() => createBracket(), 'Drabinka rozrysowana');
  if (a === 'bracket-fill') { if (!confirm('Wpisać losowo zwycięzców 1. rundy do ćwierćfinałów? Obecne osoby w ćwierćfinałach zostaną zastąpione.')) return; return act(() => fillBracketFromR1(true), 'Zwycięzcy wpisani do drabinki'); }
  if (a === 'draft-bracket') { const nb = nextBracket(); if (!nb) return; S.draft = { source: 'w:' + nb.from.id, pool: new Set(nb.pairs.flat().filter(Boolean)), name: nb.name, named: true, randomCats: true, start: 'live', pairs: nb.pairs, bracket: true, custom: true, srcTouched: true }; assignCats(S.draft.pairs); return render(); }
  if (a === 'draft-manual') { const dr = ensureDraft(); const ids = [...dr.pool]; const pairs = []; for (let i = 0; i < Math.max(ids.length, 2); i += 2) pairs.push([ids[i] || null, ids[i + 1] || null, null]); if (dr.randomCats) assignCats(pairs); dr.pairs = pairs; return render(); }
  if (a === 'pair-add') { S.draft.pairs.push([null, null, null]); return render(); }
  if (a === 'pair-del') { S.draft.pairs.splice(+t.dataset.i, 1); if (!S.draft.pairs.length) S.draft.pairs = null; return render(); }
  if (a === 'round-cats') {
    const ds = duelsOf(id).filter((d) => d.p1 && d.p2 && !d.category_id); const pool = shuffle(freeCats());
    if (!ds.length) return toast('Wszystkie walki w tej rundzie mają już kategorię.');
    if (!pool.length) return toast('Brak wolnych kategorii — dodaj je w zakładce Kategorie.', 'err');
    return act(async () => { for (const d of ds) { const c = pool.shift(); if (!c) break; await api.update('duels', { id: d.id }, { category_id: c.id }); } }, 'Kategorie wylosowane');
  }
  if (a === 'round-start') { const ds = duelsOf(id).filter((d) => d.status === 'pending' && d.p1 && d.p2); if (!ds.length) return toast('Nie ma walk do startu.'); return act(async () => { for (const d of ds) await api.update('duels', { id: d.id }, { status: 'live' }); }, `Wystartowało: ${ds.length}`); }
  if (a === 'round-add') { try { const [d] = await api.insert('duels', { round_id: id, ord: Math.max(-1, ...duelsOf(id).map((x) => x.ord)) + 1, status: 'pending' }); await refresh(); S.modal = { type: 'duel', id: d.id }; render(); } catch (err) { toast(err.message, 'err'); } return; }
});

document.addEventListener('change', (e) => {
  const t = e.target, a = t.dataset?.act;
  if (a === 'draft-source') { const dr = ensureDraft(); dr.source = t.value; dr.srcTouched = true; dr.custom = false; dr.pool = new Set(poolFor(t.value)); if (!dr.named) dr.name = suggestName(dr.source, dr.pool.size); dr.pairs = null; render(); }
  if (a === 'draft-pool') { const dr = ensureDraft(); dr.custom = true; t.checked ? dr.pool.add(t.value) : dr.pool.delete(t.value); if (!dr.named) dr.name = suggestName(dr.source, dr.pool.size); dr.pairs = null; render(); }
  if (a === 'draft-start') ensureDraft().start = t.value;
  if (a === 'draft-br') { ensureDraft().bracket = t.checked; render(); }
  if (a === 'pair-sel') { S.draft.pairs[+t.dataset.i][+t.dataset.k] = t.value || null; render(); }
  if (a === 'draft-cats') { ensureDraft().randomCats = t.checked; if (S.draft.pairs) assignCats(S.draft.pairs); render(); }
  if (a === 'toggle-player') act(() => api.update('profiles', { id: t.dataset.id }, { is_player: t.checked }), t.checked ? 'Dodano do zawodników' : 'Przeniesiono do kibiców').then(() => { if (S.draft) { S.draft.pool = new Set(poolFor(S.draft.source)); render(); } });
  if (t.closest?.('.seg') && t.type === 'radio') { t.closest('.seg').querySelectorAll('label').forEach((l) => l.classList.toggle('on', l.contains(t))); }
});
document.addEventListener('input', (e) => { if (e.target.dataset?.act === 'draft-name') { const dr = ensureDraft(); dr.name = e.target.value; dr.named = true; } });

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f).entries());
  const btn = f.querySelector('button:not([type="button"])'); if (btn) btn.disabled = true;
  const done = () => { if (btn) btn.disabled = false; };
  const k = f.dataset.form;
  try {
    if (k === 'signin') { try { await api.signIn({ email: toEmail(v.email), password: v.password }); } catch (err) { if (!v.email.includes('@') && /Zły e-mail lub hasło/.test(err.message)) throw new Error('Zła nazwa lub hasło. Jeśli przy rejestracji podałeś maila — zaloguj się mailem.'); throw err; } S.modal = null; toast('Witaj na arenie!'); await refresh(); }
    if (k === 'signup') {
      const name = v.full_name.trim(); if (!name) throw new Error('Wpisz nazwę.');
      const email = v.email.trim() ? v.email.trim().toLowerCase() : toEmail(name);
      let r;
      try { r = await api.signUp({ email, password: v.password, full_name: name, nickname: null }); }
      catch (err) { if (!v.email.trim() && /już konto/.test(err.message)) throw new Error('Ta nazwa jest już zajęta — dopisz coś (np. inicjał) albo zaloguj się.'); throw err; }
      if (!v.email.trim()) toast(`Zapamiętaj: logujesz się nazwą „${name}” i hasłem.`);
      S.modal = null;
      if (v.email.trim() || r.needsConfirm) toast(r.needsConfirm ? 'Sprawdź skrzynkę i kliknij link, żeby aktywować konto.' : 'Konto założone. Witaj!');
      await refresh();
    }
    if (k === 'profile') {
      const row = { full_name: v.full_name.trim(), nickname: null };
      if (!row.full_name) throw new Error('Wpisz nazwę.');
      if (S.me) await api.update('profiles', { id: S.user.id }, row); else await api.insert('profiles', { id: S.user.id, ...row });
      if (S.modal?.type === 'profile-setup') S.modal = null;
      toast('Zapisano'); await refresh();
    }
    if (k === 'password') { await api.setPassword(v.password); S.modal = null; toast('Hasło zmienione'); f.reset(); render(); }
    if (k === 'cat') {
      const row = { emoji: v.emoji.trim() || null, name: v.name.trim(), description: v.description.trim() || null };
      if (f.dataset.id) await api.update('categories', { id: f.dataset.id }, row); else await api.insert('categories', row);
      S.modal = null; toast('Zapisano'); await refresh();
    }
    if (k === 'cat-bulk') {
      const rows = v.txt.split('\n').map((l) => l.trim()).filter(Boolean).map(parseCatLine).filter((r) => r.name);
      if (!rows.length) throw new Error('Pusta lista.');
      await api.insert('categories', rows); S.modal = null; toast(`Dodano ${rows.length} kategorii`); await refresh();
    }
    if (k === 'duel') {
      const n = (x) => x || null;
      const patch = { status: v.status, p1: n(v.p1), p2: n(v.p2), score1: n(v.score1.trim()), score2: n(v.score2.trim()), winner: n(v.winner), category_id: n(v.category_id), when_at: n(v.when_at.trim()), note: n(v.note.trim()), tips_locked: !!v.tips_locked, updated_at: new Date().toISOString() };
      if (patch.winner && ![patch.p1, patch.p2].includes(patch.winner)) patch.winner = null;
      if (v.new_cat?.trim()) {
        const nc = parseCatLine(v.new_cat.trim());
        const ex = S.data.categories.find((c) => c.name.trim().toLowerCase() === nc.name.toLowerCase());
        patch.category_id = ex ? ex.id : (await api.insert('categories', nc))[0].id;
      }
      if (patch.status === 'done' && !patch.winner) throw new Error('Wybierz zwycięzcę, żeby zakończyć pojedynek.');
      const old = { ...D(f.dataset.id) };
      await api.update('duels', { id: f.dataset.id }, patch);
      await advance({ ...old, ...patch }, old);
      S.data = await api.load();
      const r1 = rounds().find((r) => !r.bracket);
      if (r1 && old.round_id === r1.id && duelsOf(r1.id).every((d) => d.status === 'done')) {
        const placed = await fillBracketFromR1(false);
        if (placed) toast(`Koniec 1. rundy — ${placed} zwycięzców wpisanych losowo do drabinki`); else toast('Zapisano');
      } else toast('Zapisano');
      await refresh();
    }
  } catch (err) { toast(err.message || String(err), 'err'); }
  done();
});

function parseCatLine(l) {
  const m = l.match(/^(\p{Extended_Pictographic}[\p{Extended_Pictographic}‍️\p{Emoji_Modifier}]*)?\s*(.+)$/u);
  const emoji = m?.[1] || null; const rest = (m?.[2] || l).trim();
  const [name, ...desc] = rest.split(/\s+[—–-]\s+/);
  return { emoji, name: name.trim().slice(0, 80), description: desc.join(' — ').trim() || null };
}

/* ---------- drabinka ---------- */
async function createBracket(size = 8) {
  const ord0 = Math.max(1000, ...S.data.rounds.map((r) => r.ord)) + 1;
  for (let n = size / 2, k = 0; n >= 1; n /= 2, k++) {
    const [r] = await api.insert('rounds', { name: bracketName(n), ord: ord0 + k, bracket: true });
    await api.insert('duels', Array.from({ length: n }, (_, i) => ({ round_id: r.id, ord: i, status: 'pending' })));
  }
  S.data = await api.load();
}
// Zwycięzcy 1. rundy → losowo do ćwierćfinałów; wolne miejsca rozkładane po różnych walkach.
async function fillBracketFromR1(force) {
  const r1 = rounds().find((r) => !r.bracket); if (!r1) return 0;
  const winners = duelsOf(r1.id).filter((d) => d.status === 'done' && d.winner).map((d) => d.winner);
  if (!bracketRounds().length) await createBracket(8);
  const qf = duelsOf(bracketRounds()[0].id);
  if (!force && qf.some((d) => d.p1 || d.p2)) return 0; // już ktoś wpisany — nie ruszamy
  const w = shuffle(winners); const slots = [];
  qf.forEach((d) => slots.push([d, 'p1']));
  qf.forEach((d) => slots.push([d, 'p2'])); // najpierw po jednym w każdej walce, potem drugie miejsca
  const patches = new Map(qf.map((d) => [d.id, { p1: null, p2: null, winner: null }]));
  slots.slice(0, w.length).forEach(([d, k], i) => (patches.get(d.id)[k] = w[i]));
  for (const d of qf) if (d.status !== 'done') await api.update('duels', { id: d.id }, patches.get(d.id));
  return Math.min(w.length, slots.length);
}
// zwycięzca walki drabinki przechodzi na swoje miejsce w następnej rundzie
async function advance(d, old) {
  const r = R(d.round_id); if (!r?.bracket) return;
  const br = bracketRounds(); const i = br.findIndex((x) => x.id === r.id); const nxt = br[i + 1]; if (!nxt) return;
  const j = duelsOf(r.id).findIndex((x) => x.id === d.id); const t = duelsOf(nxt.id)[Math.floor(j / 2)];
  if (!t || t.status === 'done') return;
  const key = j % 2 === 0 ? 'p1' : 'p2';
  const val = d.status === 'done' ? d.winner : null;
  if (!val && t[key] !== old.winner) return;
  if (t[key] !== val) await api.update('duels', { id: t.id }, { [key]: val });
}

/* ---------- losowania ---------- */
function freeCats(excludeDuel) {
  const used = new Set(S.data.duels.filter((d) => d.id !== excludeDuel).map((d) => d.category_id).filter(Boolean));
  return S.data.categories.filter((c) => !used.has(c.id));
}
function assignCats(pairs) {
  const pool = shuffle(freeCats());
  pairs.forEach((p) => (p[2] = S.draft.randomCats && p[1] ? pool.shift()?.id || null : null));
}
function rollPairs() {
  const dr = ensureDraft(); const ids = [...dr.pool];
  let n = 0; dr.rolling = true;
  const tick = () => {
    const s = shuffle(ids), pairs = [];
    for (let i = 0; i < s.length; i += 2) pairs.push([s[i], s[i + 1] || null, null]);
    assignCats(pairs); dr.pairs = pairs;
    if (++n < 12) { render(); setTimeout(tick, 60 + n * 12); } else { dr.rolling = false; render(); }
  };
  tick();
}
async function saveDraft() {
  const dr = S.draft; if (!dr?.pairs) return;
  if (!dr.name.trim()) return toast('Nadaj nazwę rundy.', 'err');
  if (dr.pairs.some((p) => !p[0])) return toast('W każdej parze wybierz pierwszego zawodnika.', 'err');
  const ids = dr.pairs.flatMap((p) => [p[0], p[1]]).filter(Boolean);
  if (new Set(ids).size !== ids.length) return toast('Ktoś jest w dwóch parach naraz.', 'err');
  try {
    const ord = Math.max(0, ...S.data.rounds.map((r) => r.ord)) + 1;
    const isBr = dr.bracket ?? (!bracketRounds().length && isPow2(ids.length) && ids.length >= 2 && !dr.source.startsWith('l:'));
    const [round] = await api.insert('rounds', isBr ? { name: dr.name.trim(), ord, bracket: true } : { name: dr.name.trim(), ord });
    await api.insert('duels', dr.pairs.map((p, i) => p[1]
      ? { round_id: round.id, ord: i, p1: p[0], p2: p[1], category_id: p[2], status: dr.start === 'pending' ? 'pending' : 'live' }
      : { round_id: round.id, ord: i, p1: p[0], p2: null, status: 'done', winner: p[0], note: 'Wolny los — awans bez walki.' }));
    S.draft = null; toast(`${round.name} gotowa!`); location.hash = '#/arena'; await refresh();
  } catch (e) { toast(e.message, 'err'); }
}
function rollCategory() {
  const d = D(S.modal?.id); const sel = document.getElementById('cat-sel'); const box = document.getElementById('cat-box');
  const pool = freeCats(d?.id); if (!pool.length) return toast('Brak wolnych kategorii.', 'err');
  const pick = pool[Math.floor(Math.random() * pool.length)];
  let n = 0;
  box.classList.add('rolling');
  const tick = () => {
    const c = n < 14 ? pool[Math.floor(Math.random() * pool.length)] : pick;
    box.innerHTML = `<span class="cat-big">${esc(c.emoji || '◆')}</span><div><b>${esc(c.name)}</b>${n >= 14 && c.description ? `<p>${esc(c.description)}</p>` : ''}</div>`;
    if (n++ < 14) setTimeout(tick, 50 + n * 9); else { box.classList.remove('rolling'); sel.value = pick.id; toast('Wylosowano — kliknij Zapisz, żeby zatwierdzić'); }
  };
  tick();
}

/* ---------- start ---------- */
api.onChange(() => refresh());
api.onAuth((ev) => { if (ev === 'PASSWORD_RECOVERY') { S.modal = { type: 'newpass' }; render(); } else if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') refresh(); });
render();
refresh();
