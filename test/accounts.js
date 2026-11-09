'use strict';
// Konton: kör servern mot en falsk Supabase (en liten HTTP-server här i testet) och kontrollerar
// inloggning, val av användarnamn, att namnet syns vid bordet, statistik, radering och keepalive.
const assert = require('assert');
const http = require('http');
const { validateUsername, isOffensive } = require('../src/usernames');

// ---- användarnamn ----
for (const ok of ['Alfred', 'Thora', 'Horatio', 'Fanny', 'Annalisa', 'Mongolia', 'Kaspar', 'Åsa_92', 'kort-haj', 'Ölgubbe']) {
  assert.ok(validateUsername(ok).ok, `${ok} ska vara tillåtet`);
}
for (const bad of ['ab', 'a'.repeat(17), '123', 'hej då', 'emoji😀', 'f1tta', 'Fuuuck', 'KukMan', 'Hora69', 'N1gger', 'xXfuckXx', 'Nazi']) {
  assert.ok(!validateUsername(bad).ok, `${bad} ska nekas`);
}
assert.strictEqual(validateUsername('  Alfred  ').username, 'Alfred');
assert.ok(isOffensive('fitta') && !isOffensive('Kaspar'));
console.log('OK: regler och filter för användarnamn');

// ---- falsk Supabase ----
const PUB = 'sb_publishable_test', SECRET = 'sb_secret_test';
const users = { 'tok-anna': { id: 'u-anna', email: 'anna@example.com' }, 'tok-bo': { id: 'u-bo', email: 'bo@example.com' } };
const db = { profiles: [], owned_decks: [] };
const log = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(data === undefined ? '' : JSON.stringify(data)); };
    const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
    log.push(`${req.method} ${u.pathname}`);
    if (u.pathname === '/auth/v1/user') {
      assert.strictEqual(req.headers.apikey, PUB, 'token verifieras med publishable key');
      return users[auth] ? send(200, users[auth]) : send(401, { msg: 'invalid JWT' });
    }
    // allt annat måste använda den hemliga nyckeln
    if (req.headers.apikey !== SECRET || auth !== SECRET) return send(401, { msg: 'secret key krävs' });
    if (u.pathname.startsWith('/auth/v1/admin/users/')) {
      const id = decodeURIComponent(u.pathname.split('/').pop());
      for (const t of Object.keys(users)) if (users[t].id === id) delete users[t];
      return send(200, {});
    }
    const m = u.pathname.match(/^\/rest\/v1\/(profiles|owned_decks)$/);
    if (!m) return send(404, {});
    const table = db[m[1]];
    const filters = [...u.searchParams].filter(([k, v]) => v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]);
    const match = (row) => filters.every(([k, v]) => String(row[k]) === v);
    if (req.method === 'GET') return send(200, table.filter(match).slice(0, Number(u.searchParams.get('limit')) || undefined));
    if (req.method === 'POST') {
      const row = JSON.parse(body);
      if (m[1] === 'profiles') {
        if (db.profiles.some((p) => p.id === row.id || p.username.toLowerCase() === row.username.toLowerCase())) return send(409, { code: '23505', message: 'duplicate key' });
        const full = { coins: 0, selected_deck: 'classic', chests_opened: 0, pity_counter: 0, games_played: 0, wins: 0, created_at: new Date().toISOString(), ...row };
        db.profiles.push(full); return send(201, [full]);
      }
      if (!db.owned_decks.some((d) => d.user_id === row.user_id && d.deck_id === row.deck_id)) db.owned_decks.push({ unlocked_at: new Date().toISOString(), ...row });
      return send(201);
    }
    if (req.method === 'PATCH') { const patch = JSON.parse(body); table.filter(match).forEach((r) => Object.assign(r, patch)); return send(204); }
    if (req.method === 'DELETE') { db[m[1]] = table.filter((r) => !match(r)); return send(204); }
    send(405, {});
  });
});

