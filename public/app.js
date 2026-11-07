'use strict';
/* Gursch klient. All spellogik finns på servern – klienten visar bara läget och skickar drag. */
const $ = (id) => document.getElementById(id);
const socket = window.GURSCH_LOCAL ? window.GURSCH_LOCAL() : io();
const store = {
  get: (k) => { try { return localStorage.getItem('gursch.' + k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem('gursch.' + k) : localStorage.setItem('gursch.' + k, v); } catch {} },
};
const setUrl = (u) => { if (window.GURSCH_LOCAL) return; try { history.replaceState(null, '', u); } catch {} };
let S = null;            // senaste läget från servern
let selected = new Set(); // valda kort-id
let seenSeq = 0;
let lastPileKey = '';
let historyOpen = false;

const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK = { 11: 'Kn', 12: 'D', 13: 'K', 14: 'E' };
const RANK_NAME = { 11: 'knekt', 12: 'dam', 13: 'kung', 14: 'ess' };
const rl = (r) => RANK[r] || String(r);
const rn = (r) => RANK_NAME[r] || String(r);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cardHTML(c, { cls = '', back = false, style = '' } = {}) {
  if (back || !c) return `<div class="card back ${cls}"></div>`;
  const red = c.suit === 'H' || c.suit === 'D' ? 'red' : '';
  return `<div class="card ${red} ${cls}" data-id="${c.id}"${style ? ` style="${style}"` : ''}>
    <span class="corner tl">${rl(c.rank)}<br>${SUIT[c.suit]}</span>
    <span class="pip">${SUIT[c.suit]}</span>
    <span class="corner br">${rl(c.rank)}<br>${SUIT[c.suit]}</span>
    ${c.public ? '<span class="eye" title="Synligt för alla">👁</span>' : ''}
  </div>`;
}

function show(screen) {
  for (const s of ['home', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== screen);
}
function toast(text, cls = '') {
  const t = $('toast');
  t.textContent = text; t.className = 'toast ' + cls;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 2600);
}
function send(type, payload = {}) {
  socket.emit('action', { type, ...payload }, (res) => {
    if (!res.ok) toast(res.error, 'bad');
    else selected.clear();
  });
}

// ---------- startsida ----------
$('name').value = store.get('name') || '';
const urlCode = new URLSearchParams(location.search).get('rum');
if (urlCode) $('code').value = urlCode.toUpperCase();

function enter(res) {
  if (!res.ok) { $('homeError').textContent = res.error; store.set('code', null); show('home'); return; }
  store.set('code', res.code); store.set('token', res.token);
  setUrl('?rum=' + res.code);
}
function needName() {
  const n = $('name').value.trim();
  if (!n) { $('homeError').textContent = 'Skriv ditt namn först.'; $('name').focus(); return null; }
  store.set('name', n); return n;
}
$('createBtn').onclick = () => { const name = needName(); if (name) socket.emit('create', { name }, enter); };
$('joinBtn').onclick = () => {
  const name = needName(); const code = $('code').value.trim().toUpperCase();
  if (!name) return;
  if (!code) { $('homeError').textContent = 'Skriv in en rumskod.'; return; }
  socket.emit('join', { name, code, token: store.get('code') === code ? store.get('token') : null }, enter);
};
$('code').addEventListener('keydown', (e) => e.key === 'Enter' && $('joinBtn').click());

// ---------- återanslutning ----------
socket.on('connect', () => {
  $('conn').classList.add('hidden');
  const code = store.get('code'), token = store.get('token');
  if (code && token) socket.emit('join', { code, token }, (res) => { if (!res.ok) { store.set('code', null); S = null; show('home'); } });
});
socket.on('disconnect', () => { $('conn').textContent = 'Anslutningen bröts – försöker igen…'; $('conn').classList.remove('hidden'); });

// ---------- lobby ----------
$('copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText($('inviteLink').value); toast('Länken är kopierad'); }
  catch { $('inviteLink').select(); }
};
$('readyBtn').onclick = () => { const me = S.lobby.players.find((p) => p.id === S.you); socket.emit('ready', !me.ready); };
$('startBtn').onclick = () => socket.emit('start', null, (r) => { $('lobbyError').textContent = r.ok ? '' : r.error; });
$('leaveBtn').onclick = () => { socket.emit('leave'); store.set('code', null); S = null; setUrl(location.pathname); show('home'); };
const pushSettings = () => socket.emit('settings', { maxPlayers: $('maxPlayers').value, multiplier: $('multiplier').value }, (r) => { if (!r.ok) $('lobbyError').textContent = r.error; });
$('maxPlayers').onchange = pushSettings;
$('multiplier').onchange = pushSettings;

function renderLobby() {
  const L = S.lobby, isHost = L.hostId === S.you;
  $('lobbyCode').textContent = L.code;
  $('inviteLink').value = `${location.origin}${location.pathname}?rum=${L.code}`;
  $('playerCount').textContent = `(${L.players.length}/${L.settings.maxPlayers})`;
  $('lobbyPlayers').innerHTML = L.players.map((p) => `<li>
      <span class="dot ${p.connected ? 'on' : ''}"></span>
      <span class="pname">${esc(p.name)}${p.id === S.you ? ' (du)' : ''}</span>
      ${p.id === L.hostId ? '<span class="badge">Värd</span>' : p.ready ? '<span class="badge ok">Redo</span>' : '<span class="badge muted">Väntar</span>'}
    </li>`).join('');
  $('maxPlayers').value = L.settings.maxPlayers; $('maxPlayers').disabled = !isHost;
  if (document.activeElement !== $('multiplier')) $('multiplier').value = L.settings.multiplier;
  $('multiplier').disabled = !isHost;
  const me = L.players.find((p) => p.id === S.you);
  $('readyBtn').classList.toggle('hidden', isHost);
  $('readyBtn').textContent = me && me.ready ? 'Inte redo' : 'Jag är redo';
  $('readyBtn').classList.toggle('primary', !(me && me.ready));
  $('startBtn').classList.toggle('hidden', !isHost);
  const notReady = L.players.filter((p) => !p.ready && p.id !== L.hostId).length;
  $('startBtn').disabled = L.players.length < 2 || notReady > 0;
  $('lobbyInfo').textContent = L.players.length < 2 ? 'Väntar på fler spelare… Dela rumskoden eller länken.'
    : notReady ? `Väntar på att ${notReady} spelare ska bli redo.` : isHost ? 'Alla är redo – starta när du vill!' : 'Väntar på att värden startar spelet.';
}

// ---------- spelbord ----------
$('historyBtn').onclick = () => { historyOpen = !historyOpen; $('history').classList.toggle('open', historyOpen); };
$('historyClose').onclick = () => { historyOpen = false; $('history').classList.remove('open'); };
$('hand').addEventListener('click', (e) => {
  const el = e.target.closest('.card'); if (!el || !el.dataset.id) return;
  const id = el.dataset.id;
  selected.has(id) ? selected.delete(id) : selected.add(id);
  renderGame();
});

const nameOf = (id) => (S.game.players.find((p) => p.id === id) || {}).name || '?';

function seatPositions(n) {
  // Jag sitter längst ner; nästa spelare (medurs) till vänster, osv.
  const pos = [];
  for (let k = 1; k < n; k++) {
    const a = Math.PI / 2 + (k * 2 * Math.PI) / n; // vinkel från botten, medurs på skärmen
    pos.push({ x: 50 + 44 * Math.cos(a), y: 50 + 40 * Math.sin(a) });
  }
  return pos;
}

function selectionInfo(G) {
  const hand = G.me.hand.filter((c) => selected.has(c.id));
  const sameRank = hand.length > 0 && hand.every((c) => c.rank === hand[0].rank);
  return { cards: hand, n: hand.length, sameRank, rank: sameRank ? hand[0].rank : null };
}

function renderGame() {
  const G = S.game;
  // ta bort val av kort som inte längre finns
  for (const id of [...selected]) if (!G.me.hand.some((c) => c.id === id)) selected.delete(id);
  const me = S.you, ex = G.exchange, pl = G.play;
  const myIdx = G.players.findIndex((p) => p.id === me);
  const order = G.players.slice(myIdx).concat(G.players.slice(0, myIdx));
  const others = order.slice(1);
  const pos = seatPositions(order.length);
  const lobbyPlayers = Object.fromEntries(S.lobby.players.map((p) => [p.id, p]));
  const turnId = pl && pl.turnId;
  const waiting = ex ? ex.waitingFor : [];

  $('gCode').textContent = S.lobby.code;
  $('seats').innerHTML = others.map((p, k) => {
    const lp = lobbyPlayers[p.id] || {};
    const isTurn = turnId === p.id || waiting.includes(p.id);
    const offer = ex && ex.offers[p.id];
    const vote = ex && ex.proposal ? ex.proposal.votes[p.id] : undefined;
    return `<div class="seat ${isTurn ? 'turn' : ''} ${G.leaderId === p.id ? 'leader' : ''}" data-pid="${p.id}" style="left:${pos[k].x}%;top:${pos[k].y}%">
      <div class="seat-name">${G.leaderId === p.id ? '<span class="crown" title="Styrspelare">♛</span>' : ''}${esc(p.name)}
        ${lp.connected ? '' : '<span class="badge bad">offline</span>'}</div>
      <div class="seat-cards">${Array.from({ length: p.handCount }, () => '<i></i>').join('')}<span>${p.handCount}</span></div>
      ${p.publicCards.length ? `<div class="seat-public">${p.publicCards.map((c) => cardHTML(c, { cls: 'mini' })).join('')}</div>` : ''}
      ${offer ? `<div class="seat-offer">Erbjuds ${offer.map((c) => cardHTML(c, { cls: 'mini' })).join('')}</div>` : ''}
      ${vote === true ? '<div class="seat-turn ok">Är med ✓</div>' : ''}
      ${ex && ex.step === 'extra' && !ex.proposal && ex.satisfied[p.id] ? '<div class="tiny muted">Nöjd</div>' : ''}
      ${isTurn ? `<div class="seat-turn">${pl ? 'Spelar…' : 'Väljer…'}</div>` : ''}
    </div>`;
  }).join('');

  // mitten av bordet
  let pileHTML = '', title = '';
  if (ex) {
    title = ex.round <= 2 ? `Inledningsfas · bytesrunda ${ex.round} av 2` : 'Inledningsfas · extra byte';
    pileHTML = `<div class="reveal">${G.dealReveal.map((r) => `<div class="reveal-col"><div class="tiny">${esc(nameOf(r.playerId))}</div>
      <div class="reveal-cards">${r.cards.map((c) => cardHTML(c, { cls: 'mini' })).join('')}</div></div>`).join('')}</div>
      <div class="tiny muted">Synliga kort vid utdelningen</div>`;
  } else if (pl) {
    const tbl = pl.table.length ? pl.table : pl.lastTable;
    title = pl.table.length ? `Runda ${pl.roundNo}` : `Runda ${pl.roundNo} – ${esc(nameOf(pl.turnId || G.leaderId))} väljer kombination`;
    const key = tbl.map((t) => t.cards.map((c) => c.id).join()).join('|');
    lastPileKey = key;
    pileHTML = `<div class="plays ${pl.table.length ? '' : 'old'}">${tbl.map((t, k) => `<div class="play ${t.type}" data-by="${t.by}" data-key="${t.cards.map((c) => c.id).join()}">
      <div class="play-cards">${t.cards.map((c) => cardHTML(c, { cls: 'small' })).join('')}</div>
      <div class="tiny">${esc(nameOf(t.by))}${t.type === 'lead' ? ' · startade' : t.type === 'beat' ? ' · tog styret' : t.type === 'over' ? ' · lade över' : t.type === 'out' ? ' · gick ut' : ' · lägsta'}</div>
    </div>`).join('')}</div>`;
  }
  $('centerTitle').innerHTML = title;
  $('pile').innerHTML = pileHTML;
  $('deckInfo').textContent = `Kortlek: ${G.deckCount} kort`;
  $('roundInfo').innerHTML = G.phase === 'finished' ? '' : (pl && pl.count
    ? `<span class="count-badge">${pl.count} kort</span> gäller · att slå: <strong>${pl.count} × ${rn(pl.combo.rank)}</strong> eller högre`
    : pl ? `<span class="count-badge">?</span> ${esc(nameOf(pl.turnId))} bestämmer antal kort`
      : ex ? `Styrspelare: <strong>${esc(nameOf(G.leaderId))}</strong>` : '');

  // min hand
  $('meName').innerHTML = `${G.leaderId === me ? '<span class="crown">♛</span> ' : ''}${esc(nameOf(me))}`;
  $('meValue').textContent = G.me.value;
  $('hand').innerHTML = G.me.hand.map((c) => cardHTML(c, { cls: selected.has(c.id) ? 'selected' : '' })).join('');
  $('history').querySelector('ol').innerHTML = G.history.map((h) => `<li class="${h.type}">${esc(h.text)}</li>`).reverse().join('');

  renderActions(G);
  animateChanges(G);

  // ny styrspelare – visa tydligt
  for (const ev of G.events) if (ev.seq > seenSeq) {
    seenSeq = ev.seq;
    if (ev.type === 'hidden') flyBacks(null, ev.playerId, ev.count);
    if (ev.type === 'out') toast(`${ev.playerId === me ? 'Du' : nameOf(ev.playerId)} gick ut!`, 'leader');
    if (ev.type === 'leader' && ev.reason === 'beat') toast(`${ev.playerId === me ? 'Du' : nameOf(ev.playerId)} tar över styret! ♛`, 'leader');
  }
  renderTally();
  renderDeal(G);
  renderResults(G);
}

const lowestTxt = (pron, n) => n === 1 ? `${pron === 'mina' ? 'mitt' : 'ditt'} lägsta kort` : `${pron} ${n} lägsta kort`;
function btn(label, onclick, cls = '', disabled = false) { return { label, onclick, cls, disabled }; }

function renderActions(G) {
  const me = S.you, ex = G.exchange, pl = G.play, sel = selectionInfo(G);
  let status = '', acts = [], offerHTML = '';
  if (ex) {
    if (ex.step === 'leader') {
      if (G.leaderId === me) {
        status = `Du är styrspelare. Välj de kort du vill slänga (0–6) i bytesrunda ${ex.round}.`;
        acts.push(btn(sel.n ? `Släng ${sel.n} kort` : 'Släng inga kort', () => send('exchangeLeader', { cardIds: [...selected] }), 'primary'));
      } else status = `${esc(nameOf(G.leaderId))} väljer hur många kort som slängs i bytesrunda ${ex.round}…`;
    } else if (ex.step === 'others') {
      const k = ex.leaderCount;
      if (ex.waitingFor.includes(me)) {
        if (k > 0) {
          status = `${esc(nameOf(G.leaderId))} slängde ${k} kort. Välj exakt ${k} kort att slänga, eller behåll alla.`;
          acts.push(btn(`Släng ${k} kort (${sel.n}/${k} valda)`, () => send('exchangeOther', { discard: true, cardIds: [...selected] }), 'primary', sel.n !== k));
        } else {
          status = `${esc(nameOf(G.leaderId))} slängde inga kort. Du kan slänga alla sex eller behålla alla.`;
          acts.push(btn('Släng alla sex', () => send('exchangeOther', { discard: true }), 'primary'));
        }
        acts.push(btn('Behåll alla', () => send('exchangeOther', { discard: false })));
      } else if (ex.round === 2 && !ex.eligible.includes(me) && G.leaderId !== me) {
        status = 'Du behöll dina kort i första rundan och får inte byta i andra rundan.';
      } else status = `Väntar på ${ex.waitingFor.map((id) => esc(nameOf(id))).join(', ')}…`;
    } else if (ex.step === 'replace') {
      const offer = ex.offers[me];
      if (offer) {
        const n = offer.length;
        status = n === 1 ? 'Ditt ersättningskort. Behåll det synliga kortet eller ta ett dolt istället.'
          : `Dina ${n} ersättningskort. Behåll alla synliga eller ta ${n} dolda istället.`;
        offerHTML = `<div class="offer-inner"><div class="offer-cards">${offer.map((c) => cardHTML(c)).join('')}</div><div class="tiny">Alla ser dessa kort</div></div>`;
        acts.push(btn(n === 1 ? 'Behåll kortet' : `Behåll alla ${n}`, () => send('exchangeReplace', { keep: true }), 'primary'));
        acts.push(btn(n === 1 ? 'Ta ett dolt kort' : `Ta ${n} dolda kort`, () => send('exchangeReplace', { keep: false })));
      } else status = `Väntar på att ${ex.waitingFor.map((id) => esc(nameOf(id))).join(', ')} väljer ersättningskort…`;
    } else if (ex.step === 'extra') {
      const P = ex.proposal;
      if (P) {
        const who = P.by === me ? 'Du' : esc(nameOf(P.by));
        if (P.votes[me] === null) {
          status = `${who} frågar om alla vill slänga ${P.count} kort till. Alla måste vara med – säger någon nej börjar spelet.`;
          acts.push(btn(`Ja, slänga ${P.count}`, () => send('exchangeVote', { yes: true }), 'primary'));
          acts.push(btn('Nej, börja spela', () => send('exchangeVote', { yes: false })));
        } else status = `${who} frågade om alla slänger ${P.count} kort. Väntar på svar från ${ex.waitingFor.map((id) => esc(nameOf(id))).join(', ')}…`;
      } else if (!ex.satisfied[me]) {
        status = 'Extra byte: vill du slänga fler kort kan du fråga de andra. Alla måste vara med. Annars börjar spelet när alla är nöjda.';
        for (let n = 1; n <= 6; n++) acts.push(btn(`Fråga: ${n}`, () => send('exchangePropose', { count: n }), 'small'));
        acts.push(btn('Nöjd – börja spela', () => send('exchangeSatisfied'), 'primary'));
      } else status = `Du är nöjd. Väntar på ${ex.waitingFor.map((id) => esc(nameOf(id))).join(', ')}…`;
    } else if (ex.step === 'extraDiscard') {
      const k = ex.leaderCount;
      if (ex.waitingFor.includes(me)) {
        status = `Alla var med! Välj exakt ${k} kort att slänga.`;
        acts.push(btn(`Släng ${k} kort (${sel.n}/${k} valda)`, () => send('exchangeExtraDiscard', { cardIds: [...selected] }), 'primary', sel.n !== k));
      } else status = `Väntar på ${ex.waitingFor.map((id) => esc(nameOf(id))).join(', ')}…`;
    }
  } else if (pl && G.phase === 'play') {
    if (pl.turnId === me) {
      if (pl.count === null) {
        const all = G.me.hand.length;
        const canOut = G.me.hand.every((c) => c.rank === G.me.hand[0].rank);
        status = `Du har styret! Lägg valfri kombination av samma valör – antalet gäller hela rundan.${canOut ? ` Du kan också gå ut: lägg alla dina ${all} kort så slutar spelomgången (värde ${G.me.value}).` : ''}`;
        const out = sel.n === all && sel.sameRank;
        const ok = sel.n > 0 && sel.sameRank;
        acts.push(btn(out ? `Gå ut med alla ${all} kort` : ok ? `Lägg ${sel.n} kort` : sel.n ? 'Korten måste ha samma valör' : 'Välj kort', () => send('play', { cardIds: [...selected] }), 'primary', !ok));
        if (canOut && !out) acts.push(btn(`Gå ut (värde ${G.me.value})`, () => send('play', { cardIds: G.me.hand.map((c) => c.id) })));
      } else {
        const need = pl.count, r = pl.combo.rank;
        const allHigh = sel.n === need && sel.cards.every((c) => c.rank >= r);
        const take = allHigh && sel.sameRank, over = allHigh && !sel.sameRank;
        status = pl.canBeat
          ? need === 1 ? `Din tur. Lägg ett kort som är ${rn(r)} eller högre – då tar du styret.`
            : `Din tur. Lägg ${need} kort som alla är ${rn(r)} eller högre. ${pl.canTakeOver ? `Samma valör tar styret, olika valörer lägger bara över.` : 'Du kan bara lägga över (olika valörer), inte ta styret.'}`
          : `Din tur. Du har inte ${need} kort som är ${rn(r)} eller högre och måste lägga ${lowestTxt('dina', need)}.`;
        let label = 'Välj kort';
        if (sel.n) label = sel.n !== need ? `Välj exakt ${need} kort` : take ? `Ta styret med ${sel.n} kort ♛` : over ? `Lägg över (${sel.n} kort)` : `Alla kort måste vara ${rn(r)} eller högre`;
        if (pl.canBeat) acts.push(btn(label, () => send('play', { cardIds: [...selected] }), 'primary', !allHigh));
        if (!pl.canBeat || pl.mayDumpWhenCanBeat) acts.push(btn(`Lägg ${lowestTxt('mina', need)}`, () => send('dump'), pl.canBeat ? '' : 'primary'));
      }
    } else status = `${esc(nameOf(pl.turnId))}s tur${pl.count === null ? ' att starta rundan' : ''}…`;
  } else if (G.phase === 'finished') status = 'Spelomgången är slut.';

  $('status').innerHTML = status;
  $('offer').innerHTML = offerHTML; $('offer').classList.toggle('hidden', !offerHTML);
  const box = $('actions'); box.innerHTML = '';
  for (const a of acts) {
    const b = document.createElement('button');
    b.className = 'btn ' + a.cls; b.textContent = a.label; b.disabled = a.disabled; b.onclick = a.onclick;
    box.appendChild(b);
  }
  const myTurn = acts.length > 0;
  $('hand').classList.toggle('active', myTurn && !offerHTML);
  document.title = myTurn ? '● Din tur – GURSCH' : 'GURSCH';
}

let dealShownFor = null;
function renderDeal(G) {
  const key = G.dealReveal.map((r) => r.cards.map((c) => c.id).join()).join('|');
  if (G.phase !== 'exchange' || dealShownFor === key || dealing) return;
  dealShownFor = key;
  const leader = G.leaderId;
  const rounds = Math.max(...G.dealReveal.map((r) => r.cards.length));
  $('dealBody').innerHTML = G.dealReveal.map((r) => `<div class="deal-row ${r.playerId === leader ? 'win' : ''}">
      <span class="deal-name">${r.playerId === leader ? '♛ ' : ''}${esc(nameOf(r.playerId))}${r.playerId === S.you ? ' (du)' : ''}</span>
      <span class="deal-cards">${r.cards.map((c, k) => cardHTML(c, { cls: 'small enter', style: `animation-delay:${(k * G.dealReveal.length) * 0.15}s` })).join('')}</span>
    </div>`).join('');
  $('dealInfo').innerHTML = `${rounds > 1 ? 'Det blev lika – extra kort lades ut tills någon hade högst. ' : ''}<strong>${leader === S.you ? 'Du' : esc(nameOf(leader))}</strong> har högst kort och styr inledningen.`;
  $('deal').classList.remove('hidden');
}
$('dealOk').onclick = () => { $('deal').classList.add('hidden'); socket.emit('animDone'); };

function renderResults(G) {
  const show = G.phase === 'finished';
  $('results').classList.toggle('hidden', !show);
  if (!show) return;
  $('resultsBody').innerHTML = G.results.map((r) => `<tr class="${r.winner ? 'winner' : r.loser ? 'loser' : ''}">
    <td>${r.winner ? '🏆' : r.loser ? '👎' : ''}</td><td>${esc(r.name)}${r.playerId === S.you ? ' (du)' : ''}${r.wentOut ? ' <span class="badge">gick ut</span>' : ''}</td>
    <td class="res-cards"><div>${r.hand.map((c) => cardHTML(c, { cls: 'mini' })).join('') || '–'}</div></td>
    <td>${r.value}</td><td><strong>${r.score}</strong></td></tr>`).join('');
  const winners = G.results.filter((r) => r.winner).map((r) => r.name);
  const losers = G.results.filter((r) => r.loser).map((r) => r.name);
  $('resultsMult').textContent = `Multiplikator ×${G.multiplier}. ` + (G.isDraw ? 'Oavgjort – alla fick samma poäng!'
    : `${winners.length > 1 ? 'Vinner tillsammans: ' : 'Vinnare: '}${winners.join(', ')}. ${losers.length > 1 ? 'Förlorar tillsammans: ' : 'Förlorare: '}${losers.join(', ')}.`);
  const isHost = S.lobby.hostId === S.you;
  $('againBtn').classList.toggle('hidden', !isHost);
  $('lobbyBtn').classList.toggle('hidden', !isHost);
  $('endBtn').classList.toggle('hidden', !isHost);
  $('resultsInfo').textContent = isHost ? '' : 'Väntar på att värden startar en ny omgång…';
}
$('againBtn').onclick = () => socket.emit('start', null, (r) => !r.ok && toast(r.error, 'bad'));
$('lobbyBtn').onclick = () => socket.emit('toLobby');
$('endBtn').onclick = () => socket.emit('endSession');
$('closeEndBtn').onclick = () => socket.emit('closeSession');
$('copyEndBtn').onclick = async () => {
  const t = $('endText');
  try { await navigator.clipboard.writeText(t.value); toast('Ställningen är kopierad'); }
  catch { t.focus(); t.select(); toast('Markerat – kopiera med Ctrl+C / Cmd+C'); }
};

socket.on('state', (state) => {
  const newGame = state.game && (!S || !S.game || S.game.history.length > state.game.history.length);
  if (newGame) { selected.clear(); seenSeq = Math.max(0, ...state.game.events.map((e) => e.seq)); lastPileKey = ''; resetAnim(); }
  S = state;
  renderEnd();
  if (S.game) {
    show('game');
    const G = S.game;
    const fresh = newGame && G.phase === 'exchange' && G.exchange.round === 1 && G.exchange.step === 'leader';
    if (fresh && !reduceMotion) startDealAnim();
    renderGame();
  }
  else { $('results').classList.add('hidden'); show('lobby'); renderLobby(); }
});

// ---------- animationer ----------
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let dealing = false;
let seenPlays = new Set(), prevHand = null, prevCounts = {}, seenOffers = new Set();
function resetAnim() { seenPlays = new Set(); prevHand = null; prevCounts = {}; seenOffers = new Set(); }

const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
function seatEl(pid) { return pid === S.you ? $('hand') : document.querySelector(`.seat[data-pid="${pid}"]`); }

/** Låter en kort-klon flyga mellan två element. */
function fly(fromEl, toEl, html, delay = 0, dur = 420) {
  if (!fromEl || !toEl || reduceMotion) return;
  const a = center(fromEl), b = center(toEl);
  const el = document.createElement('div');
  el.className = 'fly';
  el.innerHTML = html;
  el.style.left = a.x + 'px'; el.style.top = a.y + 'px';
  el.style.transition = `transform ${dur}ms cubic-bezier(.3,.8,.3,1) ${delay}ms, opacity 200ms ease ${delay + dur}ms`;
  $('fx').appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transform = `translate(${b.x - a.x}px, ${b.y - a.y}px) rotate(${(Math.random() - .5) * 16}deg)`;
    el.style.opacity = '0';
  }));
  setTimeout(() => el.remove(), delay + dur + 260);
}
const BACK = '<div class="card back small"></div>';
function flyBacks(fromPid, toPid, n, delay = 0) {
  const from = fromPid ? seatEl(fromPid) : $('deckPile'), to = toPid ? seatEl(toPid) : $('deckPile');
  for (let k = 0; k < n; k++) fly(from, to, BACK, delay + k * 110);
}
/** Ger ett element en start-förskjutning så att det "kommer från" ett annat element. */
function arriveFrom(el, fromEl, delay = 0) {
  if (!el || !fromEl || reduceMotion) return;
  const a = center(fromEl), b = center(el);
  el.style.setProperty('--fx', `${a.x - b.x}px`); el.style.setProperty('--fy', `${a.y - b.y}px`);
  el.style.animationDelay = `${delay}ms`;
  el.classList.add('arrive');
}

