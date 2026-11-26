// Plaggsökaren: fota/ladda upp en bild, AI:n känner igen plaggen, sök i butiker.
import { esc, lasBild, analyseraBild, butiker } from "../hjalp.js";
import { ikoner } from "../ikoner.js";

// Tillståndet ligger kvar när man byter flik och kommer tillbaka
const t = { bild: null, resultat: null, laddar: false, fel: null, text: "", autostart: false };
let rot = null; // vyns element medan den visas

const LADDTEXTER = ["Känner igen plaggen…", "Letar efter märkesdetaljer…", "Läser av färg och material…", "Tar fram sökord…"];

// Används av andra vyer för att skicka en bild eller en sökfras hit
export function sokMedBild(bild) {
  Object.assign(t, { bild, resultat: null, fel: null, text: "", autostart: true });
  gaTillSok();
}
export function sokMedText(text) {
  Object.assign(t, { text, bild: null, resultat: null, fel: null });
  gaTillSok();
}
function gaTillSok() {
  if (location.hash === "#sok") window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = "#sok";
}

export function visaSok(el) {
  rot = el;
  rita();
  if (t.autostart) {
    t.autostart = false;
    analysera();
  }
}

// ---------- Rendering ----------

function rita() {
  if (!rot?.isConnected) return;
  rot.innerHTML = `
    <header class="sidhuvud">
      <p class="etikett">Plaggsökare</p>
      <h1>Hitta plaggen</h1>
      <p class="ingress">Fota ett plagg eller en hel outfit. Vi känner igen plaggen och visar var du hittar dem – nytt eller begagnat.</p>
    </header>
    ${t.bild ? bildHtml() : uppladdningHtml()}
    ${t.resultat ? resultatHtml(t.resultat) : ""}
  `;
  koppla();
}

function uppladdningHtml() {
  return `
    <section class="uppladdning">
      <button class="uppladdning-yta" data-gor="valj">
        <span class="uppladdning-ikon">${ikoner.bild}</span>
        <span class="uppladdning-rubrik">Lägg till en bild</span>
        <span class="uppladdning-text">Ett plagg, en outfit eller en skärmdump</span>
      </button>
      <div class="knapprad">
        <button class="knapp primar" data-gor="kamera">${ikoner.kamera}<span>Ta foto</span></button>
        <button class="knapp sekundar" data-gor="valj">${ikoner.bild}<span>Välj bild</span></button>
      </div>
      <input type="file" accept="image/*" capture="environment" hidden data-input="kamera" />
      <input type="file" accept="image/*" hidden data-input="valj" />
    </section>

    <section class="textsok">
      <p class="etikett">Vet du redan vad du letar efter?</p>
      <form class="sokfalt" data-form="text">
        <input name="q" type="search" placeholder="t.ex. beige trenchcoat" value="${esc(t.text)}" autocomplete="off" />
        <button class="knapp primar liten" type="submit">Sök</button>
      </form>
      ${t.text ? `<div class="kort textsok-resultat">
        <p class="liten">Sök efter</p>
        <p class="textsok-fras">”${esc(t.text)}”</p>
        ${butiksHtml(t.text)}
      </div>` : ""}
    </section>`;
}

function bildHtml() {
  return `
    <section class="forhandsvisning ${t.laddar ? "laddar" : ""}">
      <div class="bildram">
        <img src="${t.bild}" alt="Din bild" />
        <div class="skanner"></div>
        ${t.laddar ? "" : `<button class="bild-stang" data-gor="ny" aria-label="Ta bort bilden">${ikoner.stang}</button>`}
      </div>
      ${t.laddar ? `<p class="laddtext" aria-live="polite">${LADDTEXTER[0]}</p>` : ""}
      ${t.fel ? `<p class="fel">${esc(t.fel)}</p>` : ""}
      ${!t.resultat && !t.laddar ? `
        <div class="knapprad">
          <button class="knapp primar bred" data-gor="analysera">Analysera plaggen</button>
        </div>` : ""}
    </section>`;
}

function resultatHtml(r) {
  const antal = r.plagg.length;
  return `
    <section class="resultat">
      ${r.demo ? `<p class="demo-notis">Demoläge – det här är ett exempelsvar, inte en riktig analys av din bild. Lägg in en API-nyckel och kör appen lokalt för riktig AI.</p>` : ""}
      <p class="sammanfattning">${esc(r.sammanfattning)}</p>
      <p class="etikett">${antal === 0 ? "Inga plagg hittades" : `${antal} plagg hittade`}</p>
      ${r.plagg.map(plaggHtml).join("")}
      <button class="knapp sekundar bred" data-gor="ny">Ny sökning</button>
    </section>`;
}

