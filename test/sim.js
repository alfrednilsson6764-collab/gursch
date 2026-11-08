'use strict';
// Simulerar många hela spel (bottar + slumpade drag) och kontrollerar att inga kort försvinner eller dupliceras.
// Fröad slump i personlighetsturneringen så att resultatet går att upprepa (påverkar inte spelreglerna).
const crypto = require('crypto');
const realRandomInt = crypto.randomInt;
let seeded = null;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
crypto.randomInt = (min, max) => {
  if (!seeded) return realRandomInt(min, max);
  if (max === undefined) [min, max] = [0, min];
  return min + Math.floor(seeded() * (max - min));
};
const { Game, GameError } = require('../src/game');
const { botMove, PERSONALITIES, BOT_PROFILES } = require('../src/bots');
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function randomize(g, pid, move) {
  const ex = g.exchange;
  // ibland föreslår någon ett extra byte, och ibland säger någon ja trots allt
  if (ex && ex.step === 'extra' && !ex.proposal && !g.asked.has(pid) && Math.random() < 0.2) return { type: 'exchangePropose', count: 1 + Math.floor(Math.random() * 6) };
  if (move && move.type === 'exchangeVote' && Math.random() < 0.5) return { type: 'exchangeVote', yes: true };
  if (move && move.type === 'exchangeVote' && !move.yes && !g.asked.has(pid) && Math.random() < 0.5) return { ...move, counter: 1 + Math.floor(Math.random() * 6) };
  if (move && move.type === 'exchangeReplace') return { ...move, keep: Math.random() < 0.5 };
  return move;
}

function playOne(nPlayers) {
  const g = new Game(Array.from({ length: nPlayers }, (_, i) => ({ id: 'p' + i, name: 'Spelare ' + i })), { multiplier: 2 });
  let steps = 0, extras = 0, overs = 0;
  while (g.phase !== 'finished') {
    if (++steps > 20000) throw new Error('Spelet tar aldrig slut');
    const movers = g.players.map((p) => [p.id, botMove(g, p.id)]).filter(([, m]) => m);
    if (!movers.length) throw new Error('Ingen kan göra något drag i läget ' + g.phase + '/' + (g.exchange && g.exchange.step));
    const [pid, m0] = pick(movers);
    const m = randomize(g, pid, m0);
    // fusk: fel spelares tur ska alltid nekas
    if (g.phase === 'play') {
      const other = g.players[g.next(g.play.turn)].id;
      try { g.act(other, { type: 'dump' }); throw new Error('fel spelare fick spela'); } catch (e) { if (!(e instanceof GameError)) throw e; }
      if (g.play.count !== null && g.canBeat(g.play.turn)) {
        try { g.act(pid, { type: 'dump' }); throw new Error('fick lägga lägsta trots att man kan lägga över'); } catch (e) { if (!(e instanceof GameError)) throw e; }
      }
    }
    if (m.type === 'exchangeExtraDiscard') extras++;
    if (g.phase === 'play' && m.type === 'play' && g.play.count !== null && new Set(m.cardIds.map((id) => id.split('-')[0].slice(1))).size > 1) overs++;
    try { g.act(pid, m); } catch (e) { if (e instanceof GameError) throw new Error(`Giltigt drag nekades (${JSON.stringify(m)}): ${e.message}`); throw e; }
  }
  if (!g.players.some((p) => p.hand.length === 0)) throw new Error('Spelet slutade utan att någon fick slut på kort');
  const scores = g.results.map((r) => r.score), min = Math.min(...scores), max = Math.max(...scores);
  for (const r of g.results) {
    if (r.winner !== (min !== max && r.score === min)) throw new Error('fel vinnare');
    if (r.loser !== (min !== max && r.score === max)) throw new Error('fel förlorare');
  }
  if (g.isDraw !== (min === max)) throw new Error('fel oavgjort');
  return { extras, overs };
}

let total = 0, extras = 0, overs = 0;
for (let n = 2; n <= 6; n++) for (let k = 0; k < 400; k++) { const r = playOne(n); total++; extras += r.extras; overs += r.overs; }
if (!extras || !overs) throw new Error('Simuleringen täckte inte extra byten eller att lägga över');
console.log(`OK: ${total} spel simulerade utan kortfel (${extras} extra-byten, ${overs} gånger lagt över).`);

// ---- personligheter: alla fem bottar spelar mot varandra ----
// Varje bot spelar 1 200 matcher (fem spelare per match, slumpad placering). Vinst räknas som andel av vinsten
// (delar två på lägst poäng får de en halv vinst var). Expert ska vinna oftast och Nybörjare mest sällan.
{
  const rnd = mulberry32(Number(process.env.GURSCH_SEED) || 20261108);
  seeded = rnd;
  const Ps = Object.keys(PERSONALITIES);
  const wins = {}, played = {}, value = {};
  Ps.forEach((p) => { wins[p] = 0; played[p] = 0; value[p] = 0; });
  const MATCHES = 1200;
  for (let k = 0; k < MATCHES; k++) {
    const seat = Ps.map((p) => [p, rnd()]).sort((a, b) => a[1] - b[1]).map(([p]) => p);
    const g = new Game(seat.map((p) => ({ id: p, name: p })), { multiplier: 1 });
    let steps = 0;
    while (g.phase !== 'finished') {
      if (++steps > 5000) throw new Error('Personlighetsspel tar aldrig slut');
      const movers = g.players.map((p) => [p.id, botMove(g, p.id, p.id, rnd)]).filter(([, m]) => m);
      if (!movers.length) throw new Error('Ingen bot kan göra något drag');
      const [pid, m] = movers[Math.floor(rnd() * movers.length)];
      try { g.act(pid, m); } catch (e) { if (e instanceof GameError) throw new Error(`${pid} gjorde ett otillåtet drag (${JSON.stringify(m)}): ${e.message}`); throw e; }
    }
    const nWin = g.results.filter((r) => r.winner).length;
    for (const r of g.results) { played[r.playerId]++; value[r.playerId] += r.value; if (r.winner) wins[r.playerId] += 1 / nWin; }
  }
  seeded = null;
  const pct = (p) => (100 * wins[p]) / played[p];
  const name = (p) => (BOT_PROFILES.find((b) => b.personality === p) || {}).name;
  for (const p of [...Ps].sort((a, b) => pct(b) - pct(a)))
    console.log(`   ${name(p).padEnd(7)} ${PERSONALITIES[p].emoji}  ${PERSONALITIES[p].label.padEnd(10)} ${pct(p).toFixed(1).padStart(5)} % vinster  (snittpoäng ${(value[p] / played[p]).toFixed(1)}, ${played[p]} matcher)`);
  const order = [...Ps].sort((a, b) => pct(b) - pct(a));
  if (order[0] !== 'expert') throw new Error('Expert ska vinna oftast');
  if (order[order.length - 1] !== 'novice') throw new Error('Nybörjare ska vinna mest sällan');
  if (Ps.some((p) => played[p] < 500)) throw new Error('Varje bot ska spela minst 500 matcher');
  console.log('OK: personligheter – alla drag tillåtna, Expert vinner oftast och Nybörjare mest sällan');
}
