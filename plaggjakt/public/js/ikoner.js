// Tunna linjeikoner (SVG) som används i hela appen.
const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ikoner = {
  flode: svg('<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M10 9.5v5l4-2.5-4-2.5z"/>'),
  sok: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  garderob: svg('<path d="M12 6.5a1.8 1.8 0 1 1 1.8-1.8M12 6.5v1.2L3.6 13a1.2 1.2 0 0 0 .7 2.2h15.4a1.2 1.2 0 0 0 .7-2.2L12 7.7"/>'),
  stylist: svg('<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"/>'),
  kamera: svg('<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9z"/><circle cx="12" cy="13" r="3.5"/>'),
  bild: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9.5" r="1.5"/><path d="m20 15-4.5-4.5L6 20"/>'),
  pil: svg('<path d="M7 17 17 7M9 7h8v8"/>'),
  tillbaka: svg('<path d="M15 18l-6-6 6-6"/>'),
  stang: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};

// Fyll i alla element med data-ikon="namn"
export function fyllIkoner(rot = document) {
  rot.querySelectorAll("[data-ikon]").forEach((el) => {
    el.innerHTML = ikoner[el.dataset.ikon] || "";
  });
}