const emit = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// enkel spelare: samma strategi som i e2e-testet, men utan extra byten
async function play(s) {
  const G = s.state && s.state.game, me = s.state && s.state.you;
  if (!G || G.phase === 'finished') return null;
  const hand = G.me.hand, ex = G.exchange, pl = G.play;
  const act = (a) => emit(s, 'action', a);
  if (ex) {
    if (ex.step === 'leader' && G.leaderId === me) return act({ type: 'exchangeLeader', cardIds: [] });
    if (ex.step === 'others' && ex.waitingFor.includes(me)) return act({ type: 'exchangeOther', discard: false });
    if (ex.step === 'replace' && ex.offers[me]) return act({ type: 'exchangeReplace', keep: true });
    if (ex.step === 'extra' && ex.waitingFor.includes(me) && !ex.proposal) return act({ type: 'exchangeGo' });
  } else if (pl && pl.turnId === me) {
    if (pl.count === null) return act({ type: 'play', cardIds: [hand[hand.length - 1].id] });
    const ok = hand.filter((c) => c.rank >= pl.combo.rank);
    const groups = {}; ok.forEach((c) => (groups[c.rank] = groups[c.rank] || []).push(c));
    const g = Object.values(groups).find((x) => x.length >= pl.count);
    if (g) return act({ type: 'play', cardIds: g.slice(0, pl.count).map((c) => c.id) });
    if (ok.length >= pl.count) return act({ type: 'play', cardIds: ok.slice(0, pl.count).map((c) => c.id) });
    return act({ type: 'dump' });
  }
  return null;
}

