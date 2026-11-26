// Tillfällig vy för delar som inte är byggda än.
import { esc } from "../hjalp.js";

export function visaKommerSnart(el, rubrik, text) {
  el.innerHTML = `
    <header class="sidhuvud">
      <p class="etikett">Kommer snart</p>
      <h1>${esc(rubrik)}</h1>
      <p class="ingress">${esc(text)}</p>
    </header>
    <div class="tomt-kort">
      <p>Den här delen byggs i nästa steg av prototypen.</p>
      <a class="knapp sekundar" href="#/sok">Testa plaggsökaren</a>
    </div>`;
}
