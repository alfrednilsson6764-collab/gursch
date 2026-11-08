'use strict';
// Datorspelare för Gursch med olika personligheter (Alfred 2026-11-08).
// botMove(game, playerId, personality) returnerar ett drag (eller null om boten inte ska agera nu).
// Boten ser bara sin egen hand och det som är offentligt (lagda kort och de synliga korten vid utdelningen).
// Alla drag är vanliga tillåtna drag enligt reglerna i src/game.js.
(function (root) {
  // ---------- personligheter ----------
  const PERSONALITIES = {
    cautious: { label: 'Försiktig', emoji: '🛡️', desc: 'behåller låga kort och tar sällan styret med höga' },
    gambler: { label: 'Chansare', emoji: '🎲', desc: 'chansar alltid och tar styret när han kan' },
    novice: { label: 'Nybörjare', emoji: '🐣', desc: 'lär sig fortfarande och gör ibland misstag' },
    normal: { label: 'Normal', emoji: '🙂', desc: 'spelar stabilt och vanligt' },
    expert: { label: 'Expert', emoji: '🧠', desc: 'räknar kort och planerar för att gå ut lågt' },
  };
  // En bot per namn
  const BOT_PROFILES = [
    { name: 'Astrid', personality: 'cautious' },
    { name: 'Bertil', personality: 'gambler' },
    { name: 'Cissi', personality: 'novice' },
    { name: 'David', personality: 'normal' },
    { name: 'Elsa', personality: 'expert' },
  ];
  // Hur gärna boten reagerar (1 = som vanligt). Bertil är mer högljudd, Astrid reagerar sällan.
  const CHATTINESS = { cautious: 0.3, gambler: 2.5, novice: 1.2, normal: 1, expert: 0.8 };

  // ---------- hjälpfunktioner ----------
  function groups(hand) {
    const g = {};
    for (const c of hand) (g[c.rank] = g[c.rank] || []).push(c);
    return Object.values(g);
  }
  const ids = (cards) => cards.map((c) => c.id);
  const sum = (cards) => cards.reduce((s, c) => s + c.rank, 0);
  const highest = (hand, n) => [...hand].sort((a, b) => b.rank - a.rank).slice(0, n);
  const distinct = (cards) => new Set(cards.map((c) => c.rank)).size;
  const without = (hand, cards) => hand.filter((c) => !cards.includes(c));

  /** Alla k-kombinationer av en lista (handen har högst 6 kort, så det blir få). */
  function combos(list, k, start = 0, acc = [], out = []) {
    if (acc.length === k) { out.push(acc.slice()); return out; }
    for (let i = start; i <= list.length - (k - acc.length); i++) { acc.push(list[i]); combos(list, k, i + 1, acc, out); acc.pop(); }
    return out;
  }

  /** Alla tillåtna drag i spelfasen för spelare i (lika valörer räknas bara en gång). */
  function legalPlays(game, i) {
    const pl = game.play, hand = game.players[i].hand;
    const seen = new Set(), out = [];
    const add = (cards, kind) => {
      const key = cards.map((c) => c.rank).sort((a, b) => a - b).join(',');
      if (seen.has(key)) return;
      seen.add(key); out.push({ cards, kind });
    };
    if (pl.count === null) {
      for (const g of groups(hand)) for (let k = 1; k <= g.length; k++) add(g.slice(0, k), k === hand.length ? 'out' : 'lead');
      return out;
    }
    const ok = hand.filter((c) => c.rank >= pl.combo.rank);
    if (ok.length < pl.count) return [{ cards: [...hand].sort((a, b) => a.rank - b.rank).slice(0, pl.count), kind: 'dump' }];
    for (const c of combos(ok, pl.count)) add(c, c.every((x) => x.rank === c[0].rank) ? 'take' : 'over');
    return out;
  }
  const asMove = (p) => (p.kind === 'dump' ? { type: 'dump' } : { type: 'play', cardIds: ids(p.cards) });

  // ---------- kortminne för experten: vilka kort har synts? ----------
  const memory = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  /** Kort som har lagts på bordet (alla har sett dem, och de är ute ur spelet). */
  function seenCards(game) {
    if (!memory) return new Map();
    let m = memory.get(game);
    if (!m) { m = new Map(); memory.set(game, m); }
    const note = (c) => m.set(c.id, c.rank);
    const pl = game.play;
    if (pl) [...pl.table, ...pl.lastTable].forEach((t) => t.cards.forEach(note));
    return m;
  }
  // ---------- inledningen (byten) ----------
  // Extra byten per personlighet: vilka kort räknas som höga, och hur lätt boten låter sig övertalas.
  const EXTRA = {
    normal: { high: 10, persuade: 0.35 },
    cautious: { high: 9, persuade: 0.03 },
    gambler: { high: 11, persuade: 0.8 },
    novice: { high: 10, persuade: 0.5 },
    expert: { high: 8, persuade: 0.2 },
  };
  // Beslut som bara ska slumpas en gång per fråga/byte (annars skulle boten "slå om" vid varje uppdatering).
  const decisions = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function decide(obj, pid, fn) {
    if (!decisions) return fn();
    let m = decisions.get(obj);
    if (!m) { m = {}; decisions.set(obj, m); }
    if (!(pid in m)) m[pid] = fn();
    return m[pid];
  }
  function exchangeMove(game, i, pid, P, rnd) {
    const ex = game.exchange, hand = game.players[i].hand, value = sum(hand);
    // nivåer per personlighet: vilka kort räknas som "höga", när är ett erbjudande bra nog att behålla
    const T = {
      normal: { lead: 11, worth: 9, keepAvg: 7, otherAll: 54 },
      cautious: { lead: 10, worth: 8, keepAvg: 6, otherAll: 48 },
      gambler: { lead: 12, worth: 10, keepAvg: 5, otherAll: 60 },
      novice: { lead: 11, worth: 9, keepAvg: 7, otherAll: 54 },
      expert: { lead: 5, worth: 5, keepAvg: 6, otherAll: 30, keepMin: 3 },
    }[P] || {};
    if (ex.step === 'leader' && game.leader === i) {
      let high = hand.filter((c) => c.rank >= T.lead);
      if (P === 'expert') {
        // byt bort allt utom de lägsta korten (sista kortet avgör), men behåll par som gör det lättare att gå ut
        const keep = new Set(groups(hand).filter((g) => g.length >= 2 && g[0].rank <= 10).flat());
        high = hand.filter((c) => c.rank >= T.lead && !keep.has(c));
      }
      return { type: 'exchangeLeader', cardIds: ids(high) };
    }
    if (ex.step === 'others' && ex.decisions[pid] === null) {
      if (ex.leaderCount === 0) return { type: 'exchangeOther', discard: value > T.otherAll };
      const worst = highest(hand, ex.leaderCount);
      const worth = worst.filter((c) => c.rank >= T.worth).length >= Math.ceil(ex.leaderCount / 2);
      return { type: 'exchangeOther', discard: worth, cardIds: ids(worst) };
    }
    if (ex.step === 'replace' && ex.offers[pid]) {
      const o = ex.offers[pid];
      // experten behåller erbjudandet om det innehåller ett riktigt lågt kort – det kan bli sista kortet
      if (P === 'expert') return { type: 'exchangeReplace', keep: Math.min(...o.map((c) => c.rank)) <= T.keepMin || sum(o) <= T.keepAvg * o.length };
      return { type: 'exchangeReplace', keep: sum(o) <= T.keepAvg * o.length };
    }
    if (ex.step === 'extra') {
      // Extra byten (Alfred 2026-11-08). Ju fler extra byten som redan gjorts, desto mer benägen att säga nej,
      // så att det inte blir oändligt.
      const done = Math.max(0, ex.round - 3);
      const fade = Math.pow(0.55, done);
      const Pr = ex.proposal;
      if (Pr) {
        if (Pr.votes[pid] === null) {
          // ja om boten har höga kort den vill bli av med
          const high = hand.filter((c) => c.rank >= EXTRA[P].high).length;
          return { type: 'exchangeVote', yes: high >= Pr.count && rnd() < fade };
        }
        if (Pr.votes[pid] === false && Pr.persuading) {
          // låter sig ibland övertalas under fristen (Bertil ofta, Astrid nästan aldrig) – bestäms en gång per fråga
          if (decide(Pr, pid, () => rnd() < EXTRA[P].persuade)) return { type: 'exchangeChangeMind', delay: 2500 + Math.floor(rnd() * 4000) };
        }
        return null;
      }
      // frågar själv bara om korten är tydligt dåliga
      const bad = hand.filter((c) => c.rank >= 11);
      if (bad.length >= 3 && decide(ex, pid, () => rnd() < 0.7 * fade)) return { type: 'exchangePropose', count: bad.length };
      return { type: 'exchangeGo' }; // servern låter inte bottar trycka "Vi kör" när det finns människor i rummet
    }
    if (ex.step === 'extraDiscard' && ex.decisions[pid] === null) return { type: 'exchangeExtraDiscard', cardIds: ids(highest(hand, ex.leaderCount)) };
    return null;
  }

  // ---------- spelet ----------
  // Dagens logik ("Normal")
  function normalPlay(game, i) {
    const pl = game.play, hand = game.players[i].hand;
    if (pl.count === null) {
      // gå ut om alla kort har samma valör
      if (hand.every((c) => c.rank === hand[0].rank)) return { type: 'play', cardIds: ids(hand) };
      // annars starta med den grupp som gör av med mest poäng
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

  // Försiktig: tar bara styret med låga kort, lägger annars över med sina högsta och behåller de låga.
  function cautiousPlay(game, i) {
    const pl = game.play, hand = game.players[i].hand, plays = legalPlays(game, i);
    if (pl.count === null) {
      const out = plays.find((p) => p.kind === 'out');
      if (out && sum(out.cards) <= 6 * out.cards.length) return asMove(out);
      // lägg de högsta korten först, så att de låga blir kvar
      const lead = plays.filter((p) => p.kind === 'lead').sort((a, b) => b.cards[0].rank - a.cards[0].rank || b.cards.length - a.cards.length)[0];
      return asMove(lead || out);
    }
    const takes = plays.filter((p) => p.kind === 'take' && p.cards[0].rank <= 8).sort((a, b) => a.cards[0].rank - b.cards[0].rank);
    if (takes.length) return asMove(takes[0]);
    const overs = plays.filter((p) => p.kind === 'over').sort((a, b) => sum(b.cards) - sum(a.cards));
    if (overs.length) return asMove(overs[0]);
    return asMove(plays.sort((a, b) => sum(a.cards) - sum(b.cards))[0]);
  }

  // Chansare: tar alltid styret när han kan (med högsta gruppen) och går ut så fort det går.
  function gamblerPlay(game, i) {
    const pl = game.play, plays = legalPlays(game, i);
    if (pl.count === null) {
      const out = plays.find((p) => p.kind === 'out');
      if (out) return asMove(out);
      // lägg största gruppen för att snabbt få en hand som går att gå ut med
      return asMove(plays.sort((a, b) => b.cards.length - a.cards.length || b.cards[0].rank - a.cards[0].rank)[0]);
    }
    const takes = plays.filter((p) => p.kind === 'take').sort((a, b) => b.cards[0].rank - a.cards[0].rank);
    if (takes.length) return asMove(takes[0]);
    return normalPlay(game, i);
  }

  // Expert: räknar sedda kort och planerar för att gå ut med lägst poäng.
  // För varje tillåtet drag spelar experten igenom resten av omgången många gånger i huvudet
  // (motståndarnas okända kort slumpas bland de kort som inte har synts) och väljer draget som oftast leder till vinst.
  function cloneForRollout(game) {
    const c = Object.create(Object.getPrototypeOf(game));
    Object.assign(c, game);
    c.players = game.players.map((p) => ({ ...p, hand: p.hand.slice(), publicIds: new Set(p.publicIds) }));
    const pl = game.play;
    c.play = { ...pl, table: pl.table.slice(), lastTable: pl.lastTable.slice(), combo: pl.combo && { ...pl.combo } };
    c.discard = game.discard.slice(); c.deck = game.deck.slice(); c.setAside = game.setAside.slice();
    c.history = []; c.events = [];
    c.log = () => {}; c.event = () => {}; c.checkInvariant = () => {};
    return c;
  }
  function expertPlay(game, i, rnd) {
    const plays = legalPlays(game, i);
    if (plays.length === 1) return asMove(plays[0]);
    const me = game.players[i], seen = seenCards(game);
    // okända kort: alla 104 utom mina och de som har synts (lagda på bordet eller öppna vid utdelningen)
    const mineIds = new Set(me.hand.map((c) => c.id));
    const pool = [];
    for (const s of ['S', 'H', 'D', 'C']) for (let r = 2; r <= 14; r++) for (let d = 0; d < 2; d++) {
      const id = `${s}${r}-${d}`;
      if (!mineIds.has(id) && !seen.has(id)) pool.push({ id, rank: r, suit: s });
    }
    const ROLLOUTS = 28;
    let best = null, bestScore = -Infinity;
    for (const p of plays) {
      let total = 0;
      for (let k = 0; k < ROLLOUTS; k++) {
        const g = cloneForRollout(game);
        // ge motståndarna slumpade händer ur de okända korten
        const deck = pool.slice();
        for (let j = deck.length - 1; j > 0; j--) { const x = Math.floor(rnd() * (j + 1)); [deck[j], deck[x]] = [deck[x], deck[j]]; }
        let pos = 0;
        for (const q of g.players) if (q.id !== me.id) { q.hand = deck.slice(pos, pos + q.hand.length); pos += q.hand.length; }
        try {
          g.act(me.id, asMove(p));
          let guard = 0;
          while (g.phase !== 'finished' && guard++ < 400) {
            const t = g.players[g.play.turn];
            g.act(t.id, normalPlay(g, g.play.turn));
          }
        } catch (e) { continue; }
        if (g.phase !== 'finished') continue;
        const mine = g.results.find((r) => r.playerId === me.id);
        const winners = g.results.filter((r) => r.winner).length;
        total += (mine.winner ? 1 / winners : 0) - (mine.loser ? 0.3 : 0) - mine.value * 0.002;
      }
      if (total > bestScore) { bestScore = total; best = p; }
    }
    return asMove(best);
  }

  function botMove(game, pid, personality = 'normal', rnd = Math.random) {
    const i = game.players.findIndex((p) => p.id === pid);
    if (i < 0) return null;
    const P = PERSONALITIES[personality] ? personality : 'normal';
    if (game.phase === 'exchange') {
      const move = exchangeMove(game, i, pid, P, rnd);
      return move;
    }
    if (game.phase !== 'play' || game.play.turn !== i) return null;
    if (P === 'expert') seenCards(game); // uppdatera kortminnet
    if (P === 'novice') {
      // nybörjaren gör ungefär vart fjärde drag ett slumpat tillåtet drag istället för det bästa
      if (rnd() < 0.25) {
        const plays = legalPlays(game, i).filter((p) => p.kind !== 'out' || game.players[i].hand.length === 1);
        return asMove(plays[Math.floor(rnd() * plays.length)] || legalPlays(game, i)[0]);
      }
      return normalPlay(game, i);
    }
    if (P === 'cautious') return cautiousPlay(game, i);
    if (P === 'gambler') return gamblerPlay(game, i);
    if (P === 'expert') return expertPlay(game, i, rnd);
    return normalPlay(game, i);
  }

  /** Personlighet för en botnamn, t.ex. "Bertil (bot)" → "gambler". */
  function personalityOf(name) {
    const base = String(name || '').replace(' (bot)', '');
    const p = BOT_PROFILES.find((b) => b.name === base);
    return p ? p.personality : 'normal';
  }

  const api = { botMove, legalPlays, PERSONALITIES, BOT_PROFILES, CHATTINESS, personalityOf };
  if (typeof module !== 'undefined') module.exports = api;
  else root.GurschBots = api;
})(this);