(async () => {
  await new Promise((r) => fake.listen(0, r));
  process.env.SUPABASE_URL = `http://localhost:${fake.address().port}/`;
  process.env.SUPABASE_PUBLISHABLE_KEY = PUB;
  process.env.SUPABASE_SECRET_KEY = SECRET;
  process.env.GURSCH_BOT_DELAY = '3';
  process.env.GURSCH_TIME_SCALE = '0.01';
  const { io } = require('socket.io-client');
  const { server, accounts } = require('../src/server');
  await new Promise((r) => server.listen(0, r));
  const URL = `http://localhost:${server.address().port}`;

  const cfg = await (await fetch(URL + '/config')).json();
  assert.deepStrictEqual(cfg, { auth: true, supabaseUrl: `http://localhost:${fake.address().port}`, publishableKey: PUB });
  assert.ok(!JSON.stringify(cfg).includes(SECRET), 'secret key får aldrig skickas till klienten');
  const priv = await fetch(URL + '/integritet');
  assert.strictEqual(priv.status, 200); assert.ok((await priv.text()).includes('Radera mitt konto'));
  console.log('OK: /config och integritetssidan');

  async function client(token) {
    const s = io(URL, { transports: ['websocket'], forceNew: true, auth: token ? { token } : {} });
    s.state = null; s.account = null;
    s.on('state', (st) => (s.state = st));
    s.on('account', (a) => (s.account = a));
    await new Promise((r) => s.on('connect', r));
    for (let i = 0; i < 100 && !s.account; i++) await wait(5);
    return s;
  }

  // gäst och ogiltig token: spelar som gäst
  const guest = await client(null);
  assert.deepStrictEqual([guest.account.enabled, guest.account.loggedIn, guest.account.needsUsername], [true, false, false]);
  assert.ok(!(await emit(guest, 'setUsername', 'Gästen')).ok, 'gäster kan inte välja användarnamn');
  assert.ok(!(await emit(guest, 'getProfile')).ok);
  const bad = await client('tok-falsk');
  assert.deepStrictEqual([bad.account.loggedIn, bad.account.badToken], [false, true]);
  guest.close(); bad.close();
  console.log('OK: gäster och ogiltig token');

  // första inloggningen: välj användarnamn
  let anna = await client('tok-anna');
  assert.deepStrictEqual([anna.account.loggedIn, anna.account.needsUsername, anna.account.email], [true, true, 'anna@example.com']);
  let r = await emit(anna, 'setUsername', 'f1tta');
  assert.ok(!r.ok && /inte tillåtet/.test(r.error), r.error);
  r = await emit(anna, 'setUsername', 'x');
  assert.ok(!r.ok);
  r = await emit(anna, 'setUsername', 'Anna_K');
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.account.profile.username, 'Anna_K'); assert.ok(!r.account.needsUsername);
  assert.ok(!(await emit(anna, 'setUsername', 'Annan')).ok, 'användarnamnet kan inte bytas');
  assert.deepStrictEqual(db.owned_decks.map((d) => [d.user_id, d.deck_id]), [['u-anna', 'classic']]);

  const bo = await client('tok-bo');
  r = await emit(bo, 'setUsername', 'anna_k');
  assert.ok(!r.ok && /upptaget/.test(r.error), 'unikt oavsett versaler');
  r = await emit(bo, 'setUsername', 'Bosse');
  assert.ok(r.ok, r.error);
  console.log('OK: välja användarnamn (filter, längd, unikt)');

  // ny anslutning: profilen följer med
  anna.close();
  anna = await client('tok-anna');
  assert.strictEqual(anna.account.profile.username, 'Anna_K');

  // namnet vid bordet är användarnamnet, vad man än skriver
  const res = await emit(anna, 'create', { name: 'Låtsasnamn' });
  assert.ok(res.ok, res.error);
  const j = await emit(bo, 'join', { code: res.code, name: 'Någon annan' });
  assert.ok(j.ok, j.error);
  await wait(30);
  assert.deepStrictEqual(anna.state.lobby.players.map((p) => p.name).sort(), ['Anna_K', 'Bosse']);
  console.log('OK: användarnamnet syns vid bordet');

  // spela en omgång: statistiken räknas
  bo.emit('ready', true); await wait(20);
  assert.ok((await emit(anna, 'start')).ok);
  await wait(30);
  anna.emit('animDone'); bo.emit('animDone');
  let iters = 0;
  while (anna.state.game.phase !== 'finished') {
    if (++iters > 20000) throw new Error('fastnade');
    let any = false;
    // en åtgärd i taget så att den andra klienten hinner få nytt läge
    for (const s of [anna, bo]) { const a = await play(s); if (a) { assert.ok(a.ok, a.error); any = true; await wait(2); break; } }
    if (!any) await wait(5);
  }
  await wait(100);
  const results = anna.state.game.results;
  const prof = await emit(anna, 'getProfile');
  assert.ok(prof.ok, prof.error);
  assert.strictEqual(prof.profile.games_played, 1);
  const annaWon = results.find((x) => x.name === 'Anna_K').winner;
  assert.strictEqual(prof.profile.wins, annaWon ? 1 : 0);
  assert.strictEqual(prof.email, 'anna@example.com');
  assert.deepStrictEqual(prof.decks.map((d) => d.deck_id), ['classic']);
  console.log('OK: statistik efter en omgång och Min profil');

  // radera kontot: profil, samling och inloggning försvinner
  r = await emit(bo, 'deleteAccount');
  assert.ok(r.ok, r.error);
  assert.ok(!db.profiles.some((p) => p.id === 'u-bo')); assert.ok(!db.owned_decks.some((d) => d.user_id === 'u-bo'));
  assert.ok(!users['tok-bo'], 'inloggningen raderas hos Supabase');
  assert.ok(log.includes('DELETE /auth/v1/admin/users/u-bo'));
  const boAgain = await client('tok-bo');
  assert.strictEqual(boAgain.account.loggedIn, false, 'raderat konto kan inte logga in med gamla token');
  console.log('OK: radera mitt konto');

  // keepalive
  const before = log.length;
  assert.strictEqual(await accounts.keepAlive(), true);
  assert.deepStrictEqual(log.slice(before), ['GET /rest/v1/profiles']);
  console.log('OK: daglig keepalive mot databasen');

  for (const s of [anna, bo, boAgain]) s.close();
  server.close(); fake.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
