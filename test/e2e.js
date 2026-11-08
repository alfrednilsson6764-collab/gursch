'use strict';
// Kör servern och spelar hela spel med 2–6 klienter över Socket.IO.
// Kontrollerar också att ingen klient får se andras dolda kort, att fusk nekas och att återanslutning fungerar.
const assert = require('assert');
process.env.GURSCH_BOT_DELAY = '3'; // snabba bottar i testet
process.env.GURSCH_TIME_SCALE = '0.01'; // 20 s blir 0,2 s i testet
const { io } = require('socket.io-client');
const { server } = require('../src/server');
const { Game, GameError } = require('../src/game');

// ---- regeltester direkt mot motorn ----
const throwsGame = (fn, msg) => assert.throws(fn, (e) => e instanceof GameError, msg);
function skipExchange(g) {
  for (let r = 0; r < 2; r++) {
    g.act(g.players[g.leader].id, { type: 'exchangeLeader', cardIds: [] });
    for (const pid of Object.keys(g.exchange.decisions)) g.act(pid, { type: 'exchangeOther', discard: false });
  }
  assert.strictEqual(g.exchange.step, 'extra');
  for (const p of g.players) g.act(p.id, { type: 'exchangeSatisfied' });
  assert.strictEqual(g.phase, 'play');
}
// Sätter händerna (sittordning från styrspelaren) och lägger resten i leken utan att något kort dupliceras.
function setHands(g, hands) {
  const pool = [...g.deck, ...g.discard, ...g.setAside, ...g.players.flatMap((p) => p.hand)];
  const used = new Set(hands.flat());
  g.deck = pool.filter((c) => !used.has(c.id)); g.discard = []; g.setAside = [];
  const n = g.players.length;
  hands.forEach((h, k) => { const p = g.players[(g.leader + k) % n]; p.hand = h.map((id) => pool.find((c) => c.id === id)); p.publicIds.clear(); });
  g.checkInvariant();
  return hands.map((_, k) => g.players[(g.leader + k) % n].id);
}
{
  const g = new Game([0, 1, 2].map((i) => ({ id: 'p' + i, name: 'S' + i })));
  skipExchange(g);
  const [a, b, c] = setHands(g, [
    ['S7-0', 'H7-0', 'S2-0', 'S3-0', 'S4-0', 'S5-0'],
    ['D10-0', 'C13-0', 'D12-0', 'D12-1', 'H2-0', 'H3-0'],
    ['C8-0', 'H8-0', 'C3-0', 'H4-0', 'H5-0', 'H6-0'],
  ]);
  const sizes = () => g.players.map((p) => p.hand.length);
  throwsGame(() => g.act(b, { type: 'dump' }), 'fel spelares tur');
  throwsGame(() => g.act(a, { type: 'play', cardIds: ['S7-0', 'S2-0'] }), 'start måste vara samma valör');
  g.act(a, { type: 'play', cardIds: ['S7-0', 'H7-0'] }); // två sjuor
  assert.strictEqual(g.play.count, 2);
  throwsGame(() => g.act(b, { type: 'play', cardIds: ['D10-0'] }), 'antalet är låst');
  throwsGame(() => g.act(b, { type: 'play', cardIds: ['D10-0', 'H2-0'] }), 'alla kort måste vara över');
  throwsGame(() => g.act(b, { type: 'dump' }), 'måste lägga över om man kan');
  g.act(b, { type: 'play', cardIds: ['D10-0', 'C13-0'] }); // tia + kung: lägger över, tar inte styret
  assert.strictEqual(g.play.combo.rank, 7, 'sjuorna gäller fortfarande');
  g.act(c, { type: 'play', cardIds: ['C8-0', 'H8-0'] }); // par åttor tar styret
  // rundan är slut (alla har lagt), c startar nästa
  assert.deepStrictEqual(sizes(), [4, 4, 4], 'alla har lika många kort');
  assert.strictEqual(g.players[g.leader].id, c);
  assert.strictEqual(g.play.count, null);
  g.act(c, { type: 'play', cardIds: ['H6-0'] });
  g.act(a, { type: 'dump' }); // a har bara 2–5 och kan inte lägga över
  assert.ok(!g.players.find((p) => p.id === a).hand.some((x) => x.id === 'S2-0'), 'lägsta kortet ska läggas');
  g.act(b, { type: 'play', cardIds: ['D12-0'] }); // b tar styret med en dam, rundan är slut
  assert.deepStrictEqual(sizes(), [3, 3, 3]);
  assert.strictEqual(g.players[g.leader].id, b, 'b tog styret senast och startar');
  // man kan inte gå ut med kort av olika valör
  throwsGame(() => g.act(b, { type: 'play', cardIds: ['D12-1', 'H2-0', 'H3-0'] }), 'gå ut kräver samma valör');
  g.act(b, { type: 'play', cardIds: ['H2-0'] });
  g.act(c, { type: 'play', cardIds: ['C3-0'] }); // c måste slå tvåan
  g.act(a, { type: 'play', cardIds: ['S3-0'] }); // lika valör tar styret
  assert.strictEqual(g.players[g.leader].id, a);
  g.act(a, { type: 'play', cardIds: ['S4-0'] });
  g.act(b, { type: 'play', cardIds: ['D12-1'] });
  g.act(c, { type: 'dump' }); // c har H4, H5 – kan inte slå damen
  assert.deepStrictEqual(sizes(), [1, 1, 1]);
  assert.strictEqual(g.players[g.leader].id, b);
  g.act(b, { type: 'play', cardIds: ['H3-0'] }); // sista kortet = går ut
  assert.strictEqual(g.phase, 'finished');
  const R = Object.fromEntries(g.results.map((r) => [r.playerId, r]));
  // b: 3, a: 5, c: 5 → b vinner, a och c förlorar tillsammans
  assert.deepStrictEqual([R[a].value, R[b].value, R[c].value], [5, 3, 5]);
  assert.ok(R[b].winner && R[b].wentOut && R[a].loser && R[c].loser && !g.isDraw);
  console.log('OK: lägga, lägga över, ta styret, rundan spelas klart och gå ut');
}
{ // rundan fortsätter efter att någon tagit styret; nästa måste slå den nya kombinationen
  const g = new Game([0, 1, 2].map((i) => ({ id: 'p' + i, name: 'S' + i })));
  skipExchange(g);
  const [a, b, c] = setHands(g, [['S5-0', 'S2-0'], ['H9-0', 'H3-0'], ['C10-0', 'C4-0']]);
  g.act(a, { type: 'play', cardIds: ['S5-0'] });
  g.act(b, { type: 'play', cardIds: ['H9-0'] });
  assert.strictEqual(g.play.turn, g.idx(c), 'rundan fortsätter');
  assert.strictEqual(g.play.combo.rank, 9);
  throwsGame(() => g.act(c, { type: 'play', cardIds: ['C4-0'] }), '4 slår inte 9');
  g.act(c, { type: 'play', cardIds: ['C10-0'] });
  assert.strictEqual(g.players[g.leader].id, c, 'den som tog styret senast startar');
  g.act(c, { type: 'play', cardIds: ['C4-0'] }); // sista kortet = går ut
  const R = Object.fromEntries(g.results.map((r) => [r.playerId, r]));
  assert.ok(R[a].winner && R[c].loser && !R[b].winner && !R[b].loser);
  console.log('OK: rundan fortsätter efter att styret tagits');
}
{ // alla lika = oavgjort
  const g = new Game([0, 1].map((i) => ({ id: 'p' + i, name: 'S' + i })));
  skipExchange(g);
  const [a] = setHands(g, [['S5-0'], ['H5-0']]);
  g.act(a, { type: 'play', cardIds: ['S5-0'] });
  assert.ok(g.isDraw && g.results.every((r) => !r.winner && !r.loser));
  console.log('OK: oavgjort');
}
{ // bytesrundor: ersättningskort på en gång, låsning i runda 2, extra byten
  const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
  const L = g.players[g.leader]; const [o1, o2] = g.players.filter((p) => p !== L);
  g.act(L.id, { type: 'exchangeLeader', cardIds: L.hand.slice(0, 2).map((c) => c.id) });
  throwsGame(() => g.act(o1.id, { type: 'exchangeOther', discard: true, cardIds: [o1.hand[0].id] }), 'exakt samma antal');
  g.act(o1.id, { type: 'exchangeOther', discard: true, cardIds: o1.hand.slice(0, 2).map((c) => c.id) });
  g.act(o2.id, { type: 'exchangeOther', discard: false });
  assert.strictEqual(g.exchange.step, 'replace');
  assert.strictEqual(g.exchange.offers[L.id].length, 2, 'alla ersättningskort på en gång');
  assert.ok(!g.exchange.offers[o1.id], 'styrspelaren får sina först, sedan nästa');
  throwsGame(() => g.act(o1.id, { type: 'exchangeReplace', keep: true }), 'inte o1:s tur än');
  g.act(L.id, { type: 'exchangeReplace', keep: false });
  const offered = g.exchange.offers[o1.id].map((c) => c.id);
  g.act(o1.id, { type: 'exchangeReplace', keep: true });
  assert.ok(offered.every((id) => o1.hand.some((c) => c.id === id) && o1.publicIds.has(id)), 'behållna kort syns för alla');
  assert.strictEqual(g.exchange.round, 2);
  g.act(L.id, { type: 'exchangeLeader', cardIds: [] });
  throwsGame(() => g.act(o2.id, { type: 'exchangeOther', discard: true }), 'låst ute från runda 2');
  g.act(o1.id, { type: 'exchangeOther', discard: true }); // styrspelaren slängde 0 → alla sex
  assert.strictEqual(g.exchange.offers[o1.id].length, 6);
  g.act(o1.id, { type: 'exchangeReplace', keep: false });
  // extra byte: o2 frågar om ett kort, alla säger ja
  assert.strictEqual(g.exchange.step, 'extra');
  g.act(o2.id, { type: 'exchangePropose', count: 1 });
  throwsGame(() => g.act(L.id, { type: 'exchangePropose', count: 2 }), 'ett förslag i taget');
  g.act(L.id, { type: 'exchangeVote', yes: true });
  g.act(o1.id, { type: 'exchangeVote', yes: true });
  assert.strictEqual(g.exchange.step, 'extraDiscard');
  for (const p of g.players) g.act(p.id, { type: 'exchangeExtraDiscard', cardIds: [p.hand[5].id] });
  while (g.exchange.step === 'replace') g.act(Object.keys(g.exchange.offers)[0], { type: 'exchangeReplace', keep: Math.random() < 0.5 });
  assert.strictEqual(g.exchange.step, 'extra');
  // den som redan har frågat får inte fråga igen (ingen spam) och räknas som nöjd
  throwsGame(() => g.act(o2.id, { type: 'exchangePropose', count: 1 }), 'bara en fråga per spelare');
  assert.ok(g.exchange.satisfied[o2.id]);
  assert.ok(g.viewFor(o1.id).players.find((p) => p.id === o2.id).asked);
  // nytt förslag, o1 säger nej men kontrar med en egen fråga
  g.act(L.id, { type: 'exchangePropose', count: 3 });
  throwsGame(() => g.act(o1.id, { type: 'exchangeVote', yes: false, counter: 9 }), 'ogiltig kontring');
  assert.strictEqual(g.exchange.proposal.by, L.id, 'ogiltig kontring ändrar inget');
  g.act(o1.id, { type: 'exchangeVote', yes: false, counter: 2 });
  assert.strictEqual(g.phase, 'exchange');
  assert.strictEqual(g.exchange.proposal.by, o1.id);
  assert.strictEqual(g.exchange.proposal.count, 2);
  // L har redan frågat och kan inte kontra, så nej → spelet börjar
  throwsGame(() => g.act(L.id, { type: 'exchangeVote', yes: false, counter: 1 }), 'redan frågat');
  g.act(L.id, { type: 'exchangeVote', yes: false });
  assert.strictEqual(g.phase, 'play');
  g.players.forEach((p) => assert.strictEqual(p.hand.length, 6));
  // när alla har frågat en gång börjar spelet av sig självt
  {
    const h = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    h.asked.add('a'); h.asked.add('b');
    h.phase = 'exchange'; h.startExtra(3);
    assert.strictEqual(h.phase, 'play');
  }
  console.log('OK: bytesregler');
}

