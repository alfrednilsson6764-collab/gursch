'use strict';
// Simulerar många hela spel med slumpade (men giltiga) drag och kontrollerar att inga kort försvinner.
const { Game, GameError } = require('../src/game');
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function randomSubset(hand, n) { return [...hand].sort(() => Math.random() - 0.5).slice(0, n).map((c) => c.id); }

function playOne(nPlayers) {
  const g = new Game(Array.from({ length: nPlayers }, (_, i) => ({ id: 'p' + i, name: 'Spelare ' + i })), { multiplier: 2 });
  let steps = 0, rejected = 0;
  while (g.phase !== 'finished') {
    if (++steps > 5000) throw new Error('Spelet tar aldrig slut');
    const P = g.players;
    try {
      if (g.phase === 'exchange') {
        const ex = g.exchange;
        if (ex.step === 'leader') { const L = P[g.leader]; g.act(L.id, { type: 'exchangeLeader', cardIds: randomSubset(L.hand, Math.floor(Math.random() * 7)) }); }
        else if (ex.step === 'others') {
          const pid = Object.keys(ex.decisions).find((k) => ex.decisions[k] === null);
          const p = P[g.idx(pid)];
          g.act(pid, { type: 'exchangeOther', discard: Math.random() < 0.6, cardIds: randomSubset(p.hand, ex.leaderCount) });
        } else { g.act(pick(Object.keys(ex.offers)), { type: 'exchangeReplace', keep: Math.random() < 0.5 }); }
      } else {
        const pl = g.play, me = P[pl.turn];
        // försök ibland ett ogiltigt drag från fel spelare
        if (Math.random() < 0.05) { try { g.act(P[g.next(pl.turn)].id, { type: 'dump' }); throw new Error('fel spelare fick spela'); } catch (e) { if (!(e instanceof GameError)) throw e; rejected++; } }
        if (pl.count === null) {
          const r = pick(me.hand).rank; const same = me.hand.filter((c) => c.rank === r);
          g.act(me.id, { type: 'play', cardIds: same.slice(0, 1 + Math.floor(Math.random() * same.length)).map((c) => c.id) });
        } else if (g.canBeat(pl.turn)) {
          try { g.act(me.id, { type: 'dump' }); throw new Error('fick lägga lägsta trots att man kan slå'); } catch (e) { if (!(e instanceof GameError)) throw e; }
          const groups = {}; me.hand.forEach((c) => (groups[c.rank] = groups[c.rank] || []).push(c));
          const ok = Object.values(groups).filter((gr) => gr[0].rank >= pl.combo.rank && gr.length >= pl.count);
          g.act(me.id, { type: 'play', cardIds: pick(ok).slice(0, pl.count).map((c) => c.id) });
        } else g.act(me.id, { type: 'dump' });
      }
    } catch (e) { if (e instanceof GameError) throw new Error('Giltigt drag nekades: ' + e.message); throw e; }
  }
  if (!g.results || g.results.length !== nPlayers) throw new Error('Inget resultat');
  if (!g.players.some((p) => p.hand.length === 0)) throw new Error('Spelet slutade utan att någon fick slut på kort');
  const scores = g.results.map((r) => r.score), min = Math.min(...scores), max = Math.max(...scores);
  for (const r of g.results) {
    if (r.winner !== (min !== max && r.score === min)) throw new Error('fel vinnare');
    if (r.loser !== (min !== max && r.score === max)) throw new Error('fel förlorare');
  }
  if (g.isDraw !== (min === max)) throw new Error('fel oavgjort');
  return { steps, rejected, results: g.results };
}

let total = 0;
for (let n = 2; n <= 6; n++) for (let k = 0; k < 400; k++) { playOne(n); total++; }
const ex = playOne(4);
console.log(`OK: ${total} spel simulerade utan kortfel. Exempel:`, ex.results.map((r) => `${r.name}: ${r.value}→${r.score}${r.winner ? ' (vinnare)' : ''}`).join(', '));
