'use strict';
// Enkla datorspelare för Gursch. botMove(game, playerId) returnerar ett drag (eller null om boten inte ska agera nu).
// Boten ser bara sin egen hand och det som är offentligt.
(function (root) {
  function groups(hand) {
    const g = {};
    for (const c of hand) (g[c.rank] = g[c.rank] || []).push(c);
    return Object.values(g);
  }
  const ids = (cards) => cards.map((c) => c.id);
  const highest = (hand, n) => [...hand].sort((a, b) => b.rank - a.rank).slice(0, n);

  function botMove(game, pid) {
    const i = game.players.findIndex((p) => p.id === pid);
    if (i < 0) return null;
    const hand = game.players[i].hand;
    const value = hand.reduce((s, c) => s + c.rank, 0);

    if (game.phase === 'exchange') {
      const ex = game.exchange;
      if (ex.step === 'leader' && game.leader === i) {
        // släng höga kort (knekt och uppåt)
        const high = hand.filter((c) => c.rank >= 11);
        return { type: 'exchangeLeader', cardIds: ids(high) };
      }
      if (ex.step === 'others' && ex.decisions[pid] === null) {
        if (ex.leaderCount === 0) return { type: 'exchangeOther', discard: value > 54 };
        const worst = highest(hand, ex.leaderCount);
        const worth = worst.filter((c) => c.rank >= 9).length >= Math.ceil(ex.leaderCount / 2);
        return { type: 'exchangeOther', discard: worth, cardIds: ids(worst) };
      }
      if (ex.step === 'replace' && ex.offers[pid]) {
        const o = ex.offers[pid];
        return { type: 'exchangeReplace', keep: o.reduce((s, c) => s + c.rank, 0) <= 7 * o.length };
      }
      if (ex.step === 'extra') {
        if (ex.proposal) {
          if (ex.proposal.votes[pid] !== null) return null;
          return { type: 'exchangeVote', yes: hand.filter((c) => c.rank >= 10).length >= ex.proposal.count };
        }
        return ex.satisfied[pid] ? null : { type: 'exchangeSatisfied' };
      }
      if (ex.step === 'extraDiscard' && ex.decisions[pid] === null) return { type: 'exchangeExtraDiscard', cardIds: ids(highest(hand, ex.leaderCount)) };
      return null;
    }

    if (game.phase === 'play') {
      const pl = game.play;
      if (pl.turn !== i) return null;
      if (pl.count === null) {
        // starta med den grupp som gör av med mest poäng
        const best = groups(hand).sort((a, b) => b.length * b[0].rank - a.length * a[0].rank)[0];
        return { type: 'play', cardIds: ids(best) };
      }
      // ta styret med lägsta möjliga grupp
      const ok = groups(hand).filter((g) => g[0].rank >= pl.combo.rank && g.length >= pl.count).sort((a, b) => a[0].rank - b[0].rank);
      if (ok.length) return { type: 'play', cardIds: ids(ok[0].slice(0, pl.count)) };
      // annars lägg över med de lägsta korten som räcker, om det går
      const over = hand.filter((c) => c.rank >= pl.combo.rank).sort((a, b) => a.rank - b.rank);
      if (over.length >= pl.count) return { type: 'play', cardIds: ids(over.slice(0, pl.count)) };
      return { type: 'dump' };
    }
    return null;
  }

  if (typeof module !== 'undefined') module.exports = { botMove };
  else root.GurschBots = { botMove };
})(this);
