'use strict';
// Poängtavla över flera omgångar med samma sällskap. Delas av servern, testversionen och klienten.
// Plus/minus räknas bara mellan omgångens vinnare och förlorare (inte de i mitten).
// Talet som används är förlorarens poäng, precis som omgången slutade (Alfred 2026-11-08):
// vinnaren får +förlorarens poäng och förloraren lika mycket i minus. Inga egna omräkningar.
// En omgång sparas som { scores, winners, losers }.
(function (root) {
  function addRound(tally, results) {
    tally.rounds.push({
      scores: Object.fromEntries(results.map((r) => [r.playerId, r.score])),
      winners: results.filter((r) => r.winner).map((r) => r.playerId),
      losers: results.filter((r) => r.loser).map((r) => r.playerId),
    });
    for (const r of results) tally.names[r.playerId] = r.name;
  }

  function versus(tally, me, other) {
    let sum = 0;
    for (const r of tally.rounds) {
      const w = r.winners || [], l = r.losers || [];
      if (w.includes(me) && l.includes(other)) sum += r.scores[other];
      else if (l.includes(me) && w.includes(other)) sum -= r.scores[me];
    }
    return sum;
  }

  function totals(tally) {
    const t = {};
    for (const r of tally.rounds) for (const [pid, s] of Object.entries(r.scores)) {
      t[pid] = t[pid] || { playerId: pid, name: tally.names[pid], total: 0, rounds: 0 };
      t[pid].total += s; t[pid].rounds++;
    }
    const ids = Object.keys(t);
    for (const pid of ids) t[pid].net = ids.reduce((s, o) => s + (o === pid ? 0 : versus(tally, pid, o)), 0);
    return Object.values(t).sort((a, b) => a.total - b.total);
  }

  const sign = (n) => (n > 0 ? '+' + n : String(n));

  function summaryText(tally) {
    const rows = totals(tally).sort((a, b) => b.net - a.net);
    const n = tally.rounds.length;
    return [`GURSCH – ställning efter ${n} omgång${n === 1 ? '' : 'ar'}`, ...rows.map((t) => `${t.name}\t${sign(t.net)}`)].join('\n');
  }


  const api = { addRound, versus, totals, summaryText, sign, create: () => ({ rounds: [], names: {} }) };
  if (typeof module !== 'undefined') module.exports = api;
  else root.GurschTally = api;
})(this);
