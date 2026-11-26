// Små hjälpfunktioner som delas av vyerna.

// Skydda text som stoppas in i HTML
export function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Läs en bildfil och krymp den till max 1280 px (snabbare uppladdning och billigare AI-anrop)
export function lasBild(fil, maxSida = 1280) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fil);
    const img = new Image();
    img.onload = () => {
      const skala = Math.min(1, maxSida / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * skala);
      canvas.height = Math.round(img.height * skala);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bilden kunde inte läsas."));
    };
    img.src = url;
  });
}

// Skicka en bild till backend för analys
export async function analyseraBild(bild) {
  const svar = await fetch("/api/analysera", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bild }),
  });
  const data = await svar.json().catch(() => ({}));
  if (!svar.ok) throw new Error(data.fel || "Något gick fel. Försök igen.");
  return data;
}

// Länkar till butikernas sökningar
const q = (s) => encodeURIComponent(s.trim());
export const butiker = [
  { namn: "Google Shopping", url: (s) => `https://www.google.com/search?tbm=shop&hl=sv&gl=se&q=${q(s)}` },
  { namn: "Zalando", url: (s) => `https://www.zalando.se/katalog/?q=${q(s)}` },
  { namn: "Vinted", url: (s) => `https://www.vinted.se/catalog?search_text=${q(s)}` },
  { namn: "Sellpy", url: (s) => `https://www.sellpy.se/search?query=${q(s)}` },
];
