'use strict';
// Gursch – all spellogik. Körs endast på servern.
const crypto = require('crypto');

const SUITS = ['S', 'H', 'D', 'C']; // spader, hjärter, ruter, klöver
const RANK_NAMES = { 11: 'knekt', 12: 'dam', 13: 'kung', 14: 'ess' };

// Regler som var oklara i regelboken samlas här så att de lätt kan ändras.
const RULES = {
  // Bekräftat av Alfred 2026-11-07:
  // Varje runda spelas klart (alla lägger en gång). Spelet slutar när styrspelaren går ut.
  // Man måste alltid slå om man kan.
  mayDumpWhenCanBeat: false,
  // Avgörandekort vid lika läggs undan (ingår inte i slänghögen som blandas om).
  // Om ingen slår och turen kommer tillbaka: styrspelaren behåller styret.
  // Ersättningskort (Alfred 2026-11-07): man får alla på en gång med framsidan upp,
  // och väljer att behålla alla eller ta lika många dolda.
  // Extra byten (Alfred 2026-11-08, som i verkligheten):
  //  1. Efter styrspelarens två bytesrundor kan vem som helst fråga "Ska alla slänga X kort?" (X = 1–6).
  //  2. Alla andra svarar ja eller nej.
  //  3. Säger alla ja slänger alla X kort och får ersättningskort som vanligt. Sedan kan vem som
  //     helst fråga igen – hur många gånger som helst. Tar leken slut blandas slänghögen som vanligt.
  //  4. Säger någon nej börjar spelet direkt – om inte inställningen "övertalningsfrist" är på (av från början).
  //     Med fristen på börjar en övertalningsfrist (PERSUADE_SECONDS). Den som sa nej kan ändra sig
  //     ("Okej, jag är med") och då fortsätter omröstningen, eller avsluta direkt ("Nej, vi kör").
  //     Har ingen ändrat sig när tiden är ute blir det inga fler byten och spelet börjar.
  //     Tiden ägs av servern (src/turntimer.js), som anropar persuadeExpired().
  //  5. "Vi kör" (när ingen fråga är ute) räcker att en spelare trycker: spelet börjar direkt.
  //  6. Går turtimern ut för någon som ska svara räknas det som nej (och fristen startar).
  // Motståndarnas synliga kort visas inte i efterhand – man får själv komma ihåg dem (Alfred 2026-11-08).
  // Att slå (Alfred 2026-11-07): lika många kort av samma valör, samma eller högre → tar styret.
  // Lika många kort som alla är samma eller högre men olika valör → "lägger över", tar inte styret.
  // Kan man lägga över (på något av sätten) måste man; annars läggs de lägsta korten.
};

const PERSUADE_SECONDS = 10; // övertalningsfristen när någon säger nej till extra byte

function rankName(r) { return RANK_NAMES[r] || String(r); }
function cardValue(c) { return c.rank; }

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeDeck() {
  const cards = [];
  for (let d = 0; d < 2; d++)
    for (const s of SUITS)
      for (let r = 2; r <= 14; r++) cards.push({ id: `${s}${r}-${d}`, rank: r, suit: s });
  return shuffle(cards);
}

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

class Game {
  /** players: [{id, name}] i sittordning (medurs). */
  constructor(players, { multiplier = 2, extraExchanges = true, persuade = false } = {}) {
    if (players.length < 2 || players.length > 6) fail('Gursch spelas av 2–6 spelare.');
    // Multiplikatorn är antingen ett fast tal eller bestäms av utdelningen (Alfred 2026-11-08):
    // 'highest' = värdet på det högsta synliga kortet, 'second' = det näst högsta synliga kortet.
    this.multiplierMode = multiplier === 'highest' || multiplier === 'second' ? multiplier : 'fixed';
    this.multiplier = this.multiplierMode === 'fixed' ? multiplier : null;
    this.extraExchanges = extraExchanges; // inställning: får man fråga om fler byten efter runda 2?
    this.persuade = !!persuade; // inställning (av från början): övertalningsfrist när någon säger nej
    this.players = players.map((p) => ({ id: p.id, name: p.name, hand: [], publicIds: new Set(), participated: [null, null] }));
    this.proposalSeq = 0; // numrerar frågorna om extra byte
    this.deck = makeDeck();
    this.discard = [];
    this.setAside = [];
    this.history = [];
    this.events = []; // händelser för klienten (t.ex. "tog över styret")
    this.seq = 0;
    this.phase = 'exchange';
    this.leader = 0;
    this.deal();
    this.startExchangeRound(1);
    this.checkInvariant();
  }

