'use strict';
// Turtimer för Gursch (Alfred 2026-11-08). Används av servern (och av testversionen i webbläsaren).
// Ändrar inga spelregler: när tiden går ut görs ett vanligt drag åt spelaren.
(function (root) {
  const { botMove } = typeof module !== 'undefined' ? require('./bots') : root.GurschBots;

  /** Draget som görs när tiden har gått ut. Under bytet är standardvalet "nöjd/behåll". null = spelaren behöver inte göra något. */
  function timeoutMove(game, pid) {
    const move = botMove(game, pid);
    if (!move) return null;
    const ex = game.exchange;
    if (game.phase === 'exchange' && ex) {
      if (ex.step === 'leader') return { type: 'exchangeLeader', cardIds: [] };
      if (ex.step === 'others') return { type: 'exchangeOther', discard: false };
      if (ex.step === 'replace') return { type: 'exchangeReplace', keep: true };
      if (ex.step === 'extra') return ex.proposal ? { type: 'exchangeVote', yes: false } : { type: 'exchangeSatisfied' };
    }
    return move; // spelet och extra slängning (som alla redan sagt ja till): samma logik som bottarna
  }

  /** En nyckel som ändras när ett nytt beslut ska fattas, så att timern startar om bara då. */
  function turnKey(game) {
    const ex = game.exchange, pl = game.play;
    if (ex) return `x${ex.round}:${ex.step}:${ex.proposal ? ex.proposal.by + ex.proposal.count : ''}:${Object.keys(ex.offers).join(',')}`;
    if (pl) return `p${pl.roundNo}:${pl.table.length}:${pl.turn}`;
    return game.phase;
  }

  /**
   * Håller en timer per människa vars tur det är.
   * sync(game, humanIds, seconds, paused) anropas efter varje ändring; onExpire(pid) anropas när tiden är slut.
   */
  function createTurnTimers(onExpire) {
    const timers = new Map(); // pid -> { key, deadline, handle }
    const clear = (pid) => { const t = timers.get(pid); if (t) clearTimeout(t.handle); timers.delete(pid); };
    return {
      sync(game, humanIds, seconds, paused) {
        const active = new Set();
        if (game && seconds > 0 && !paused && game.phase !== 'finished') {
          const key = turnKey(game);
          for (const pid of humanIds) {
            if (!timeoutMove(game, pid)) continue;
            active.add(pid);
            const t = timers.get(pid);
            if (t && t.key === key) continue;
            clear(pid);
            const deadline = Date.now() + seconds * 1000;
            timers.set(pid, { key, deadline, handle: setTimeout(() => { timers.delete(pid); onExpire(pid); }, seconds * 1000) });
          }
        }
        for (const pid of [...timers.keys()]) if (!active.has(pid)) clear(pid);
      },
      /** Kvarvarande millisekunder per spelare. */
      remaining() {
        const now = Date.now(), out = {};
        for (const [pid, t] of timers) out[pid] = Math.max(0, t.deadline - now);
        return out;
      },
      clearAll() { for (const pid of [...timers.keys()]) clear(pid); },
    };
  }

  const api = { timeoutMove, turnKey, createTurnTimers };
  if (typeof module !== 'undefined') module.exports = api;
  else root.GurschTimer = api;
})(typeof window !== 'undefined' ? window : globalThis);
