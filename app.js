import { makeApi } from './api.js';

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
const nm = (p) => (p ? p.nickname || p.full_name.split(' ')[0] : 'TBA');
const hue = (id = '') => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (p) => (p ? (p.nickname || p.full_name).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '?');
const av = (p, cls = '') => `<span class="av ${cls}" style="--h:${p ? hue(p.id) : 0}">${p ? esc(initials(p)) : '?'}</span>`;
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rounds = () => [...S.data.rounds].sort((a, b) => a.ord - b.ord || a.created_at.localeCompare(b.created_at));
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
    if (d) return loserOf(d) === pid ? 'out' : 'in';
  }
  return 'in';
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
    if (S.user && !S.me && S.user.meta?.ig_full_name) {
      try { await api.insert('profiles', { id: S.user.id, full_name: S.user.meta.ig_full_name, nickname: S.user.meta.ig_nickname || null }); S.data = await api.load(); S.me = P(S.user.id); } catch (e) { console.warn(e); }
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
const NAV = [['arena', 'Arena'], ['zawodnicy', 'Zawodnicy'], ['kategorie', 'Kategorie'], ['typy', 'Typy']];

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

function duelMini(d) {
  const a = P(d.p1), b = P(d.p2), c = C(d.category_id);
  const row = (p, pid, score) => {
    const win = d.status === 'done' && d.winner && d.winner === pid, lose = d.status === 'done' && d.winner && pid && d.winner !== pid;
    return `<div class="dm-row ${win ? 'win' : ''} ${lose ? 'lose' : ''}">${av(p, 'xs')}<span class="dm-name">${pid ? esc(nm(p)) : '<em>wolny los</em>'}</span>${score ? `<span class="dm-score">${esc(score)}</span>` : ''}${win ? '<span class="crown">♛</span>' : ''}</div>`;
  };
  return `<button class="duel-mini spot ${d.status}" data-act="duel" data-id="${d.id}">
    ${row(a, d.p1, d.score1)}${row(b, d.p2, d.score2)}
    <div class="dm-foot">${isBye(d) ? '<span class="muted">Awans bez walki</span>' : c ? `<span class="cat-chip">${esc(c.emoji || '•')} ${esc(c.name)}</span>` : '<span class="muted">Kategoria: ?</span>'}
    ${d.status === 'live' ? '<span class="live-tag">NA ŻYWO</span>' : d.when_at && d.status === 'pending' ? `<span class="muted">${esc(d.when_at)}</span>` : ''}</div>
  </button>`;
}

function viewArena() {
  const ps = players(), rs = rounds(), ch = champion();
  const alive = ps.filter((p) => status(p.id) !== 'out').length;
  const played = S.data.duels.filter((d) => d.status === 'done' && !isBye(d)).length;
  const unused = S.data.categories.filter((c) => !usedCatIds().has(c.id));
  const nx = nextDuel();
  const champ = ch ? P(ch) : null;
  return `
  <section class="hero">
    <div class="hero-grid"></div>
    <p class="eyebrow">Edycja ${new Date().getFullYear()} · ${ps.length || 12} zawodników · 1 korona</p>
    <h1 class="shine">Kto jest<br>najlepszy?</h1>
    <p class="lead">Pojedynki 1 na 1 w losowych kategoriach. Od ciasta po liczbę kroków. Przegrywasz — odpadasz (chyba że baraż cię uratuje).</p>
    <div class="stats">
      <div class="stat spot"><b>${alive}<small>/${ps.length}</small></b><span>w grze</span></div>
      <div class="stat spot"><b>${played}</b><span>rozegranych walk</span></div>
      <div class="stat spot"><b>${unused.length}</b><span>kategorii w puli</span></div>
    </div>
  </section>
  ${champ ? `<section class="champ spot"><div class="champ-glow"></div><span class="eyebrow">Mistrz Igrzysk</span>${av(champ, 'xl')}<h2>${esc(nm(champ))}</h2><p class="muted">${esc(champ.full_name)} · ${record(champ.id).w} wygranych</p></section>` : ''}
  ${nx ? featured(nx) : ''}
  <section class="block">
    <div class="block-head"><h2>Drabinka</h2>${S.admin ? `<a class="btn ghost sm" href="#/admin">+ Nowa runda</a>` : ''}</div>
    ${rs.length ? `<div class="rounds" id="rounds">${rs.map((r) => {
      const ds = duelsOf(r.id), done = ds.filter((d) => d.status === 'done').length;
      return `<div class="round"><div class="round-head"><h3>${esc(r.name)}</h3><span class="pill">${done}/${ds.length}</span></div>${ds.map(duelMini).join('')}</div>`;
    }).join('')}</div>`
    : `<div class="empty spot"><div class="empty-ico">⚔︎</div><h3>Igrzyska jeszcze się nie zaczęły</h3><p class="muted">${ps.length ? `${ps.length} zawodników czeka na losowanie.` : 'Najpierw zapiszcie się i poczekajcie, aż admin doda was jako zawodników.'}</p>${S.admin ? `<a class="btn btn-gold" href="#/admin">Rozlosuj pierwszą rundę</a>` : ''}</div>`}
  </section>
  ${unused.length ? `<section class="marquee" aria-label="Kategorie w puli"><div class="mq-track">${[...unused, ...unused].map((c) => `<span>${esc(c.emoji || '◆')} ${esc(c.name)}</span>`).join('')}</div></section>` : ''}`;
}

function featured(d) {
  const a = P(d.p1), b = P(d.p2), c = C(d.category_id), r = R(d.round_id);
  return `<section class="featured spot ${d.status}" data-act="duel" data-id="${d.id}" role="button" tabindex="0">
    <div class="ft-top"><span class="eyebrow">${d.status === 'live' ? '<span class="live-tag">NA ŻYWO</span>' : 'Następny pojedynek'} · ${esc(r?.name || '')}</span>${d.when_at ? `<span class="muted">${esc(d.when_at)}</span>` : ''}</div>
    <div class="vs">
      <div class="vs-side">${av(a, 'lg')}<b>${esc(nm(a))}</b><small>${esc(a?.full_name || '')}</small></div>
      <div class="vs-mid"><span>VS</span></div>
      <div class="vs-side">${av(b, 'lg')}<b>${esc(nm(b))}</b><small>${esc(b?.full_name || '')}</small></div>
    </div>
    <div class="ft-cat">${c ? `<span class="cat-big">${esc(c.emoji || '◆')}</span><span><b>${esc(c.name)}</b>${c.description ? `<small>${esc(c.description)}</small>` : ''}</span>` : '<span class="muted">Kategoria zostanie wylosowana</span>'}</div>
  </section>`;
}

function viewPlayers() {
  const ps = players().map((p) => ({ p, s: status(p.id), r: record(p.id) }))
    .sort((a, b) => (a.s === 'champ' ? -1 : 0) - (b.s === 'champ' ? -1 : 0) || (a.s === 'out') - (b.s === 'out') || b.r.w - a.r.w || nm(a.p).localeCompare(nm(b.p)));
  const fans = S.data.profiles.filter((p) => !p.is_player);
  const badge = { champ: '<span class="badge gold">♛ Mistrz</span>', in: '<span class="badge green">W grze</span>', out: '<span class="badge">Odpadł(a)</span>' };
  return `<section class="block">
    <div class="block-head"><h2>Zawodnicy <span class="muted">${ps.length}</span></h2></div>
    ${ps.length ? `<div class="grid players">${ps.map(({ p, s, r }) => `<div class="pcard spot ${s}">${av(p, 'md')}<div class="pc-txt"><b>${esc(nm(p))}</b><small>${esc(p.full_name)}</small></div><div class="pc-side">${badge[s]}<span class="wl">${r.w}–${r.l}</span></div></div>`).join('')}</div>`
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
  const pts = {};
  S.data.predictions.forEach((pr) => {
    const d = D(pr.duel_id); const o = (pts[pr.user_id] ||= { hit: 0, all: 0 });
    if (d?.status === 'done' && d.winner) { o.all++; if (d.winner === pr.pick) o.hit++; }
  });
  const rows = Object.entries(pts).map(([id, o]) => ({ p: P(id), ...o })).filter((r) => r.p).sort((a, b) => b.hit - a.hit || a.all - b.all);
  const open = rounds().flatMap((r) => duelsOf(r.id)).filter((d) => d.status === 'pending' && d.p1 && d.p2);
  return `<section class="block">
    <div class="block-head"><h2>Typy</h2></div>
    <p class="lead small">Przed każdym pojedynkiem obstaw, kto wygra. 1 punkt za trafienie. Typowanie zamyka się, gdy walka startuje.</p>
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
    <div class="profile-card spot">${av(S.me, 'lg')}<div><b>${esc(nm(S.me))}</b><small class="muted">${esc(S.user.email)}</small>${S.admin ? '<span class="badge gold">Admin</span>' : ''}${p.is_player ? '<span class="badge green">Zawodnik</span>' : '<span class="badge">Kibic</span>'}</div></div>
    <form class="form" data-form="profile">
      <label>Imię i nazwisko<input name="full_name" required minlength="2" maxlength="60" value="${esc(p.full_name || '')}"></label>
      <label>Ksywa <span class="muted">(widoczna wszędzie)</span><input name="nickname" maxlength="30" value="${esc(p.nickname || '')}"></label>
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
  if (source.startsWith('l:')) return 'Baraż';
  const pairs = Math.ceil(n / 2);
  return pairs === 1 ? 'Finał' : pairs === 2 ? 'Półfinały' : pairs === 4 && n === 8 ? 'Ćwierćfinały' : `Runda ${S.data.rounds.length + 1}`;
}
function ensureDraft() {
  if (S.draft) return S.draft;
  const rs = rounds(); const last = rs[rs.length - 1];
  const source = last ? 'alive' : 'all';
  const pool = new Set(poolFor(source));
  return (S.draft = { source, pool, name: suggestName(source, pool.size), named: false, randomCats: true, pairs: null });
}

function viewAdmin() {
  if (!S.admin) return `<section class="block"><div class="empty spot"><h3>Tylko dla adminów</h3></div></section>`;
  const dr = ensureDraft(), rs = rounds();
  if (!dr.custom && !dr.pairs) { dr.pool = new Set(poolFor(dr.source)); if (!dr.named) dr.name = suggestName(dr.source, dr.pool.size); }
  const sources = [['alive', 'Wszyscy, którzy są jeszcze w grze'], ['all', 'Wszyscy zawodnicy'], ...rs.flatMap((r) => [['w:' + r.id, `Zwycięzcy: ${r.name}`], ['l:' + r.id, `Przegrani: ${r.name}`]])];
  const people = [...S.data.profiles].sort((a, b) => b.is_player - a.is_player || nm(a).localeCompare(nm(b), 'pl'));
  return `<section class="block">
    <div class="block-head"><h2>Panel admina</h2></div>
    <div class="admin-grid">
    <div class="panel spot">
      <h3>🎲 Nowa runda</h3>
      <label class="lbl">Kto wchodzi do rundy<select data-act="draft-source">${sources.map(([v, l]) => `<option value="${v}" ${dr.source === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <div class="pool">${players().map((p) => `<label class="pool-item ${dr.pool.has(p.id) ? 'on' : ''}"><input type="checkbox" data-act="draft-pool" value="${p.id}" ${dr.pool.has(p.id) ? 'checked' : ''}>${av(p, 'xs')}${esc(nm(p))}</label>`).join('') || '<p class="muted">Najpierw oznacz zawodników w liście „Ludzie”.</p>'}</div>
      <p class="muted small">${plural(dr.pool.size, 'osoba', 'osoby', 'osób')} → ${plural(Math.floor(dr.pool.size / 2), 'pojedynek', 'pojedynki', 'pojedynków')}${dr.pool.size % 2 ? ' + 1 wolny los' : ''}</p>
      <label class="lbl">Nazwa rundy<input data-act="draft-name" value="${esc(dr.name)}" maxlength="40"></label>
      <label class="check"><input type="checkbox" data-act="draft-cats" ${dr.randomCats ? 'checked' : ''}> Od razu losuj kategorie (z nieużytych)</label>
      <div class="row-gap"><button class="btn btn-gold" data-act="draft-roll" ${dr.pool.size < 2 ? 'disabled' : ''}>${dr.pairs ? 'Losuj ponownie' : 'Losuj pary'}</button>${dr.pairs ? `<button class="btn ghost" data-act="draft-save">Zatwierdź rundę ✓</button>` : ''}</div>
      ${dr.pairs ? `<div class="pairs ${dr.rolling ? 'rolling' : ''}">${dr.pairs.map((pr, i) => `<div class="pair"><span class="pn">${i + 1}</span>${av(P(pr[0]), 'xs')}<b>${esc(nm(P(pr[0])))}</b><span class="muted">vs</span>${pr[1] ? `<b>${esc(nm(P(pr[1])))}</b>${av(P(pr[1]), 'xs')}` : '<em class="muted">wolny los</em>'}<span class="pc">${pr[2] ? esc((C(pr[2])?.emoji || '') + ' ' + C(pr[2])?.name) : ''}</span></div>`).join('')}</div>` : ''}
    </div>
    <div class="panel spot">
      <h3>Rundy</h3>
      ${rs.length ? rs.map((r) => `<div class="adm-row"><b>${esc(r.name)}</b><span class="muted">${plural(duelsOf(r.id).length, 'walka', 'walki', 'walk')}</span><span class="grow"></span><button class="btn ghost xs" data-act="round-rename" data-id="${r.id}">Zmień nazwę</button><button class="btn ghost xs danger" data-act="round-del" data-id="${r.id}">Usuń</button></div>`).join('') : '<p class="muted">Brak rund.</p>'}
      <h3 class="mt">Ludzie <span class="muted">${S.data.profiles.length}</span></h3>
      <p class="muted small">Zaznacz, kto jest zawodnikiem. Reszta to kibice (mogą typować).</p>
      ${people.map((p) => `<div class="adm-row">${av(p, 'xs')}<b>${esc(nm(p))}</b><span class="muted small">${esc(p.full_name)}</span><span class="grow"></span><label class="switch"><input type="checkbox" data-act="toggle-player" data-id="${p.id}" ${p.is_player ? 'checked' : ''}><span></span></label><button class="btn ghost xs danger" data-act="person-del" data-id="${p.id}" title="Usuń profil">✕</button></div>`).join('')}
      ${api.mode === 'demo' ? `<h3 class="mt">Demo</h3><div class="row-gap"><button class="btn ghost sm" data-act="demo-seed">Wczytaj przykładowych ludzi i kategorie</button><button class="btn ghost sm danger" data-act="demo-reset">Wyczyść wszystko</button></div>` : ''}
    </div>
    </div>
  </section>`;
}

/* ---------- modals ---------- */
function modalHtml() {
  const m = S.modal; if (!m) return '';
  let body = '';
  if (m.type === 'login') body = loginModal(m);
  if (m.type === 'profile-setup') body = `<h2>Jeszcze jedno</h2><p class="muted">Jak mamy cię wyświetlać?</p><form class="form" data-form="profile"><label>Imię i nazwisko<input name="full_name" required minlength="2" maxlength="60"></label><label>Ksywa<input name="nickname" maxlength="30"></label><button class="btn btn-gold">Gotowe</button></form>`;
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
    ? `<form class="form" data-form="signin"><label>E-mail<input name="email" type="email" required autocomplete="email"></label><label>Hasło<input name="password" type="password" required autocomplete="current-password"></label><button class="btn btn-gold">Wejdź na arenę</button>${api.mode === 'cloud' ? '<button type="button" class="link" data-act="forgot">Nie pamiętam hasła</button>' : ''}</form>`
    : `<form class="form" data-form="signup"><label>Imię i nazwisko<input name="full_name" required minlength="2" maxlength="60" autocomplete="name"></label><label>Ksywa <span class="muted">(opcjonalnie)</span><input name="nickname" maxlength="30"></label><label>E-mail<input name="email" type="email" required autocomplete="email"></label><label>Hasło <span class="muted">(min. 6 znaków)</span><input name="password" type="password" minlength="6" required autocomplete="new-password"></label><button class="btn btn-gold">Załóż konto</button></form>`}`;
}

function duelModal(d) {
  if (!d) return '<p>Pojedynek usunięty.</p>';
  const a = P(d.p1), b = P(d.p2), c = C(d.category_id), r = R(d.round_id);
  const preds = predsOf(d.id), mine = S.user && preds.find((p) => p.user_id === S.user.id);
  const n1 = preds.filter((p) => p.pick === d.p1).length, n2 = preds.filter((p) => p.pick === d.p2).length, tot = n1 + n2;
  const pct1 = tot ? Math.round((n1 / tot) * 100) : 50;
  const side = (p, pid, score) => `<div class="vs-side ${d.status === 'done' && d.winner === pid ? 'winner' : d.status === 'done' && d.winner ? 'loser' : ''}">${d.status === 'done' && d.winner === pid ? '<span class="crown big">♛</span>' : ''}${av(p, 'lg')}<b>${pid ? esc(nm(p)) : 'wolny los'}</b><small>${esc(p?.full_name || '')}</small>${score ? `<span class="score">${esc(score)}</span>` : ''}</div>`;
  const canTip = S.user && d.status === 'pending' && d.p1 && d.p2;
  return `<p class="eyebrow">${esc(r?.name || '')} · ${d.status === 'live' ? '<span class="live-tag">NA ŻYWO</span>' : d.status === 'done' ? 'Zakończony' : 'Oczekuje'}${d.when_at ? ' · ' + esc(d.when_at) : ''}</p>
  <div class="vs modal-vs">${side(a, d.p1, d.score1)}<div class="vs-mid"><span>VS</span></div>${side(b, d.p2, d.score2)}</div>
  <div class="cat-box" id="cat-box">${c ? `<span class="cat-big">${esc(c.emoji || '◆')}</span><div><b>${esc(c.name)}</b>${c.description ? `<p>${esc(c.description)}</p>` : ''}</div>` : `<span class="cat-big">?</span><div><b>Kategoria jeszcze nie wylosowana</b></div>`}</div>
  ${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}
  ${d.p1 && d.p2 ? `<div class="tips">
    <div class="tips-head"><b>${d.status === 'pending' ? 'Kto wygra?' : 'Typy'}</b><span class="muted small">${plural(tot, 'typ', 'typy', 'typów')}</span></div>
    ${canTip ? `<div class="tip-btns"><button class="btn ${mine?.pick === d.p1 ? 'btn-gold' : 'ghost'}" data-act="tip" data-id="${d.id}" data-pick="${d.p1}">${esc(nm(a))}</button><button class="btn ${mine?.pick === d.p2 ? 'btn-gold' : 'ghost'}" data-act="tip" data-id="${d.id}" data-pick="${d.p2}">${esc(nm(b))}</button></div>` : !S.user && d.status === 'pending' ? `<button class="btn ghost full" data-act="login">Zaloguj się, żeby typować</button>` : ''}
    <div class="bar"><span style="width:${pct1}%"></span></div><div class="bar-l"><span>${esc(nm(a))} ${tot ? pct1 + '%' : ''}</span><span>${tot ? 100 - pct1 + '% ' : ''}${esc(nm(b))}</span></div>
  </div>` : ''}
  ${S.admin ? duelAdmin(d) : ''}`;
}

function duelAdmin(d) {
  const opts = (sel) => `<option value="">— brak —</option>` + players().map((p) => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(nm(p))} (${esc(p.full_name)})</option>`).join('');
  const used = usedCatIds();
  const catOpts = `<option value="">— brak —</option>` + [...S.data.categories].sort((x, y) => x.name.localeCompare(y.name, 'pl')).map((c) => `<option value="${c.id}" ${d.category_id === c.id ? 'selected' : ''}>${esc((c.emoji || '') + ' ' + c.name)}${used.has(c.id) && c.id !== d.category_id ? ' (użyta)' : ''}</option>`).join('');
  return `<details class="adm" ${d.status !== 'done' ? 'open' : ''}><summary>Moderacja <i class="dot-admin"></i></summary>
  <form class="form" data-form="duel" data-id="${d.id}">
    <div class="seg full">${[['pending', 'Oczekuje'], ['live', 'Trwa'], ['done', 'Zakończony']].map(([k, l]) => `<label class="${d.status === k ? 'on' : ''}"><input type="radio" name="status" value="${k}" ${d.status === k ? 'checked' : ''}>${l}</label>`).join('')}</div>
    <div class="two"><label>Zawodnik 1<select name="p1">${opts(d.p1)}</select></label><label>Zawodnik 2<select name="p2">${opts(d.p2)}</select></label></div>
    <div class="two"><label>Wynik 1<input name="score1" maxlength="30" value="${esc(d.score1 || '')}" placeholder="np. 12 430 kroków"></label><label>Wynik 2<input name="score2" maxlength="30" value="${esc(d.score2 || '')}"></label></div>
    <label>Zwycięzca<select name="winner"><option value="">— jeszcze nie —</option>${[d.p1, d.p2].filter(Boolean).map((id) => `<option value="${id}" ${d.winner === id ? 'selected' : ''}>${esc(nm(P(id)))}</option>`).join('')}</select></label>
    <div class="two cat-row"><label>Kategoria<select name="category_id" id="cat-sel">${catOpts}</select></label><button type="button" class="btn ghost" data-act="roll-cat">🎲 Losuj</button></div>
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
  const views = { arena: viewArena, zawodnicy: viewPlayers, kategorie: viewCategories, typy: viewTips, admin: viewAdmin, profil: viewProfile };
  const v = views[S.route] || viewArena;
  app.innerHTML = header() + `<main>${S.loading ? '<div class="loader"><span></span></div>' : v()}</main><footer class="foot">Igrzyska · zrobione dla ekipy</footer>` + modalHtml();
  const rEl = document.getElementById('rounds'); if (rEl) rEl.scrollLeft = sc;
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
  if (['draft-pool', 'draft-cats', 'toggle-player'].includes(a)) return; // obsługa w 'change'
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
    return act(() => api.resetPassword(email), 'Wysłaliśmy link do zmiany hasła.');
  }
  if (a === 'tip') { e.preventDefault(); return act(() => api.upsert('predictions', { duel_id: id, user_id: S.user.id, pick: t.dataset.pick }), 'Typ zapisany'); }
  if (a === 'duel-del') { if (!confirm('Usunąć ten pojedynek?')) return; S.modal = null; return act(() => api.remove('duels', { id }), 'Usunięto'); }
  if (a === 'cat-del') { if (!confirm('Usunąć kategorię?')) return; S.modal = null; return act(() => api.remove('categories', { id }), 'Usunięto'); }
  if (a === 'round-del') { if (!confirm('Usunąć rundę razem ze wszystkimi jej pojedynkami?')) return; S.draft = null; return act(() => api.remove('rounds', { id }), 'Runda usunięta'); }
  if (a === 'round-rename') { const n = prompt('Nowa nazwa rundy', R(id)?.name); if (n?.trim()) act(() => api.update('rounds', { id }, { name: n.trim() })); return; }
  if (a === 'person-del') { if (!confirm(`Usunąć profil ${nm(P(id))}? (konto logowania zostaje, profil i typy znikną)`)) return; return act(() => api.remove('profiles', { id }), 'Usunięto'); }
  if (a === 'demo-seed') { api.seed(); S.draft = null; return refresh(); }
  if (a === 'demo-reset') { if (!confirm('Wyczyścić całe demo (też konta)?')) return; api.reset(); S.draft = null; S.modal = null; return refresh(); }
  if (a === 'roll-cat') return rollCategory();
  if (a === 'draft-roll') return rollPairs();
  if (a === 'draft-save') return saveDraft();
});