  // ---------- hjälpare ----------
  idx(pid) { const i = this.players.findIndex((p) => p.id === pid); if (i < 0) fail('Okänd spelare.'); return i; }
  name(i) { return this.players[i].name; }
  log(text, type = 'info') { this.history.push({ n: this.history.length + 1, text, type }); }
  event(type, data) { this.events.push({ seq: ++this.seq, type, ...data }); }

  draw() {
    if (this.deck.length === 0) {
      if (this.discard.length === 0) fail('Kortleken är slut.');
      this.deck = shuffle(this.discard);
      this.discard = [];
      this.log('Kortleken tog slut – slänghögen blandades till en ny kortlek.');
    }
    return this.deck.pop();
  }

  removeFromHand(i, ids) {
    const p = this.players[i];
    if (!Array.isArray(ids)) fail('Ogiltiga kort.');
    if (new Set(ids).size !== ids.length) fail('Samma kort valt flera gånger.');
    const cards = ids.map((id) => p.hand.find((c) => c.id === id) || fail('Du har inte det kortet.'));
    p.hand = p.hand.filter((c) => !ids.includes(c.id));
    ids.forEach((id) => p.publicIds.delete(id));
    return cards;
  }

  sortHand(p) { p.hand.sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit)); }

  checkInvariant() {
    const all = [...this.deck, ...this.discard, ...this.setAside, ...this.players.flatMap((p) => p.hand),
      ...(this.exchange ? Object.values(this.exchange.offers).flat() : [])];
    const ids = new Set(all.map((c) => c.id));
    if (all.length !== 104 || ids.size !== 104) throw new Error(`Kortfel: ${all.length} kort, ${ids.size} unika`);
  }

  // ---------- utdelning ----------
  deal() {
    for (let k = 0; k < 5; k++) for (const p of this.players) p.hand.push(this.draw());
    const reveal = this.players.map(() => []);
    this.players.forEach((p, i) => { const c = this.draw(); p.hand.push(c); p.publicIds.add(c.id); reveal[i].push(c); });
    this.log('Korten är utdelade. Varje spelare har fått fem dolda kort och ett synligt.');

    let candidates = this.players.map((_, i) => i);
    let values = candidates.map((i) => reveal[i][0].rank);
    for (;;) {
      const max = Math.max(...values);
      const tied = candidates.filter((_, k) => values[k] === max);
      if (tied.length === 1) { this.leader = tied[0]; break; }
      this.log(`Lika högsta kort (${rankName(max)}) mellan ${tied.map((i) => this.name(i)).join(', ')} – ett nytt kort läggs ut.`);
      candidates = tied;
      values = tied.map((i) => { const c = this.draw(); reveal[i].push(c); this.setAside.push(c); return c.rank; });
    }
    this.dealReveal = reveal.map((cards, i) => ({ playerId: this.players[i].id, cards }));
    if (this.multiplierMode !== 'fixed') {
      const ranks = reveal.map((cards) => cards[0].rank).sort((a, b) => b - a);
      this.multiplier = this.multiplierMode === 'highest' ? ranks[0] : ranks[1];
      this.log(`Multiplikatorn blir ×${this.multiplier} (${this.multiplierMode === 'highest' ? 'högsta' : 'näst högsta'} synliga kortet).`);
    }
    for (const p of this.players) this.sortHand(p);
    this.log(`${this.name(this.leader)} har högst kort och blir styrspelare.`, 'leader');
    this.event('leader', { playerId: this.players[this.leader].id, reason: 'deal' });
  }

  // ---------- inledningsfasen ----------
  // Bytesrunda 1 och 2 styrs av styrspelaren. Därefter kan extra bytesrundor
  // föreslås av vem som helst, men de blir bara av om alla är med.
  startExchangeRound(round) {
    this.exchange = { round, step: 'leader', leaderCount: null, decisions: {}, pending: {}, offers: {}, proposal: null };
    this.log(`Bytesrunda ${round}: ${this.name(this.leader)} väljer hur många kort som ska slängas.`);
  }

  eligibleOthers() {
    const r = this.exchange.round;
    return this.players.map((_, i) => i).filter((i) => i !== this.leader && (r === 1 || this.players[i].participated[0] === true));
  }

  exchangeLeader(pid, cardIds) {
    const i = this.idx(pid), ex = this.exchange;
    if (this.phase !== 'exchange' || ex.step !== 'leader') fail('Det är inte dags för det valet nu.');
    if (i !== this.leader) fail('Endast styrspelaren väljer antal kort.');
    if (!Array.isArray(cardIds) || cardIds.length > 6) fail('Välj 0–6 kort.');
    const cards = this.removeFromHand(i, cardIds);
    this.discard.push(...cards);
    ex.leaderCount = cards.length;
    ex.pending[pid] = cards.length;
    this.players[i].participated[ex.round - 1] = cards.length > 0;
    this.log(`${this.name(i)} slänger ${cards.length} kort.`);
    const others = this.eligibleOthers();
    if (others.length === 0) return this.startReplacements();
    ex.step = 'others';
    others.forEach((k) => { ex.decisions[this.players[k].id] = null; });
  }

  exchangeOther(pid, discard, cardIds) {
    const i = this.idx(pid), ex = this.exchange;
    if (this.phase !== 'exchange' || ex.step !== 'others') fail('Det är inte dags för det valet nu.');
    if (!(pid in ex.decisions)) fail(ex.round === 2 ? 'Du behöll dina kort i första rundan och får inte byta nu.' : 'Du kan inte välja nu.');
    if (ex.decisions[pid] !== null) fail('Du har redan valt.');
    const p = this.players[i];
    let count = 0;
    if (discard) {
      const ids = ex.leaderCount === 0 ? p.hand.map((c) => c.id) : cardIds;
      if (ex.leaderCount > 0 && (!Array.isArray(ids) || ids.length !== ex.leaderCount))
        fail(`Du måste välja exakt ${ex.leaderCount} kort.`);
      const cards = this.removeFromHand(i, ids);
      this.discard.push(...cards);
      count = cards.length;
    }
    ex.decisions[pid] = !!discard;
    ex.pending[pid] = count;
    p.participated[ex.round - 1] = !!discard;
    this.log(discard ? `${this.name(i)} slänger ${count} kort.` : `${this.name(i)} behåller sina kort.`);
    if (Object.values(ex.decisions).every((d) => d !== null)) this.startReplacements();
  }

  // Ersättningskorten delas ut en spelare i taget, med början hos styrspelaren och sedan medurs.
  // Spelaren får alla sina kort på en gång med framsidan upp och väljer innan nästa spelare får sina.
  startReplacements() {
    const ex = this.exchange;
    ex.step = 'replace';
    const n = this.players.length;
    ex.replaceQueue = [];
    for (let k = 0; k < n; k++) {
      const pid = this.players[(this.leader + k) % n].id;
      if (ex.pending[pid] > 0) ex.replaceQueue.push(pid);
    }
    this.dealNextOffer();
  }

  dealNextOffer() {
    const ex = this.exchange;
    const pid = ex.replaceQueue.shift();
    if (!pid) return this.maybeFinishExchange();
    ex.offers[pid] = Array.from({ length: ex.pending[pid] }, () => this.draw());
    this.event('offer', { playerId: pid, count: ex.offers[pid].length });
  }

  // Behåll alla synliga kort, eller avstå från alla och få lika många dolda.
  exchangeReplace(pid, keep) {
    const i = this.idx(pid), ex = this.exchange;
    if (this.phase !== 'exchange' || ex.step !== 'replace' || !ex.offers[pid]) fail('Du har inga ersättningskort att välja.');
    const p = this.players[i];
    const offer = ex.offers[pid];
    delete ex.offers[pid];
    if (keep) {
      for (const c of offer) { p.hand.push(c); p.publicIds.add(c.id); }
      this.log(`${this.name(i)} behåller de synliga korten: ${offer.map((c) => rankName(c.rank)).join(', ')}.`);
    } else {
      this.discard.push(...offer);
      for (let k = 0; k < offer.length; k++) p.hand.push(this.draw());
      this.log(`${this.name(i)} avstår från ${offer.map((c) => rankName(c.rank)).join(', ')} och tar ${offer.length} dolda kort.`);
      this.event('hidden', { playerId: pid, count: offer.length });
    }
    this.sortHand(p);
    ex.pending[pid] = 0;
    this.dealNextOffer();
  }

  maybeFinishExchange() {
    const ex = this.exchange;
    if (Object.keys(ex.offers).length > 0) return;
    for (const p of this.players) if (p.hand.length !== 6) throw new Error('Fel antal kort efter byte');
    if (ex.round === 1) return this.startExchangeRound(2);
    if (!this.extraExchanges) return this.startPlay();
    this.startExtra(ex.round + 1);
  }

  startExtra(round) {
    this.exchange = { round, step: 'extra', leaderCount: null, decisions: {}, pending: {}, offers: {}, proposal: null };
    this.log(round === 3 ? 'Extra byte: vem som helst kan fråga om alla ska slänga 1–6 kort. Annars – tryck "Vi kör".'
      : 'Vill någon byta igen? Fråga, eller tryck "Vi kör".');
  }

  // Fråga om alla ska slänga `count` kort. Den som frågar räknas som ja.
  exchangePropose(pid, count) {
    const i = this.idx(pid), ex = this.exchange;
    if (this.phase !== 'exchange' || ex.step !== 'extra') fail('Det går inte att fråga om byte nu.');
    if (ex.proposal) fail('Det finns redan en fråga att svara på.');
    count = Math.round(Number(count));
    if (!(count >= 1 && count <= 6)) fail('Välj 1–6 kort.');
    ex.proposal = { id: ++this.proposalSeq, by: pid, count, votes: Object.fromEntries(this.players.map((p) => [p.id, p.id === pid ? true : null])), persuading: false };
    this.log(`${this.name(i)} frågar: ska alla slänga ${count} kort?`);
  }

  requireProposal() {
    const ex = this.exchange;
    if (this.phase !== 'exchange' || !ex || ex.step !== 'extra' || !ex.proposal) fail('Det finns ingen fråga att svara på.');
    return ex.proposal;
  }

  exchangeVote(pid, yes) {
    const i = this.idx(pid), P = this.requireProposal();
    if (P.votes[pid] !== null) fail('Du har redan svarat.');
    P.votes[pid] = !!yes;
    if (!yes) {
      if (!this.persuade) {
        // utan övertalningsfrist avslutar ett nej bytena direkt
        this.log(`${this.name(i)} säger nej. Inga fler byten.`);
        return this.startPlay();
      }
      this.log(`${this.name(i)} säger nej – övertala hen!`);
      this.event('holdout', { playerId: pid });
      P.persuading = true; // fristen startar (eller pågår redan)
      return;
    }
    this.log(`${this.name(i)} är med.`);
    this.settleVotes();
  }

  /** "Okej, jag är med": den som sa nej ändrar sig under fristen. */
  exchangeChangeMind(pid) {
    const i = this.idx(pid), P = this.requireProposal();
    if (P.votes[pid] !== false) fail('Du har inte sagt nej.');
    P.votes[pid] = true;
    this.log(`${this.name(i)} ändrar sig – är med!`);
    if (!Object.values(P.votes).includes(false)) P.persuading = false;
    this.settleVotes();
  }

  /** "Nej, vi kör": den som sa nej avslutar fristen direkt. */
  exchangeInsist(pid) {
    const i = this.idx(pid), P = this.requireProposal();
    if (P.votes[pid] !== false) fail('Du har inte sagt nej.');
    this.log(`${this.name(i)} står fast vid nej. Inga fler byten.`);
    this.startPlay();
  }

  /** Övertalningsfristen är slut (anropas av servern). proposalId skyddar mot en gammal timer. */
  persuadeExpired(proposalId = null) {
    const ex = this.exchange, P = ex && ex.proposal;
    if (this.phase !== 'exchange' || !P || !P.persuading || (proposalId != null && P.id !== proposalId)) return false;
    this.log('Ingen ändrade sig. Inga fler byten.');
    this.startPlay();
    this.checkInvariant();
    return true;
  }

  /** "Vi kör": räcker att en spelare trycker – räknas som nej till fler byten, utan frist. */
  exchangeGo(pid) {
    const i = this.idx(pid), ex = this.exchange;
    if (this.phase !== 'exchange' || ex.step !== 'extra') fail('Det går inte nu.');
    if (ex.proposal) fail('Svara på frågan först.');
    this.log(`${this.name(i)}: Vi kör!`);
    this.startPlay();
  }

  settleVotes() {
    const ex = this.exchange, P = ex.proposal;
    if (!Object.values(P.votes).every((v) => v === true)) return;
    this.log(`Alla är med – alla slänger ${P.count} kort.`);
    ex.step = 'extraDiscard';
    ex.leaderCount = P.count;
    ex.proposal = null;
    this.players.forEach((p) => { ex.decisions[p.id] = null; });
  }

  exchangeExtraDiscard(pid, cardIds) {
    const i = this.idx(pid), ex = this.exchange;
    if (this.phase !== 'exchange' || ex.step !== 'extraDiscard') fail('Det är inte dags att slänga nu.');
    if (ex.decisions[pid] !== null) fail('Du har redan slängt.');
    if (!Array.isArray(cardIds) || cardIds.length !== ex.leaderCount) fail(`Du måste välja exakt ${ex.leaderCount} kort.`);
    const cards = this.removeFromHand(i, cardIds);
    this.discard.push(...cards);
    ex.decisions[pid] = true;
    ex.pending[pid] = cards.length;
    if (Object.values(ex.decisions).every((d) => d !== null)) this.startReplacements();
  }

  startPlay() {
    this.exchange = null;
    this.phase = 'play';
    this.play = { leader: this.leader, nextLeader: this.leader, turn: this.leader, count: null, combo: null, table: [], lastTable: [], roundNo: 1 };
    this.log('Inledningsfasen är klar. Spelet börjar!');
    this.log(`Runda 1: ${this.name(this.leader)} startar.`);
  }

  // ---------- spelets gång ----------
  next(i) { return (i + 1) % this.players.length; }

  canBeat(i) {
    const pl = this.play;
    if (pl.count === null) return false;
    // Man kan lägga över om man har minst lika många kort som är samma eller högre valör.
    return this.players[i].hand.filter((c) => c.rank >= pl.combo.rank).length >= pl.count;
  }

  canTakeOver(i) {
    const pl = this.play;
    if (pl.count === null) return false;
    const counts = {};
    for (const c of this.players[i].hand) counts[c.rank] = (counts[c.rank] || 0) + 1;
    return Object.entries(counts).some(([r, n]) => Number(r) >= pl.combo.rank && n >= pl.count);
  }

  // Alfred 2026-11-07: rundan spelas alltid klart – alla lägger en gång, även om någon tar styret,
  // så att alla har lika många kort. Den som senast tog styret startar nästa runda.
  // Styrspelaren kan "gå ut" genom att lägga alla sina kort på en gång om de har samma valör; då är spelomgången slut
  // och var och en räknar ihop värdet av sina kort (den som gick ut: korten den gick ut med).
  playCards(pid, cardIds) {
    const i = this.idx(pid), pl = this.play;
    if (this.phase !== 'play') fail('Spelet pågår inte.');
    if (pl.turn !== i) fail('Det är inte din tur.');
    if (!Array.isArray(cardIds) || cardIds.length < 1) fail('Välj kort att lägga.');
    const hand = this.players[i].hand;
    const cards = cardIds.map((id) => hand.find((c) => c.id === id) || fail('Du har inte det kortet.'));
    if (new Set(cardIds).size !== cardIds.length) fail('Samma kort valt flera gånger.');
    const sameRank = cards.every((c) => c.rank === cards[0].rank);
    const rank = cards[0].rank;

    if (pl.count === null) {
      if (!sameRank) fail('Alla kort i en kombination måste ha samma valör.');
      if (cards.length === hand.length) return this.goOut(i, cards);
      this.removeFromHand(i, cardIds);
      this.discard.push(...cards);
      pl.count = cards.length;
      pl.combo = { rank, count: cards.length, by: pid };
      pl.nextLeader = i;
      pl.table = [{ by: pid, cards, type: 'lead' }];
      this.log(`${this.name(i)} lägger ${describe(cards)}. Rundan spelas med ${pl.count} kort.`, 'play');
      return this.advance(i);
    }

    if (cards.length !== pl.count) fail(`Rundan spelas med ${pl.count} kort – du måste lägga exakt ${pl.count}.`);
    if (cards.some((c) => c.rank < pl.combo.rank)) fail(`Alla kort måste vara ${rankName(pl.combo.rank)} eller högre.`);
    this.removeFromHand(i, cardIds);
    this.discard.push(...cards);
    if (!sameRank) {
      // lägger över med olika valörer: tar inte styret
      pl.table.push({ by: pid, cards, type: 'over' });
      this.log(`${this.name(i)} lägger över med ${describe(cards)}.`, 'play');
      return this.advance(i);
    }
    // samma valör, lika eller högre: tar styret – nästa spelare måste slå den nya kombinationen
    pl.table.push({ by: pid, cards, type: 'beat' });
    pl.combo = { rank, count: cards.length, by: pid };
    pl.nextLeader = i;
    this.log(`${this.name(i)} slår med ${describe(cards)} och tar över styret!`, 'leader');
    this.event('leader', { playerId: pid, reason: 'beat' });
    this.advance(i);
  }

  goOut(i, cards) {
    const p = this.players[i];
    this.removeFromHand(i, cards.map((c) => c.id));
    this.play.table = [{ by: p.id, cards, type: 'out' }];
    this.log(`${this.name(i)} går ut med ${describe(cards)}! Spelomgången är slut.`, 'end');
    this.event('out', { playerId: p.id });
    this.finish({ [p.id]: cards });
    this.discard.push(...cards);
  }

  dumpLowest(pid) {
    const i = this.idx(pid), pl = this.play;
    if (this.phase !== 'play') fail('Spelet pågår inte.');
    if (pl.turn !== i) fail('Det är inte din tur.');
    if (pl.count === null) fail('Du startar rundan – välj en kombination.');
    if (!RULES.mayDumpWhenCanBeat && this.canBeat(i)) fail('Du kan lägga över och måste därför göra det.');
    const p = this.players[i];
    const lowest = [...p.hand].sort((a, b) => a.rank - b.rank).slice(0, pl.count);
    this.removeFromHand(i, lowest.map((c) => c.id));
    this.discard.push(...lowest);
    pl.table.push({ by: pid, cards: lowest, type: 'dump' });
    this.log(`${this.name(i)} kan inte slå och lägger sina lägsta: ${describe(lowest)}.`, 'play');
    this.advance(i);
  }

  /** Turen går vidare medurs. Är vi tillbaka hos den som startade rundan är rundan slut. */
  advance(i) {
    const pl = this.play;
    pl.turn = this.next(i);
    if (pl.turn !== pl.leader) return;
    const nl = pl.nextLeader;
    if (nl === pl.leader) this.log(`Ingen tog styret. ${this.name(nl)} behåller det.`, 'leader');
    else this.log(`Rundan är slut. ${this.name(nl)} tog styret och startar nästa runda.`, 'leader');
    this.newRound(nl);
  }

  newRound(leaderIdx) {
    const pl = this.play;
    pl.lastTable = pl.table;
    pl.table = [];
    pl.count = null;
    pl.combo = null;
    pl.leader = leaderIdx;
    pl.nextLeader = leaderIdx;
    pl.turn = leaderIdx;
    pl.roundNo++;
    this.leader = leaderIdx;
    const sizes = new Set(this.players.map((p) => p.hand.length));
    if (sizes.size !== 1) throw new Error('Spelarna har olika många kort efter rundan');
    this.log(`Runda ${pl.roundNo}: ${this.name(leaderIdx)} startar och väljer antal kort.`);
  }

  /** outCards: korten den som gick ut lade – de räknas som dennes kort. */
  finish(outCards = {}) {
    this.phase = 'finished';
    const results = this.players.map((p) => {
      const cards = outCards[p.id] || p.hand;
      const value = cards.reduce((s, c) => s + cardValue(c), 0);
      return { playerId: p.id, name: p.name, hand: cards, wentOut: !!outCards[p.id], value, score: value * this.multiplier };
    });
    // Lägst vinner (flera med samma lägsta vinner tillsammans), högst förlorar
    // (flera med samma högsta förlorar tillsammans). Alla lika = oavgjort.
    const best = Math.min(...results.map((r) => r.score));
    const worst = Math.max(...results.map((r) => r.score));
    this.isDraw = best === worst;
    results.forEach((r) => { r.winner = !this.isDraw && r.score === best; r.loser = !this.isDraw && r.score === worst; });
    this.results = results.sort((a, b) => a.score - b.score);
  }

  /** Enda ingången för drag från klienter. */
  act(pid, a) {
    if (!a || typeof a !== 'object') fail('Ogiltigt drag.');
    switch (a.type) {
      case 'exchangeLeader': this.exchangeLeader(pid, a.cardIds); break;
      case 'exchangeOther': this.exchangeOther(pid, !!a.discard, a.cardIds); break;
      case 'exchangeReplace': this.exchangeReplace(pid, !!a.keep); break;
      case 'exchangePropose': this.exchangePropose(pid, a.count); break;
      case 'exchangeVote': this.exchangeVote(pid, !!a.yes); break;
      case 'exchangeChangeMind': this.exchangeChangeMind(pid); break;
      case 'exchangeInsist': this.exchangeInsist(pid); break;
      case 'exchangeGo': this.exchangeGo(pid); break;
      case 'exchangeExtraDiscard': this.exchangeExtraDiscard(pid, a.cardIds); break;
      case 'play': this.playCards(pid, a.cardIds); break;
      case 'dump': this.dumpLowest(pid); break;
      default: fail('Okänt drag.');
    }
    this.checkInvariant();
  }

  // ---------- vy per spelare (döljer privata kort) ----------
  viewFor(pid) {
    const me = this.players.findIndex((p) => p.id === pid);
    const ex = this.exchange, pl = this.play;
    const v = {
      phase: this.phase,
      multiplier: this.multiplier,
      multiplierMode: this.multiplierMode,
      leaderId: this.players[this.leader].id,
      deckCount: this.deck.length,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, handCount: p.hand.length,
      })),
      dealReveal: this.dealReveal,
      history: this.history.slice(-60),
      events: this.events.slice(-10),
    };
    if (me >= 0) {
      const p = this.players[me];
      v.me = { id: pid, hand: p.hand.map((c) => ({ ...c })), value: p.hand.reduce((s, c) => s + c.rank, 0) };
    }
    if (ex) {
      v.exchange = {
        round: ex.round, step: ex.step, leaderCount: ex.leaderCount,
        waitingFor: ex.step === 'others' || ex.step === 'extraDiscard' ? Object.keys(ex.decisions).filter((k) => ex.decisions[k] === null)
          : ex.step === 'replace' ? Object.keys(ex.offers)
            : ex.step === 'extra' ? (ex.proposal ? Object.keys(ex.proposal.votes).filter((k) => ex.proposal.votes[k] !== true)
              : this.players.map((p) => p.id))
              : [this.players[this.leader].id],
        proposal: ex.proposal,
        replaceQueue: ex.replaceQueue || [],
        persuadeSeconds: PERSUADE_SECONDS,
        offers: ex.offers, // synliga ersättningskort visas för alla
        pending: ex.pending,
        eligible: ex.step === 'others' ? Object.keys(ex.decisions) : this.eligibleOthers().map((k) => this.players[k].id),
        myDecision: ex.decisions[pid],
      };
    }
    if (pl) {
      v.play = {
        turnId: this.phase === 'play' ? this.players[pl.turn].id : null,
        count: pl.count, combo: pl.combo, table: pl.table, lastTable: pl.lastTable, roundNo: pl.roundNo,
        canBeat: me >= 0 && pl.turn === me ? this.canBeat(me) : false,
        canTakeOver: me >= 0 && pl.turn === me ? this.canTakeOver(me) : false,
        mayDumpWhenCanBeat: RULES.mayDumpWhenCanBeat,
      };
    }
    if (this.results) { v.results = this.results; v.isDraw = this.isDraw; }
    return v;
  }
}

function describe(cards) {
  const n = cards.length, r = rankName(cards[0].rank);
  if (n === 0) return 'inga kort';
  if (cards.some((c) => c.rank !== cards[0].rank)) return cards.map((c) => rankName(c.rank)).join(', ');
  const words = ['', 'en', 'två', 'tre', 'fyra', 'fem', 'sex'];
  return n === 1 ? `en ${r}` : `${words[n]} ${r}${r.match(/\d/) ? ':or' : 'ar'}`.replace('essar', 'ess').replace('damar', 'damer').replace('kungar', 'kungar');
}

module.exports = { Game, GameError, RULES, makeDeck, PERSUADE_SECONDS };