{ // poängtavla
  const Tally = require('../src/tally');
  const t = Tally.create();
  const R = (id, score, w, l) => ({ playerId: id, name: id.toUpperCase(), score, winner: !!w, loser: !!l });
  Tally.addRound(t, [R('a', 10, 1), R('b', 30, 0, 1), R('c', 20)]); // c i mitten räknas inte
  Tally.addRound(t, [R('a', 40, 0, 1), R('b', 0, 1), R('c', 40, 0, 1)]); // a och c förlorar tillsammans
  Tally.addRound(t, [R('a', 5), R('b', 5), R('c', 5)]); // oavgjort: inget räknas
  assert.strictEqual(Tally.versus(t, 'a', 'b'), 20 - 40); // +20 i första, -40 i andra
  assert.strictEqual(Tally.versus(t, 'b', 'a'), 20);
  assert.strictEqual(Tally.versus(t, 'a', 'c'), 0, 'mitten och två förlorare räknas inte mot varandra');
  assert.strictEqual(Tally.versus(t, 'b', 'c'), 40);
  const T = Object.fromEntries(Tally.totals(t).map((x) => [x.playerId, x]));
  assert.deepStrictEqual([T.a.net, T.b.net, T.c.net], [-20, 60, -40]);
  assert.ok(Tally.summaryText(t).includes('A\t-20') && Tally.summaryText(t).split('\n')[1].startsWith('B\t+60'));
  console.log('OK: poängtavla');
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
    assert.ok(!('publicCards' in p), 'motståndares synliga kort ska man komma ihåg själv');
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
    if (ex.step === 'extra' && ex.waitingFor.includes(me)) {
      if (ex.proposal) return act({ type: 'exchangeVote', yes: Math.random() < 0.7 });
      if (Math.random() < 0.15 && !G.players.find((p) => p.id === me).asked) return act({ type: 'exchangePropose', count: 1 + Math.floor(Math.random() * 3) });
      return act({ type: 'exchangeSatisfied' });
    }
    if (ex.step === 'extraDiscard' && ex.waitingFor.includes(me)) return act({ type: 'exchangeExtraDiscard', cardIds: hand.slice(0, ex.leaderCount).map((c) => c.id) });
  } else if (pl && pl.turnId === me) {
    if (pl.count === null) return act({ type: 'play', cardIds: [hand[hand.length - 1].id] });
    const ok = hand.filter((c) => c.rank >= pl.combo.rank);
    const groups = {}; ok.forEach((c) => (groups[c.rank] = groups[c.rank] || []).push(c));
    const g = Object.values(groups).find((x) => x.length >= pl.count);
    if (g) return act({ type: 'play', cardIds: g.slice(0, pl.count).map((c) => c.id) });
    if (ok.length >= pl.count) { assert.ok(pl.canBeat); return act({ type: 'play', cardIds: ok.slice(0, pl.count).map((c) => c.id) }); }
    assert.ok(!pl.canBeat);
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
  assert.ok(host.state.game.players.some((p) => p.handCount === 0), 'någon ska ha slut på kort');
  assert.strictEqual(host.state.lobby.tally.rounds.length, 1, 'omgången sparas i poängtavlan');
  // ny omgång med samma spelare
  const again = await emit(host, 'start'); assert.ok(again.ok, again.error);
  await wait(30);
  assert.strictEqual(host.state.game.phase, 'exchange');
  players.forEach((p) => p.close());
  console.log(`OK: helt spel över nätverket med ${n} spelare (${R.map((r) => r.name + ' ' + r.score).join(', ')})`);
}