document.addEventListener('change', (e) => {
  const t = e.target, a = t.dataset?.act;
  if (a === 'draft-source') { const dr = ensureDraft(); dr.source = t.value; dr.custom = false; dr.pool = new Set(poolFor(t.value)); if (!dr.named) dr.name = suggestName(dr.source, dr.pool.size); dr.pairs = null; render(); }
  if (a === 'draft-pool') { const dr = ensureDraft(); dr.custom = true; t.checked ? dr.pool.add(t.value) : dr.pool.delete(t.value); if (!dr.named) dr.name = suggestName(dr.source, dr.pool.size); dr.pairs = null; render(); }
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
    if (k === 'signin') { await api.signIn(v); S.modal = null; toast('Witaj na arenie!'); await refresh(); }
    if (k === 'signup') {
      const r = await api.signUp({ ...v, full_name: v.full_name.trim(), nickname: v.nickname.trim() });
      S.modal = null;
      toast(r.needsConfirm ? 'Sprawdź skrzynkę i kliknij link, żeby aktywować konto.' : 'Konto założone. Witaj!');
      await refresh();
    }
    if (k === 'profile') {
      const row = { full_name: v.full_name.trim(), nickname: v.nickname.trim() || null };
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
      const patch = { status: v.status, p1: n(v.p1), p2: n(v.p2), score1: n(v.score1.trim()), score2: n(v.score2.trim()), winner: n(v.winner), category_id: n(v.category_id), when_at: n(v.when_at.trim()), note: n(v.note.trim()), updated_at: new Date().toISOString() };
      if (patch.winner && ![patch.p1, patch.p2].includes(patch.winner)) patch.winner = null;
      if (patch.status === 'done' && !patch.winner) throw new Error('Wybierz zwycięzcę, żeby zakończyć pojedynek.');
      await api.update('duels', { id: f.dataset.id }, patch); toast('Zapisano'); await refresh();
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
  try {
    const ord = Math.max(0, ...S.data.rounds.map((r) => r.ord)) + 1;
    const [round] = await api.insert('rounds', { name: dr.name.trim(), ord });
    await api.insert('duels', dr.pairs.map((p, i) => p[1]
      ? { round_id: round.id, ord: i, p1: p[0], p2: p[1], category_id: p[2], status: 'pending' }
      : { round_id: round.id, ord: i, p1: p[0], p2: null, status: 'done', winner: p[0], note: 'Wolny los — awans bez walki.' }));
    S.draft = null; toast(`${round.name} rozlosowana!`); location.hash = '#/arena'; await refresh();
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
