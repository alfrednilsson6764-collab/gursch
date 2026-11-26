# Plaggjakt

En klickbar prototyp av en modeapp. Den är till för att testa idén och känslan, så det är ingen färdig produkt. Appen är på svenska och byggd för mobilen först.

- Inga konton. Allt sparas i webbläsaren.
- Den enda riktiga AI:n är bildanalysen (Claude Haiku). Den körs via en liten server, så API-nyckeln aldrig hamnar i webbläsaren.
- Utan API-nyckel körs appen i **demoläge** och visar exempelsvar, så att man ändå kan klicka runt.

## Starta

Appen körs på din egen dator. Du behöver [Node.js](https://nodejs.org) version 20.12 eller senare (välj "LTS" på nodejs.org).

**1. Hämta koden.** Antingen:
- Ladda ner den som zip (du behöver vara inloggad på GitHub): https://github.com/alfrednilsson6764-collab/gursch/archive/refs/heads/claude/plaggjakt-fashion-prototype-6tyw3c.zip och packa upp den.
- Eller med git:
  ```bash
  git clone -b claude/plaggjakt-fashion-prototype-6tyw3c https://github.com/alfrednilsson6764-collab/gursch.git
  cd gursch
  ```

**2. Öppna en terminal i mappen och kör:**

```bash
cd plaggjakt
npm install
cp .env.example .env     # lägg sedan in din nyckel i .env (valfritt)
npm start
```

Öppna sedan **http://localhost:3030**.

### API-nyckel

1. Skapa en nyckel på https://platform.claude.com under *API Keys*.
2. Klistra in den i `.env`: `ANTHROPIC_API_KEY=sk-ant-...`
3. Starta om med `npm start`.

`.env` ligger i `.gitignore` och checkas aldrig in. När servern startar står det i terminalen om den kör med AI eller i demoläge.

### Testa på mobilen

Datorn och mobilen behöver vara på samma wifi. När servern startar skrivs en adress ut, till exempel `http://192.168.1.23:3030`. Öppna den i mobilens webbläsare. Knappen *Ta foto* öppnar kameran direkt.

## Delar

| Del | Status |
|---|---|
| Plaggsökare – fota ett plagg, få typ, troligt märke, färg, material, stil och sökknappar till Google Shopping, Zalando, Vinted och Sellpy | ✅ Klar |
| Outfitflöde (swipa som TikTok) | Kommer |
| Stilenkät | Kommer |
| Min garderob | Kommer |
| Stylist | Kommer |

## Så hänger koden ihop

```
plaggjakt/
  server.js          Express-server: visar appen och har /api/analysera (Claude)
  demo.js            Exempelsvar för demoläget
  public/
    index.html       Appskal med bottenmeny
    css/style.css    All design
    js/app.js        Enkel router mellan flikarna (#/flode, #/sok, ...)
    js/hjalp.js      Bildkrympning, API-anrop och butikslänkar
    js/ikoner.js     Ikoner (SVG)
    js/views/        En fil per flik
```

Det finns inget byggsteg. Filerna i `public/` körs direkt i webbläsaren.

Bilden krymps till högst 1280 px i webbläsaren innan den skickas. Servern ber Claude om svar i ett fast JSON-format (structured outputs), så att appen alltid kan läsa svaret.

Vill du byta modell kan du sätta `CLAUDE_MODEL` i `.env`.
