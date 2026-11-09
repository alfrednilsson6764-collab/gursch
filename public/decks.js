'use strict';
// Kortlekarnas utseende: baksidor i SVG och färger för framsidorna, allt utan bildfiler.
// Varje lek får klassen dk-<id>. Stilen byggs här och läggs in i en <style> när sidan laddas.
(function () {
  const svg = (inner, defs = '') => `<svg xmlns='http://www.w3.org/2000/svg' width='60' height='90' viewBox='0 0 60 90'><defs>${defs}</defs>${inner}</svg>`;
  const url = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
  const grad = (id, a, b, cy = '45%') => `<radialGradient id='${id}' cx='50%' cy='${cy}' r='75%'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></radialGradient>`;
  const lin = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id='${id}' x1='0' y1='0' x2='${x2}' y2='${y2}'>${stops.map(([o, c]) => `<stop offset='${o}' stop-color='${c}'/>`).join('')}</linearGradient>`;
  const frame = (c, o = 1) => `<rect x='3.5' y='3.5' width='53' height='83' rx='3' fill='none' stroke='${c}' stroke-opacity='${o}' stroke-width='.9'/><rect x='6' y='6' width='48' height='78' rx='2' fill='none' stroke='${c}' stroke-opacity='${o * 0.5}' stroke-width='.4'/>`;
  const emblem = (txt, fill, ring, color, size = 13, extra = '') => `<circle cx='30' cy='45' r='12' fill='${fill}' stroke='${ring}' stroke-width='1' ${extra}/><circle cx='30' cy='45' r='9.2' fill='none' stroke='${ring}' stroke-opacity='.55' stroke-width='.45'/><text x='30' y='${45 + size * 0.35}' text-anchor='middle' font-family='Georgia,serif' font-style='italic' font-weight='700' font-size='${size}' fill='${color}'>${txt}</text>`;
  const lattice = (c, o = 0.32) => `<pattern id='p' width='7' height='7' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><path d='M0 3.5h7M3.5 0v7' stroke='${c}' stroke-opacity='${o}' stroke-width='.55'/><circle cx='3.5' cy='3.5' r='.7' fill='${c}' fill-opacity='${o + 0.13}'/></pattern>`;
  const dots = (c, o = 0.35) => `<pattern id='p' width='5' height='5' patternUnits='userSpaceOnUse'><circle cx='2.5' cy='2.5' r='.8' fill='${c}' fill-opacity='${o}'/></pattern>`;
  const stripes = (c, o = 0.25) => `<pattern id='p' width='4' height='4' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><rect width='2' height='4' fill='${c}' fill-opacity='${o}'/></pattern>`;
  // enkel deterministisk slump så att stjärnorna hamnar likadant varje gång
  const rnd = (seed) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

  const BACKS = {
    classic: () => svg(`<rect width='60' height='90' fill='url(#v)'/><rect width='60' height='90' fill='url(#p)'/>${frame('#d4af5f')}${emblem('G', '#0d3d29', '#d4af5f', '#f3dfa2')}`,
      grad('v', '#1f7a50', '#0a2e1f') + lattice('#d4af5f')),
    navy: () => svg(`<rect width='60' height='90' fill='url(#v)'/><rect width='60' height='90' fill='url(#p)'/>${frame('#d6deec')}${emblem('⚓', '#0e2350', '#d6deec', '#eef3fb', 12)}`,
      grad('v', '#24498f', '#0a1736') + dots('#d6deec', 0.4)),
    wine: () => svg(`<rect width='60' height='90' fill='url(#v)'/><rect width='60' height='90' fill='url(#p)'/>${frame('#d4af5f')}${emblem('G', '#5c0d1a', '#d4af5f', '#f3dfa2')}`,
      grad('v', '#861a2c', '#4a0913') + lattice('#d4af5f')),
    graphite: () => svg(`<rect width='60' height='90' fill='url(#v)'/><rect width='60' height='90' fill='url(#p)'/>${frame('#b9c0c7', 0.9)}${emblem('◆', '#24282c', '#b9c0c7', '#dfe4e8', 11)}`,
      grad('v', '#555b62', '#1b1e21') + stripes('#000', 0.28)),
    neon: () => svg(`<rect width='60' height='90' fill='#08060f'/><rect width='60' height='90' fill='url(#p)'/>
      <g filter='url(#gl)'><rect x='4' y='4' width='52' height='82' rx='4' fill='none' stroke='#ff2bd6' stroke-width='1.2'/><rect x='8' y='8' width='44' height='74' rx='3' fill='none' stroke='#22f1ff' stroke-width='.8'/>
      <circle cx='30' cy='45' r='11' fill='none' stroke='#22f1ff' stroke-width='1.2'/><text x='30' y='50' text-anchor='middle' font-family='Arial,sans-serif' font-weight='900' font-size='15' fill='none' stroke='#ff2bd6' stroke-width='1'>G</text></g>`,
      `<filter id='gl' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='1.2' result='b'/><feMerge><feMergeNode in='b'/><feMergeNode in='SourceGraphic'/></feMerge></filter>
      <pattern id='p' width='6' height='6' patternUnits='userSpaceOnUse'><path d='M6 0H0V6' fill='none' stroke='#7a2cff' stroke-opacity='.35' stroke-width='.4'/></pattern>`),
    ice: () => {
      const flake = (x, y, s, o) => `<g transform='translate(${x} ${y}) scale(${s})' stroke='#fff' stroke-opacity='${o}' stroke-width='.6' stroke-linecap='round'>${[0, 60, 120].map((a) => `<path transform='rotate(${a})' d='M0 -5V5M-1.5 -3.5L0 -2L1.5 -3.5M-1.5 3.5L0 2L1.5 3.5'/>`).join('')}</g>`;
      const r = rnd(7); let f = '';
      for (let i = 0; i < 14; i++) f += flake((r() * 56 + 2).toFixed(1), (r() * 86 + 2).toFixed(1), (0.35 + r() * 0.5).toFixed(2), (0.35 + r() * 0.4).toFixed(2));
      return svg(`<rect width='60' height='90' fill='url(#v)'/>${f}${frame('#ffffff', 0.9)}${emblem('❄', '#bfe5fb', '#ffffff', '#2f7fb8', 13)}`, lin('v', [[0, '#f1fbff'], [0.55, '#a8dcf6'], [1, '#5fb3e3']], 0.3, 1));
    },
    wood: () => {
      let g = '';
      for (let i = 0; i < 16; i++) { const y = i * 6 - 3, a = 1.2 + (i % 3) * 0.6; g += `<path d='M-2 ${y} C 12 ${y + a} 20 ${y - a} 32 ${y + a * 0.6} S 52 ${y - a} 62 ${y}' fill='none' stroke='#3b2210' stroke-opacity='${0.18 + (i % 4) * 0.06}' stroke-width='${0.5 + (i % 2) * 0.4}'/>`; }
      return svg(`<rect width='60' height='90' fill='url(#v)'/>${g}<ellipse cx='17' cy='68' rx='4' ry='2' fill='none' stroke='#3b2210' stroke-opacity='.35' stroke-width='.6'/>
        <rect x='5' y='5' width='50' height='80' rx='3' fill='none' stroke='#2c1709' stroke-opacity='.55' stroke-width='1.4'/>${emblem('G', '#6e4320', '#f0c98a', '#f7deb0')}`, lin('v', [[0, '#b07a42'], [0.5, '#8a5a2b'], [1, '#6b4220']], 1, 1));
    },
    retro: () => {
      let grid = '';
      for (let i = 0; i <= 10; i++) grid += `<path d='M30 58 L${-30 + i * 12} 90' stroke='#ff3fa4' stroke-opacity='.75' stroke-width='.5'/>`;
      [62, 67, 73, 81].forEach((y) => (grid += `<path d='M0 ${y}H60' stroke='#ff3fa4' stroke-opacity='.75' stroke-width='.5'/>`));
      return svg(`<rect width='60' height='90' fill='url(#sky)'/><circle cx='30' cy='46' r='14' fill='url(#sun)'/>
        ${[44, 48.5, 52.5, 56].map((y, k) => `<rect x='14' y='${y}' width='32' height='${0.8 + k * 0.5}' fill='#3a0f5c'/>`).join('')}
        <rect y='58' width='60' height='32' fill='#1d0636'/>${grid}<rect x='3.5' y='3.5' width='53' height='83' rx='3' fill='none' stroke='#22f1ff' stroke-width='.9'/>
        <text x='30' y='20' text-anchor='middle' font-family='Arial,sans-serif' font-style='italic' font-weight='900' font-size='10' fill='#ffe36b' stroke='#ff3fa4' stroke-width='.4'>GURSCH</text>`,
        lin('sky', [[0, '#1d0636'], [0.45, '#6a1b9a'], [0.65, '#ff3f8e']]) + lin('sun', [[0, '#ffe36b'], [1, '#ff4f8b']]));
    },
    space: () => {
      const r = rnd(42); let st = '';
      for (let i = 0; i < 46; i++) st += `<circle cx='${(r() * 60).toFixed(1)}' cy='${(r() * 90).toFixed(1)}' r='${(0.2 + r() * 0.6).toFixed(2)}' fill='#fff' fill-opacity='${(0.4 + r() * 0.6).toFixed(2)}'/>`;
      return svg(`<rect width='60' height='90' fill='#05061a'/><rect width='60' height='90' fill='url(#neb)'/><rect width='60' height='90' fill='url(#neb2)'/>${st}
        <circle cx='30' cy='46' r='10' fill='url(#pl)'/><ellipse cx='30' cy='46' rx='17' ry='4' fill='none' stroke='#f0d9ff' stroke-opacity='.8' stroke-width='1' transform='rotate(-18 30 46)'/>
        ${frame('#c9b6ff', 0.8)}`,
        `<radialGradient id='neb' cx='30%' cy='30%' r='60%'><stop offset='0' stop-color='#7b2ff7' stop-opacity='.7'/><stop offset='1' stop-color='#7b2ff7' stop-opacity='0'/></radialGradient>
         <radialGradient id='neb2' cx='75%' cy='75%' r='55%'><stop offset='0' stop-color='#ff4fa3' stop-opacity='.45'/><stop offset='1' stop-color='#ff4fa3' stop-opacity='0'/></radialGradient>
         <radialGradient id='pl' cx='35%' cy='35%' r='70%'><stop offset='0' stop-color='#9fe7ff'/><stop offset='.6' stop-color='#3a5bd9'/><stop offset='1' stop-color='#1a1460'/></radialGradient>`);
    },
    lava: () => svg(`<rect width='60' height='90' fill='#140805'/><rect width='60' height='90' fill='url(#glow)'/>
      <g fill='none' stroke='url(#hot)' stroke-linecap='round' filter='url(#gl)'>
        <path d='M30 0 L27 12 L33 22 L28 34 L31 45 L26 58 L32 70 L29 90' stroke-width='1.6'/>
        <path d='M27 12 L14 18 L8 30 M33 22 L46 26 L52 40 M28 34 L16 44 L4 48 M31 45 L44 54 L56 52 M26 58 L12 66 L6 80 M32 70 L45 76 L50 88' stroke-width='.9'/>
        <path d='M14 18 L6 10 M46 26 L55 18 M16 44 L12 56 M44 54 L48 66' stroke-width='.5'/></g>
      ${frame('#ff7a2b', 0.7)}`,
      `<radialGradient id='glow' cx='50%' cy='50%' r='60%'><stop offset='0' stop-color='#ff5a1f' stop-opacity='.45'/><stop offset='1' stop-color='#ff5a1f' stop-opacity='0'/></radialGradient>
       ${lin('hot', [[0, '#ffd23f'], [0.5, '#ff7a1a'], [1, '#e8290b']])}
       <filter id='gl' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='1' result='b'/><feMerge><feMergeNode in='b'/><feMergeNode in='SourceGraphic'/></feMerge></filter>`),
    marble: () => svg(`<rect width='60' height='90' fill='url(#v)'/>
      <g fill='none' stroke='#6b6f78' stroke-linecap='round'>
        <path d='M-2 14 C 10 18 16 30 28 32 S 44 44 62 40' stroke-opacity='.35' stroke-width='.8'/><path d='M-2 52 C 8 50 18 60 26 70 S 46 78 62 74' stroke-opacity='.3' stroke-width='.6'/>
        <path d='M10 -2 C 14 10 8 20 18 28' stroke-opacity='.25' stroke-width='.5'/><path d='M40 92 C 38 80 48 70 44 60 S 50 46 62 50' stroke-opacity='.28' stroke-width='.5'/>
        <path d='M28 32 C 30 40 22 46 26 56' stroke-opacity='.2' stroke-width='.4'/></g>
      ${frame('#c9a54a')}${emblem('G', '#f7f5f0', '#c9a54a', '#a8862e')}`, lin('v', [[0, '#ffffff'], [0.6, '#eceae4'], [1, '#d9d6cf']], 1, 1)),
    gold: () => svg(`<rect width='60' height='90' fill='url(#v)'/><rect width='60' height='90' fill='url(#p)'/>
      <rect x='3.5' y='3.5' width='53' height='83' rx='3' fill='none' stroke='#5a3d00' stroke-opacity='.6' stroke-width='1'/><rect x='6' y='6' width='48' height='78' rx='2' fill='none' stroke='#fff6c9' stroke-opacity='.8' stroke-width='.5'/>
      <circle cx='30' cy='45' r='12' fill='url(#c)' stroke='#5a3d00' stroke-opacity='.6' stroke-width='.8'/><text x='30' y='50' text-anchor='middle' font-family='Georgia,serif' font-size='14' fill='#5a3d00'>♛</text>`,
      lin('v', [[0, '#fff1a8'], [0.35, '#f0c53c'], [0.7, '#c8961a'], [1, '#8f6508']], 1, 1) + lin('c', [[0, '#ffe680'], [1, '#c8961a']]) + lattice('#7a5300', 0.22)),
  };

  // framsidor: bakgrund, bläck för svart och rött, ram och guldfärg i de klädda korten
  const FACES = {
    classic: { bg: 'radial-gradient(120% 90% at 30% 15%, #fffefa 0%, #f7f6ea 55%, #e2e8d4 100%)', ink: '#14231b', red: '#a8162a', line: '#3f7a52', gold: '#d9b45f' },
    navy: { bg: 'radial-gradient(120% 90% at 30% 15%, #ffffff 0%, #f1f5fc 60%, #dde6f5 100%)', ink: '#13254d', red: '#c0283d', line: '#6c84b8', gold: '#c9d3e6', frame: '#f4f7fd' },
    wine: { bg: 'radial-gradient(120% 90% at 30% 15%, #fffdf6 0%, #fbf0e4 60%, #f0dccb 100%)', ink: '#2a0d12', red: '#8d1027', line: '#a0614f', gold: '#d4af5f' },
    graphite: { bg: 'linear-gradient(160deg, #fafafa 0%, #ececec 60%, #d9dbdd 100%)', ink: '#1d2024', red: '#b3263a', line: '#7c838b', gold: '#b9c0c7', frame: '#f4f5f6', font: "'Inter', system-ui, sans-serif" },
    neon: { bg: 'radial-gradient(120% 90% at 30% 15%, #1a1230 0%, #0c0818 70%)', ink: '#3ff3ff', red: '#ff3fbf', line: '#7a2cff', gold: '#ff3fbf', frame: '#120c22', border: '#7a2cff', glow: true, font: "'Inter', system-ui, sans-serif" },
    ice: { bg: 'linear-gradient(165deg, #ffffff 0%, #eaf7ff 55%, #cdeafb 100%)', ink: '#12466b', red: '#d1366a', line: '#7dbfe6', gold: '#a8dcf6', frame: '#f3fbff', border: '#9fd3f2' },
    wood: { bg: 'repeating-linear-gradient(178deg, rgba(120,72,30,.06) 0 3px, transparent 3px 7px), linear-gradient(160deg, #f6e3bd 0%, #ebcf9b 100%)', ink: '#3b2412', red: '#9c2b17', line: '#8a5a2b', gold: '#c99a5b', frame: '#f6e6c6', border: '#a9773f' },
    retro: { bg: 'linear-gradient(180deg, #fff8ec 0%, #ffeef6 70%, #ffd9ec 100%)', ink: '#2b1055', red: '#ff2e88', line: '#22c3d6', gold: '#ffe36b', frame: '#fff7ef', border: '#ff3fa4', font: "'Inter', system-ui, sans-serif" },
    space: { bg: 'radial-gradient(1px 1px at 20% 30%, #fff 50%, transparent 51%), radial-gradient(1px 1px at 70% 60%, #fff 50%, transparent 51%), radial-gradient(1px 1px at 40% 85%, #ddd 50%, transparent 51%), radial-gradient(120% 90% at 30% 15%, #2a1f66 0%, #0b0b2a 75%)', ink: '#e6e9ff', red: '#ff7aa8', line: '#8f7bff', gold: '#c9b6ff', frame: '#16123f', border: '#5b4bd1' },
    lava: { bg: 'radial-gradient(90% 60% at 50% 110%, rgba(255,90,31,.45), transparent 70%), linear-gradient(170deg, #2a1610 0%, #160a06 100%)', ink: '#ffd9b0', red: '#ff6a2b', line: '#ff7a2b', gold: '#ffb347', frame: '#24120c', border: '#ff5a1f', glow: true },
    marble: { bg: 'linear-gradient(115deg, transparent 40%, rgba(110,110,120,.18) 42%, transparent 46%), linear-gradient(35deg, transparent 60%, rgba(110,110,120,.14) 61.5%, transparent 64%), linear-gradient(160deg, #ffffff 0%, #f1efea 60%, #e2dfd8 100%)', ink: '#26282d', red: '#9b1c31', line: '#c9a54a', gold: '#e2c46e' },
    gold: { bg: 'linear-gradient(150deg, #fff6c7 0%, #f6d76a 40%, #e2b33a 75%, #c8961a 100%)', ink: '#3a2600', red: '#8d0f12', line: '#7a5300', gold: '#fff1a8', frame: '#fbe9a0', border: '#8f6508', shine: true },
  };

  function css() {
    let out = '';
    for (const id of Object.keys(BACKS)) {
      const f = FACES[id];
      out += `.card.dk-${id}:not(.back){--f-ink:${f.ink};--f-red:${f.red};--f-line:${f.line};--f-gold:${f.gold};--f-frame:${f.frame || '#fbf1d8'};background:${f.bg};${f.border ? `border-color:${f.border};` : ''}${f.font ? `--f-font:${f.font};` : ''}}\n`;
      if (f.glow) out += `.card.dk-${id}:not(.back) .corner,.card.dk-${id}:not(.back) .pips,.card.dk-${id}:not(.back) .ace-art{text-shadow:0 0 6px currentColor}\n`;
      out += `.card.back.dk-${id}{background:${url(BACKS[id]())} center / 100% 100% no-repeat;border-color:${f.border || '#f1e3bd'}}\n`;
    }
    // Ren guld: glans som sveper över korten hela tiden
    out += `.card.dk-gold .shine{opacity:1;animation:gold-sweep 2.8s ease-in-out infinite;transition:none}
@keyframes gold-sweep{0%{transform:translateX(-70%)}55%,100%{transform:translateX(70%)}}
@media (prefers-reduced-motion: reduce){.card.dk-gold .shine{animation:none}}\n`;
    return out;
  }
  function install() {
    if (typeof document === 'undefined' || document.getElementById('deck-styles')) return;
    const el = document.createElement('style');
    el.id = 'deck-styles';
    el.textContent = css();
    document.head.appendChild(el);
  }
  window.GurschDeckArt = { css, install, ids: Object.keys(BACKS) };
  install();
})();
