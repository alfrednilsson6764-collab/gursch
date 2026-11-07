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

function cardHTML(c, { cls = '', back = false } = {}) {
  if (back || !c) return `<div class="card back ${cls}"></div>`;
  const red = c.suit === 'H' || c.suit === 'D' ? 'red' : '';
  return `<div class="card ${red} ${cls}" data-id="${c.id}">
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
    return `<div class="seat ${isTurn ? 'turn' : ''} ${G.leaderId === p.id ? 'leader' : ''}" style="left:${pos[k].x}%;top:${pos[k].y}%">
      <div class="seat-name">${G.leaderId === p.id ? '<span class="crown" title="Styrspelare">♛</span>' : ''}${esc(p.name)}
        ${lp.connected ? '' : '<span class="badge bad">offline</span>'}</div>
      <div class="seat-cards">${Array.from({ length: p.handCount }, () => '<i></i>').join('')}<span>${p.handCount}</span></div>
      ${p.publicCards.length ? `<div class="seat-public">${p.publicCards.map((c) => cardHTML(c, { cls: 'mini' })).join('')}</div>` : ''}
      ${offer ? `<div class="seat-offer">Erbjuds ${cardHTML(offer, { cls: 'mini' })}</div>` : ''}
      ${isTurn ? `<div class="seat-turn">${pl ? 'Spelar…' : 'Väljer…'}</div>` : ''}
    </div>`;
  }).join('');

  // mitten av bordet
  let pileHTML = '', title = '';
  if (ex) {
    title = `Inledningsfas · bytesrunda ${ex.round} av 2`;
    pileHTML = `<div class="reveal">${G.dealReveal.map((r) => `<div class="reveal-col"><div class="tiny">${esc(nameOf(r.playerId))}</div>
      <div class="reveal-cards">${r.cards.map((c) => cardHTML(c, { cls: 'mini' })).join('')}</div></div>`).join('')}</div>
      <div class="tiny muted">Synliga kort vid utdelningen</div>`;
  } else if (pl) {
    const tbl = pl.table.length ? pl.table : pl.lastTable;
    title = pl.table.length ? `Runda ${pl.roundNo}` : `Runda ${pl.roundNo} – ${esc(nameOf(pl.turnId || G.leaderId))} väljer kombination`;
    const key = tbl.map((t) => t.cards.map((c) => c.id).join()).join('|');
    const fresh = key !== lastPileKey; lastPileKey = key;
    pileHTML = `<div class="plays ${pl.table.length ? '' : 'old'}">${tbl.map((t, k) => `<div class="play ${t.type} ${fresh && k === tbl.length - 1 ? 'enter' : ''}">
      <div class="play-cards">${t.cards.map((c) => cardHTML(c, { cls: 'small' })).join('')}</div>
      <div class="tiny">${esc(nameOf(t.by))}${t.type === 'lead' ? ' · startade' : t.type === 'beat' ? ' · tog styret' : ' · lägsta'}</div>
    </div>`).join('')}</div>`;
  }
  $('centerTitle').innerHTML = title;
  $('pile').innerHTML = pileHTML;
  $('deckInfo').textContent = `Kortlek: ${G.deckCount} kort`;
  $('roundInfo').innerHTML = (pl && pl.lastRound ? '<span class="count-badge last">Sista rundan</span> ' : '') + (pl && pl.count
    ? `<span class="count-badge">${pl.count} kort</span> gäller · att slå: <strong>${pl.count} × ${rn(pl.combo.rank)}</strong> eller högre`
    : pl ? `<span class="count-badge">?</span> ${esc(nameOf(pl.turnId))} bestämmer antal kort`
      : ex ? `Styrspelare: <strong>${esc(nameOf(G.leaderId))}</strong>` : '');

  // min hand
  $('meName').innerHTML = `${G.leaderId === me ? '<span class="crown">♛</span> ' : ''}${esc(nameOf(me))}`;
  $('meValue').textContent = G.me.value;
  $('hand').innerHTML = G.me.hand.map((c) => cardHTML(c, { cls: selected.has(c.id) ? 'selected' : '' })).join('');
  $('history').querySelector('ol').innerHTML = G.history.map((h) => `<li class="${h.type}">${esc(h.text)}</li>`).reverse().join('');

  renderActions(G);

  // ny styrspelare – visa tydligt
  for (const ev of G.events) if (ev.seq > seenSeq) {
    seenSeq = ev.seq;
    if (ev.type === 'lastRound') toast(`${ev.playerId === me ? 'Du' : nameOf(ev.playerId)} har slut på kort – sista rundan!`, 'leader');
    if (ev.type === 'leader' && ev.reason === 'beat') toast(`${ev.playerId === me ? 'Du' : nameOf(ev.playerId)} tar över styret! ♛`, 'leader');
  }
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
        status = `Ersättningskort (${ex.pending[me]} kvar). Behåll det synliga kortet eller ta ett dolt istället.`;
        offerHTML = `<div class="offer-inner">${cardHTML(offer, { cls: 'big enter' })}<div class="tiny">Alla ser detta kort</div></div>`;
        acts.push(btn('Behåll kortet', () => send('exchangeReplace', { keep: true }), 'primary'));
        acts.push(btn('Ta ett dolt kort', () => send('exchangeReplace', { keep: false })));
      } else status = `Väntar på att ${ex.waitingFor.map((id) => esc(nameOf(id))).join(', ')} väljer ersättningskort…`;
    }
  } else if (pl && G.phase === 'play') {
    if (pl.turnId === me) {
      if (pl.count === null) {
        status = 'Du har styret! Lägg valfri kombination (1–6 kort av samma valör). Antalet gäller hela rundan.';
        const ok = sel.n > 0 && sel.sameRank;
        acts.push(btn(ok ? `Lägg ${sel.n} kort` : sel.n ? 'Korten måste ha samma valör' : 'Välj kort', () => send('play', { cardIds: [...selected] }), 'primary', !ok));
      } else {
        const need = pl.count, r = pl.combo.rank;
        const ok = sel.n === need && sel.sameRank && sel.rank >= r;
        status = pl.canBeat
          ? `Din tur. Du kan slå och måste göra det: lägg ${need} × ${rn(r)} eller högre.`
          : `Din tur. Du kan inte slå ${need} × ${rn(r)} och måste lägga ${lowestTxt('dina', need)}.`;
        let why = 'Välj kort';
        if (sel.n) why = sel.n !== need ? `Välj exakt ${need} kort` : !sel.sameRank ? 'Samma valör krävs' : sel.rank < r ? `Minst ${rn(r)} krävs` : '';
        if (pl.canBeat) acts.push(btn(ok ? `Slå med ${sel.n} kort` : why, () => send('play', { cardIds: [...selected] }), 'primary', !ok));
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

function renderResults(G) {
  const show = G.phase === 'finished';
  $('results').classList.toggle('hidden', !show);
  if (!show) return;
  $('resultsBody').innerHTML = G.results.map((r) => `<tr class="${r.winner ? 'winner' : r.loser ? 'loser' : ''}">
    <td>${r.winner ? '🏆' : r.loser ? '👎' : ''}</td><td>${esc(r.name)}${r.playerId === S.you ? ' (du)' : ''}</td>
    <td class="res-cards"><div>${r.hand.map((c) => cardHTML(c, { cls: 'mini' })).join('') || '–'}</div></td>
    <td>${r.value}</td><td><strong>${r.score}</strong></td></tr>`).join('');
  const winners = G.results.filter((r) => r.winner).map((r) => r.name);
  const losers = G.results.filter((r) => r.loser).map((r) => r.name);
  $('resultsMult').textContent = `Multiplikator ×${G.multiplier}. ` + (G.isDraw ? 'Oavgjort – alla fick samma poäng!'
    : `${winners.length > 1 ? 'Vinner tillsammans: ' : 'Vinnare: '}${winners.join(', ')}. ${losers.length > 1 ? 'Förlorar tillsammans: ' : 'Förlorare: '}${losers.join(', ')}.`);
  const isHost = S.lobby.hostId === S.you;
  $('againBtn').classList.toggle('hidden', !isHost);
  $('lobbyBtn').classList.toggle('hidden', !isHost);
  $('resultsInfo').textContent = isHost ? '' : 'Väntar på att värden startar en ny omgång…';
}
$('againBtn').onclick = () => socket.emit('start', null, (r) => !r.ok && toast(r.error, 'bad'));
$('lobbyBtn').onclick = () => socket.emit('toLobby');

socket.on('state', (state) => {
  const newGame = state.game && (!S || !S.game || S.game.history.length > state.game.history.length);
  if (newGame) { selected.clear(); seenSeq = Math.max(0, ...state.game.events.map((e) => e.seq)); lastPileKey = ''; }
  S = state;
  if (S.game) { show('game'); renderGame(); }
  else { $('results').classList.add('hidden'); show('lobby'); renderLobby(); }
});
