'use strict';
// Poängtavla över flera omgångar med samma sällskap. Delas av servern, testversionen och klienten.
// En omgång sparas som { scores: { playerId: slutpoäng } }.
// Plus/minus mot en annan spelare = summan av (hens poäng − mina poäng) i de omgångar båda var med.
// Lägst poäng är bäst, så plus betyder att man ligger före den spelaren.
(function (root) {
  function addRound(tally, results) {
    tally.rounds.push({ scores: Object.fromEntries(results.map((r) => [r.playerId, r.score])) });
    for (const r of results) tally.names[r.playerId] = r.name;
  }

  function versus(tally, me, other) {
    let sum = 0;
    for (const r of tally.rounds) if (me in r.scores && other in r.scores) sum += r.scores[other] - r.scores[me];
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
    const T = totals(tally);
    const lines = [`GURSCH – ställning efter ${tally.rounds.length} omgång${tally.rounds.length === 1 ? '' : 'ar'}`, ''];
    lines.push('Spelare\tTotalpoäng\tPlus/minus');
    for (const t of T) lines.push(`${t.name}\t${t.total}\t${sign(t.net)}`);
    lines.push('', 'Mot varandra (raden mot kolumnen):');
    lines.push(['', ...T.map((t) => t.name)].join('\t'));
    for (const a of T) lines.push([a.name, ...T.map((b) => (a === b ? '–' : sign(versus(tally, a.playerId, b.playerId))))].join('\t'));
    lines.push('', 'Omgångar:');
    tally.rounds.forEach((r, k) => lines.push(`${k + 1}. ` + T.filter((t) => t.playerId in r.scores).map((t) => `${t.name} ${r.scores[t.playerId]}`).join(', ')));
    return lines.join('\n');
  }

  const api = { addRound, versus, totals, summaryText, sign, create: () => ({ rounds: [], names: {} }) };
  if (typeof module !== 'undefined') module.exports = api;
  else root.GurschTally = api;
})(this);