// Två människor och tre bottar i samma rum, med inställningar från menyn.
async function runWithBots() {
  const host = client('Värd'); await new Promise((r) => host.on('connect', r));
  const res = await emit(host, 'create', { name: 'Värd' });
  const friend = client('Vän'); await new Promise((r) => friend.on('connect', r));
  assert.ok((await emit(friend, 'join', { code: res.code, name: 'Vän' })).ok);
  const notHost = await emit(friend, 'addBot'); assert.ok(!notHost.ok, 'bara värden får lägga till bottar');
  await emit(host, 'settings', { maxPlayers: 5, multiplier: 10, botSpeed: 'fast', extraExchanges: false });
  for (let k = 0; k < 3; k++) assert.ok((await emit(host, 'addBot')).ok);
  assert.ok(!(await emit(host, 'addBot')).ok, 'rummet är fullt');
  const L = host.state.lobby;
  assert.strictEqual(L.players.filter((p) => p.bot).length, 3);
  assert.deepStrictEqual([L.settings.multiplier, L.settings.botSpeed, L.settings.extraExchanges], [10, 'fast', false]);
  const gone = L.players.find((p) => p.bot).id;
  await emit(host, 'removeBot', gone); assert.strictEqual(host.state.lobby.players.length, 4);
  await emit(host, 'addBot');
  friend.emit('ready', true); await wait(20);
  assert.ok((await emit(host, 'start')).ok);
  await wait(50);
  assert.strictEqual(host.state.game.phase, 'exchange');
  host.emit('animDone');
  let iters = 0;
  while (host.state.game.phase !== 'finished') {
    if (++iters > 20000) throw new Error('fastnade med bottar');
    assert.ok(!host.state.game.exchange || host.state.game.exchange.step !== 'extra', 'extra byten är avstängda');
    let any = false;
    for (const p of [host, friend]) { const r = await bot(p); if (r) { if (!r.ok) throw new Error(r.error); any = true; } }
    if (!any) await wait(5);
  }
  await wait(30);
  host.state.game.results.forEach((r) => assert.strictEqual(r.score, r.value * 10));
  host.close(); friend.close();
  console.log('OK: spel över nätverket med 2 människor och 3 bottar');
}

