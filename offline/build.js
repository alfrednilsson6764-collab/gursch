'use strict';
// Bygger testversionen (en enda HTML-fil, spela mot bottar utan server): node offline/build.js
const fs = require('fs');
const path = require('path');
const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const gameJs = R('src/game.js');
const shim = `(function () {
  const module = { exports: {} };
  const require = () => ({ randomInt: (n) => { const a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] % n; } });
${gameJs}
  window.GurschGame = module.exports;
})();`;

let html = R('public/index.html');
const extraCss = `
.invite, #readyBtn, .room-code, #copyBtn, .divider, .join-row { display: none !important; }
.test-badge { display: inline-block; background: #c62828; color: #fff; font-weight: 800; font-size: 12px; padding: 3px 10px; border-radius: 99px; letter-spacing: .08em; }`;
html = html
  .replace('<title>GURSCH</title>', '<title>GURSCH – testa mot bottar</title>')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${R('public/style.css')}\n${extraCss}\n</style>`)
  .replace('<p class="tagline">Kortspelet där lägst vinner · 2–6 spelare</p>',
    '<p class="tagline"><span class="test-badge">TESTVERSION</span><br>Spela mot bottar · välj antal spelare i rummet</p>')
  .replace('<button id="createBtn" class="btn primary big">Skapa spel</button>', '<button id="createBtn" class="btn primary big">Spela mot bottar</button>')
  .replace('<script src="/socket.io/socket.io.js"></script>\n  <script src="app.js"></script>', () =>
    ['<script>', shim, '</script>',
      '<script>', R('src/bots.js'), '</script>',
      '<script>', R('offline/local.js'), '</script>',
      '<script>', R('public/app.js'), '</script>'].join('\n'))
;

if (html.includes('socket.io.js') || html.includes('href="style.css"')) throw new Error('Byggfel: något ersattes inte');
fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'dist', 'gursch-test.html'), html);
console.log('Skrev dist/gursch-test.html', (html.length / 1024).toFixed(0), 'kB');
