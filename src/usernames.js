'use strict';
// Användarnamn: 3–16 tecken, bokstäver (även åäö), siffror, _ och -. Fula ord filtreras bort.
// Delas av servern (och kan användas i klienten för snabb återkoppling).
(function (root) {
  // Ord som räknas som fula även inuti ett namn (långa nog att inte ge falsklarm i vanliga namn).
  const ANYWHERE = ['kuk', 'fitta', 'fittor', 'knulla', 'knull', 'kukhuvud', 'neger', 'nigger', 'nigga', 'fuck', 'shit', 'cunt', 'bitch', 'whore',
    'faggot', 'retard', 'hitler', 'nazist', 'nazism', 'pedofil', 'pedophile', 'rapist', 'våldtäkt', 'valdtakt', 'jävla', 'javla', 'helvete',
    'horunge', 'blattejävel', 'blatte', 'svartskalle', 'kuksugare', 'dildo', 'porrfilm', 'porn', 'penis', 'vagina'];
  // Korta ord som bara räknas när de är hela namnet eller namnet börjar med dem plus högst två tecken
  // (så att t.ex. "Thora", "Horatio" och "Fanny" går bra). END-orden räknas också i slutet.
  const EDGES = ['kuk', 'hora', 'horor', 'fag', 'slut', 'nazi', 'sex', 'cum', 'tits', 'piss', 'kkk', 'porr', 'anal', 'mongo'];
  const END = ['kuk', 'nazi', 'slut'];
  const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i' };

  function normalize(name) {
    return String(name).toLowerCase()
      .replace(/[0-9@$!]/g, (c) => LEET[c] || c)
      .replace(/[^a-zåäöéü]/g, '')
      .replace(/(.)\1+/g, '$1'); // fuuuck → fuck
  }

  function isOffensive(name) {
    const n = normalize(name), plain = String(name).toLowerCase().replace(/[^a-zåäö0-9]/g, '');
    if (ANYWHERE.some((w) => n.includes(w.replace(/(.)\1+/g, '$1')) || plain.includes(w))) return true;
    return EDGES.some((w) => n === w || (n.startsWith(w) && n.length - w.length <= 2))
      || END.some((w) => n.endsWith(w) && n.length - w.length <= 3);
  }

  /** Returnerar { ok: true, username } eller { ok: false, error }. */
  function validateUsername(raw) {
    const u = String(raw || '').trim();
    if (u.length < 3) return { ok: false, error: 'Användarnamnet måste ha minst 3 tecken.' };
    if (u.length > 16) return { ok: false, error: 'Användarnamnet får ha högst 16 tecken.' };
    if (!/^[A-Za-zÅÄÖåäöÉéÜü0-9_-]+$/.test(u)) return { ok: false, error: 'Använd bara bokstäver, siffror, _ och -.' };
    if (!/[A-Za-zÅÄÖåäöÉéÜü]/.test(u)) return { ok: false, error: 'Användarnamnet måste innehålla minst en bokstav.' };
    if (isOffensive(u)) return { ok: false, error: 'Det användarnamnet är inte tillåtet – välj ett annat.' };
    return { ok: true, username: u };
  }

  const api = { validateUsername, isOffensive, normalize };
  if (typeof module !== 'undefined') module.exports = api;
  else root.GurschUsernames = api;
})(typeof window !== 'undefined' ? window : globalThis);