{ // multiplikator från högsta / näst högsta synliga kortet
  for (const mode of ['highest', 'second']) for (let k = 0; k < 30; k++) {
    const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], { multiplier: mode });
    const ranks = g.dealReveal.map((r) => r.cards[0].rank).sort((x, y) => y - x);
    assert.strictEqual(g.multiplier, mode === 'highest' ? ranks[0] : ranks[1]);
    assert.strictEqual(g.viewFor('a').multiplierMode, mode);
  }
  const f = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { multiplier: 5 });
  assert.strictEqual(f.multiplier, 5);
  console.log('OK: multiplikator från högsta och näst högsta kortet');
}

{ // standarddrag när tiden går ut: nöjd/behåll under bytet
  const { timeoutMove } = require('../src/turntimer');
  const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  const L = g.players[g.leader].id, O = g.players[1 - g.leader].id;
  assert.deepStrictEqual(timeoutMove(g, L), { type: 'exchangeLeader', cardIds: [] });
  assert.strictEqual(timeoutMove(g, O), null, 'inte motståndarens tur');
  g.act(L, timeoutMove(g, L));
  assert.deepStrictEqual(timeoutMove(g, O), { type: 'exchangeOther', discard: false });
  console.log('OK: standarddrag vid timeout');
}

// Två människor som aldrig gör något: turtimern spelar klart åt dem, även när en har tappat anslutningen.
async function runTimer() {
  const host = client('Värd'); await new Promise((r) => host.on('connect', r));
  const res = await emit(host, 'create', { name: 'Värd' });
  const friend = client('Vän'); await new Promise((r) => friend.on('connect', r));
  await emit(friend, 'join', { code: res.code, name: 'Vän' });
  await emit(host, 'settings', { ...host.state.lobby.settings, turnTime: 20 });
  assert.strictEqual(host.state.lobby.settings.turnTime, 20);
  assert.ok(!(await emit(friend, 'settings', { turnTime: 60 })).ok, 'bara värden ändrar');
  friend.emit('ready', true); await wait(20);
  assert.ok((await emit(host, 'start')).ok);
  await wait(30);
  assert.deepStrictEqual(host.state.lobby.timers, {}, 'ingen timer under utdelningen');
  host.emit('animDone'); await wait(30);
  const t = host.state.lobby.timers;
  assert.ok(Object.keys(t).length === 1 && t[host.state.game.leaderId] > 0, 'styrspelaren har en timer');
  friend.close(); // tappar anslutningen – timern gäller ändå
  const start = Date.now();
  while (host.state.game.phase !== 'finished') {
    if (Date.now() - start > 60000) throw new Error('timern spelade inte klart');
    await wait(50);
  }
  host.close();
  console.log('OK: turtimern spelar klart när ingen gör något');
}