function animateChanges(G) {
  if (dealing) return;
  const deck = $('deckPile');
  // lagda kort flyger från spelaren till bordet
  document.querySelectorAll('#pile .play').forEach((el) => {
    const key = el.dataset.key;
    if (seenPlays.has(key)) return;
    seenPlays.add(key);
    if (prevHand !== null) arriveFrom(el, seatEl(el.dataset.by));
  });
  // ersättningskort med framsidan upp kommer från kortleken
  const ex = G.exchange;
  if (ex) for (const [pid, cards] of Object.entries(ex.offers)) {
    const key = cards.map((c) => c.id).join();
    if (seenOffers.has(key)) continue;
    seenOffers.add(key);
    const els = pid === S.you ? document.querySelectorAll('#offer .card') : document.querySelectorAll(`.seat[data-pid="${pid}"] .seat-offer .card`);
    els.forEach((el, k) => arriveFrom(el, deck, k * 140));
  }
  // slängda kort flyger till kortleken (under bytet)
  if (G.phase === 'exchange') for (const p of G.players) {
    const before = prevCounts[p.id];
    if (before !== undefined && p.handCount < before) flyBacks(p.id, null, before - p.handCount);
  }
  prevCounts = Object.fromEntries(G.players.map((p) => [p.id, p.handCount]));
  // nya kort i min hand kommer från kortleken
  const ids = G.me.hand.map((c) => c.id);
  if (prevHand !== null) {
    let k = 0;
    document.querySelectorAll('#hand .card').forEach((el) => { if (!prevHand.includes(el.dataset.id)) arriveFrom(el, deck, 200 + 110 * k++); });
  }
  prevHand = ids;
}

