'use strict';
// Kör servern och spelar hela spel med 2–6 klienter över Socket.IO.
// Kontrollerar också att ingen klient får se andras dolda kort, att fusk nekas och att återanslutning fungerar.
const assert = require('assert');
const { io } = require('socket.io-client');
const { server } = require('../src/server');
const { Game, GameError } = require('../src/game');

// ---- regeltester direkt mot motorn ----
function rig(n) {
  const g = new Game(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'S' + i })));
  // hoppa över inledningsfasen: alla behåller
  for (let r = 0; r < 2; r++) {
    g.act(g.players[g.leader].id, { type: 'exchangeLeader', cardIds: [] });
    for (const pid of Object.keys(g.exchange?.decisions || {})) g.act(pid, { type: 'exchangeOther', discard: false });
  }
  return g;
}
const throwsGame = (fn, msg) => assert.throws(fn, (e) => e instanceof GameError, msg);
{
  const g = rig(3);
  assert.strictEqual(g.phase, 'play');
  const L = g.leader, lp = g.players[L];
  const card = (rank, suit, d = 0) => ({ id: `${suit}${rank}-${d}`, rank, suit });
  // Sätt händer för kontrollerat test (ta korten ur leken så att inga dubbletter uppstår)
  const pool = [...g.deck, ...g.discard, ...g.players.flatMap((p) => p.hand)];
  const take = (id) => { const c = pool.find((x) => x.id === id); return c; };
  const hands = [
    ['S13-0', 'H13-0', 'S2-0', 'S3-0', 'S4-0', 'S5-0'],
    ['D13-0', 'C14-0', 'C14-1', 'D12-0', 'D12-1', 'H2-0'],
    ['C12-0', 'H12-0', 'H3-0', 'H4-0', 'H5-0', 'H6-0'],
  ];
  const used = new Set(hands.flat());
  g.deck = pool.filter((c) => !used.has(c.id)); g.discard = [];
  const seat = (k) => (L + k) % 3;
  hands.forEach((h, k) => { const p = g.players[seat(k)]; p.hand = h.map(take); p.publicIds.clear(); });
  g.checkInvariant();
  const [a, b, c] = [0, 1, 2].map((k) => g.players[seat(k)].id);
  throwsGame(() => g.act(b, { type: 'dump' }), 'fel spelares tur');
  throwsGame(() => g.act(a, { type: 'play', cardIds: ['S13-0', 'S2-0'] }), 'olika valör');
  g.act(a, { type: 'play', cardIds: ['S13-0', 'H13-0'] }); // två kungar
  assert.strictEqual(g.play.count, 2);
  throwsGame(() => g.act(b, { type: 'play', cardIds: ['D12-0', 'D12-1'] }), 'två damer slår inte två kungar');
  throwsGame(() => g.act(b, { type: 'play', cardIds: ['C14-0'] }), 'ett ess räcker inte');
  throwsGame(() => g.act(b, { type: 'play', cardIds: ['D13-0', 'C14-0'] }), 'olika valör');
  g.act(b, { type: 'play', cardIds: ['C14-0', 'C14-1'] }); // två ess tar styret
  assert.strictEqual(g.players[g.leader].id, b);
  assert.strictEqual(g.play.count, null);
  assert.strictEqual(g.play.turnId ?? g.players[g.play.turn].id, b);
  g.act(b, { type: 'play', cardIds: ['D12-0'] }); // ny runda med ett kort
  assert.strictEqual(g.play.count, 1);
  throwsGame(() => g.act(c, { type: 'play', cardIds: ['C12-0', 'H12-0'] }), 'antalet är låst');
  g.act(c, { type: 'dump' }); // c lägger sin lägsta (3)
  assert.ok(!g.players[seat(2)].hand.some((x) => x.id === 'H3-0'), 'lägsta kortet ska läggas');
  g.act(a, { type: 'dump' }); // a lägger 2
  // tillbaka till b utan att någon slog → b behåller styret, ny runda
  assert.strictEqual(g.players[g.leader].id, b);
  assert.strictEqual(g.play.count, null);
  g.act(b, { type: 'play', cardIds: ['D12-1'] });
  g.act(c, { type: 'play', cardIds: ['C12-0'] }); // lika valör räcker
  assert.strictEqual(g.players[g.leader].id, c);
  console.log('OK: regeltester');
}
{ // bytesrunda: den som behöll i runda 1 får inte byta i runda 2
  const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
  const L = g.players[g.leader]; const others = g.players.filter((p) => p !== L);
  g.act(L.id, { type: 'exchangeLeader', cardIds: L.hand.slice(0, 2).map((c) => c.id) });
  throwsGame(() => g.act(others[0].id, { type: 'exchangeOther', discard: true, cardIds: [others[0].hand[0].id] }), 'exakt samma antal');
  g.act(others[0].id, { type: 'exchangeOther', discard: true, cardIds: others[0].hand.slice(0, 2).map((c) => c.id) });
  g.act(others[1].id, { type: 'exchangeOther', discard: false });
  assert.strictEqual(g.exchange.step, 'replace');
  while (g.exchange.round === 1) g.act(Object.keys(g.exchange.offers)[0], { type: 'exchangeReplace', keep: Math.random() < 0.5 });
  g.act(L.id, { type: 'exchangeLeader', cardIds: [] });
  throwsGame(() => g.act(others[1].id, { type: 'exchangeOther', discard: true }), 'låst ute från runda 2');
  g.act(others[0].id, { type: 'exchangeOther', discard: true }); // ledaren slängde 0 → alla sex
  for (let k = 0; k < 6; k++) g.act(others[0].id, { type: 'exchangeReplace', keep: false });
  assert.strictEqual(g.phase, 'play');
  g.players.forEach((p) => assert.strictEqual(p.hand.length, 6));
  console.log('OK: bytesregler');
}