const NIVA = { låg: "lag", medel: "medel", hög: "hog" };

function plaggHtml(p, i) {
  const okant = !p.marke || p.marke.toLowerCase() === "okänt";
  const marke = okant ? "Inget tydligt märke" : [p.marke, p.modell].filter(Boolean).join(" · ");
  const procent = Math.max(0, Math.min(100, Number(p.sakerhetProcent) || 0));
  return `
    <article class="kort plaggkort" style="--i:${i}">
      <div class="plaggkort-topp">
        <span class="etikett">${esc(p.kategori)}</span>
        <span class="bricka">${esc(p.stil)}</span>
      </div>
      <h2>${esc(p.typ)}</h2>
      <p class="beskrivning">${esc(p.beskrivning)}</p>

      <div class="marke">
        <p class="liten">Troligt märke</p>
        <p class="marke-namn">${esc(marke)}</p>
        <div class="sakerhet ${NIVA[p.sakerhet] || "lag"}">
          <span class="matare"><span style="width:${procent}%"></span></span>
          <span>${esc(stor(p.sakerhet))} säkerhet · ${procent} %</span>
        </div>
      </div>

      <dl class="egenskaper">
        <div><dt>Färg</dt><dd>${esc(p.farg)}</dd></div>
        <div><dt>Material</dt><dd>${esc(p.material)}</dd></div>
      </dl>

      <label class="sokord">
        <span class="liten">Sökord – ändra om du vill</span>
        <input value="${esc(p.sokord)}" data-sokord="${i}" />
      </label>
      ${butiksHtml(p.sokord, i)}
    </article>`;
}

function butiksHtml(fras, i = "text") {
  return `<div class="butiker" data-butiker="${i}">
    ${butiker
      .map((b, j) => `<a class="butik" data-butik="${j}" href="${esc(b.url(fras))}" target="_blank" rel="noopener">${b.namn}${ikoner.pil}</a>`)
      .join("")}
  </div>`;
}

const stor = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

// ---------- Händelser ----------

function koppla() {
  rot.querySelectorAll("[data-gor]").forEach((knapp) => {
    knapp.addEventListener("click", () => {
      const gor = knapp.dataset.gor;
      if (gor === "kamera" || gor === "valj") rot.querySelector(`[data-input="${gor}"]`).click();
      if (gor === "analysera") analysera();
      if (gor === "ny") {
        Object.assign(t, { bild: null, resultat: null, fel: null });
        rita();
      }
    });
  });

  rot.querySelectorAll("[data-input]").forEach((input) => {
    input.addEventListener("change", async () => {
      const fil = input.files?.[0];
      if (!fil) return;
      try {
        Object.assign(t, { bild: await lasBild(fil), resultat: null, fel: null, text: "" });
        rita();
        analysera(); // starta direkt – ett steg mindre för användaren
      } catch (err) {
        t.fel = err.message;
        rita();
      }
    });
  });

  rot.querySelector('[data-form="text"]')?.addEventListener("submit", (e) => {
    e.preventDefault();
    t.text = new FormData(e.target).get("q").trim();
    rita();
  });

  // Uppdatera butikslänkarna när man ändrar sökorden
  rot.querySelectorAll("[data-sokord]").forEach((input) => {
    input.addEventListener("input", () => {
      const fras = input.value || " ";
      rot.querySelectorAll(`[data-butiker="${input.dataset.sokord}"] .butik`).forEach((a) => {
        a.href = butiker[a.dataset.butik].url(fras);
      });
    });
  });
}

async function analysera() {
  if (!t.bild || t.laddar) return;
  Object.assign(t, { laddar: true, fel: null, resultat: null });
  rita();

  let steg = 0;
  const timer = setInterval(() => {
    const el = rot?.querySelector(".laddtext");
    if (el) el.textContent = LADDTEXTER[++steg % LADDTEXTER.length];
  }, 1800);

  try {
    t.resultat = await analyseraBild(t.bild);
  } catch (err) {
    t.fel = err.message;
  } finally {
    clearInterval(timer);
    t.laddar = false;
    rita();
    rot?.querySelector(".resultat")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