/** Utdelning i början: fem dolda kort runt bordet, sedan ett öppet, sedan eventuella avgörandekort. */
function startDealAnim() {
  dealing = true;
  $('game').classList.add('dealing');
  requestAnimationFrame(() => {
    const G = S.game, n = G.players.length, deck = $('deckPile');
    const reveal = Object.fromEntries(G.dealReveal.map((r) => [r.playerId, r.cards]));
    const step = 95;
    let t = 300;
    for (let r = 0; r < 6; r++) for (const p of G.players) {
      const html = r < 5 ? BACK : cardHTML(reveal[p.id][0], { cls: 'small' });
      fly(deck, seatEl(p.id), html, t, 380);
      t += r < 5 ? step : step * 2.5;
    }
    const extra = Math.max(...G.dealReveal.map((r) => r.cards.length));
    for (let e = 1; e < extra; e++) {
      t += 500;
      for (const p of G.players) if (reveal[p.id][e]) { fly(deck, seatEl(p.id), cardHTML(reveal[p.id][e], { cls: 'small' }), t, 420); t += step * 3; }
    }
    setTimeout(() => {
      dealing = false;
      $('game').classList.remove('dealing');
      resetAnim();
      if (S && S.game) renderGame();
    }, t + 500);
  });
}

// ---------- poängtavla ----------
const T = window.GurschTally;
const signed = (n) => `<span class="${n > 0 ? 'plus' : n < 0 ? 'minus' : ''}">${T.sign(n)}</span>`;
function renderTally() {
  const tally = S.lobby.tally, me = S.you, box = $('tally');
  if (!tally || !tally.rounds.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const others = Object.keys(tally.names).filter((id) => id !== me);
  const total = others.reduce((s, o) => s + T.versus(tally, me, o), 0);
  box.innerHTML = `<div class="tally-head">Ställning · ${tally.rounds.length} omg.</div>
    ${others.map((o) => `<div class="tally-row"><span>${esc(tally.names[o])}</span>${signed(T.versus(tally, me, o))}</div>`).join('')}
    <div class="tally-row total"><span>Totalt</span>${signed(total)}</div>`;
}
function renderEnd() {
  const L = S && S.lobby, show = !!(L && L.ended);
  $('endScreen').classList.toggle('hidden', !show);
  if (!show) return;
  $('results').classList.add('hidden');
  const tally = L.tally, tot = T.totals(tally), isHost = L.hostId === S.you;
  $('endInfo').textContent = `${tally.rounds.length} omgång${tally.rounds.length === 1 ? '' : 'ar'} spelade.`;
  const best = tot.length ? tot[0].total : 0;
  $('endBody').innerHTML = tot.map((t) => `<tr class="${t.total === best ? 'winner' : ''}"><td>${t.total === best ? '🏆' : ''}</td>
    <td>${esc(t.name)}${t.playerId === S.you ? ' (du)' : ''}</td><td>${t.rounds}</td><td><strong>${t.total}</strong></td><td>${signed(t.net)}</td></tr>`).join('');
  $('endMatrix').innerHTML = `<tr><th></th>${tot.map((t) => `<th>${esc(t.name)}</th>`).join('')}</tr>` +
    tot.map((a) => `<tr><th>${esc(a.name)}</th>${tot.map((b) => `<td>${a === b ? '–' : signed(T.versus(tally, a.playerId, b.playerId))}</td>`).join('')}</tr>`).join('');
  $('endText').value = T.summaryText(tally);
  $('closeEndBtn').classList.toggle('hidden', !isHost);
  $('endWait').textContent = isHost ? 'Tillbaka till rummet nollställer ställningen.' : 'Värden avslutar och går tillbaka till rummet.';
}