// ---- multiplayer över nätverket ----
const PORT = 3999;
const URL = `http://localhost:${PORT}`;
const emit = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  s.name = name; s.state = null;
  s.on('state', (st) => { s.state = st; checkPrivacy(st); });
  return s;
}
function checkPrivacy(st) {
  if (!st.game) return;
  const json = JSON.stringify({ ...st.game, me: undefined });
  const mine = new Set((st.game.me?.hand || []).map((c) => c.id));
  // inga motståndare får visas med hela händer: bara offentliga kort
  for (const p of st.game.players) {
    assert.ok(!('hand' in p), 'motståndares hand skickades');
    if (p.id !== st.you) for (const c of p.publicCards) assert.ok(!mine.has(c.id));
  }
  if (st.game.phase !== 'finished') assert.ok(!json.includes('"results"'));
}

async function bot(s) {
  const G = s.state.game, me = s.state.you;
  if (!G || G.phase === 'finished') return false;
  const hand = G.me.hand, ex = G.exchange, pl = G.play;
  const act = (a) => emit(s, 'action', a);
  if (ex) {
    if (ex.step === 'leader' && G.leaderId === me) return act({ type: 'exchangeLeader', cardIds: hand.slice(0, Math.floor(Math.random() * 4)).map((c) => c.id) });
    if (ex.step === 'others' && ex.waitingFor.includes(me)) return act({ type: 'exchangeOther', discard: Math.random() < 0.5, cardIds: hand.slice(0, ex.leaderCount).map((c) => c.id) });
    if (ex.step === 'replace' && ex.offers[me]) return act({ type: 'exchangeReplace', keep: Math.random() < 0.5 });
  } else if (pl && pl.turnId === me) {
    if (pl.count === null) return act({ type: 'play', cardIds: [hand[hand.length - 1].id] });
    const ok = hand.filter((c) => c.rank >= pl.combo.rank);
    const groups = {}; ok.forEach((c) => (groups[c.rank] = groups[c.rank] || []).push(c));
    const g = Object.values(groups).find((x) => x.length >= pl.count);
    if (g && Math.random() < 0.6) return act({ type: 'play', cardIds: g.slice(0, pl.count).map((c) => c.id) });
    return act({ type: 'dump' });
  }
  return null;
}

async function run(n) {
  const host = client('Värd');
  await new Promise((r) => host.on('connect', r));
  const res = await emit(host, 'create', { name: 'Värd' });
  assert.ok(res.ok);
  const players = [host];
  for (let i = 1; i < n; i++) {
    const c = client('S' + i);
    await new Promise((r) => c.on('connect', r));
    const j = await emit(c, 'join', { code: res.code.toLowerCase(), name: 'Spelare ' + i });
    assert.ok(j.ok, j.error);
    c.token = j.token; players.push(c);
  }
  await emit(host, 'settings', { maxPlayers: n, multiplier: 5 });
  const extra = client('X'); await new Promise((r) => extra.on('connect', r));
  if (n === 6 || true) { const j = await emit(extra, 'join', { code: res.code, name: 'Sen' }); assert.ok(!j.ok, 'rummet borde vara fullt'); }
  extra.close();
  const early = await emit(host, 'start'); assert.ok(!early.ok, 'start utan att alla är redo');
  for (const c of players.slice(1)) c.emit('ready', true);
  await wait(50);
  const st = await emit(host, 'start'); assert.ok(st.ok, st.error);
  await wait(50);

  let reconnected = false, iters = 0;
  for (;;) {
    if (++iters > 20000) throw new Error('fastnade');
    const G = host.state.game;
    if (G.phase === 'finished') break;
    // återanslut en spelare mitt i spelet
    if (!reconnected && G.phase === 'play' && n > 2) {
      reconnected = true;
      const old = players[1]; old.close();
      const c = client('S1'); await new Promise((r) => c.on('connect', r));
      const j = await emit(c, 'join', { code: res.code, token: old.token });
      assert.ok(j.ok, 'återanslutning misslyckades');
      c.token = old.token; players[1] = c; await wait(30);
      assert.deepStrictEqual(c.state.game.me.hand.length, old.state.game.me.hand.length);
    }
    let any = false;
    for (const p of players) { const r = await bot(p); if (r) { if (!r.ok) throw new Error(r.error); any = true; await wait(2); } }
    if (!any) await wait(10);
  }
  await wait(30);
  const R = host.state.game.results;
  assert.strictEqual(R.length, n);
  R.forEach((r) => assert.strictEqual(r.score, r.value * 5));
  // ny omgång med samma spelare
  const again = await emit(host, 'start'); assert.ok(again.ok, again.error);
  await wait(30);
  assert.strictEqual(host.state.game.phase, 'exchange');
  players.forEach((p) => p.close());
  console.log(`OK: helt spel över nätverket med ${n} spelare (${R.map((r) => r.name + ' ' + r.score).join(', ')})`);
}

server.listen(PORT, async () => {
  try { for (let n = 2; n <= 6; n++) await run(n); process.exit(0); }
  catch (e) { console.error(e); process.exit(1); }
});