// Öppna rum: listan uppdateras live och visar bara kod, värdnamn och antal.
async function runOpenRooms() {
  const watcher = client('Tittare'); let list = null;
  watcher.on('openRooms', (l) => { list = l; });
  await new Promise((r) => watcher.on('connect', r));
  const host = client('Värd'); await new Promise((r) => host.on('connect', r));
  const res = await emit(host, 'create', { name: 'Lisa' });
  await wait(30);
  assert.ok(!list.some((r) => r.code === res.code), 'privata rum syns inte');
  assert.strictEqual(host.state.lobby.settings.visibility, 'private');
  await emit(host, 'settings', { ...host.state.lobby.settings, visibility: 'open', maxPlayers: 2 });
  await wait(30);
  const mine = list.find((r) => r.code === res.code);
  assert.deepStrictEqual(mine, { code: res.code, host: 'Lisa', players: 1, max: 2 });
  const j = await emit(watcher, 'join', { code: mine.code, name: 'Okänd' });
  assert.ok(j.ok); await wait(30);
  assert.strictEqual(watcher.state.lobby.players.length, 2, 'hamnar i lobbyn');
  assert.ok(!list.some((r) => r.code === res.code), 'fulla rum syns inte');
  await emit(host, 'settings', { ...host.state.lobby.settings, maxPlayers: 4 }); await wait(30);
  assert.strictEqual(list.find((r) => r.code === res.code).players, 2);
  watcher.emit('ready', true); await wait(20);
  await emit(host, 'start'); await wait(30);
  assert.ok(!list.some((r) => r.code === res.code), 'startade rum syns inte');
  host.close(); watcher.close();
  console.log('OK: öppna rum');
}

server.listen(PORT, async () => {
  try { await runOpenRooms(); await runTimer(); await runWithBots(); for (let n = 2; n <= 6; n++) await run(n); process.exit(0); }
  catch (e) { console.error(e); process.exit(1); }
});
