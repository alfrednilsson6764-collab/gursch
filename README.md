# GURSCH

Onlinekortspel för 2–6 spelare. Servern (Node.js + Socket.IO) äger all spellogik och skickar till varje spelare bara det den får se.

## Testversion mot bottar

`node offline/build.js` bygger `dist/gursch-test.html` – en fil som körs helt i webbläsaren mot bottar (`src/bots.js`).

## Kör lokalt

```bash
npm install
npm start          # http://localhost:3000
npm test           # 2000 simulerade spel + regeltester + hela spel över nätverket med 2–6 klienter
```

## Publicera gratis (Render)

1. Lägg koden i ett GitHub-repo.
2. På https://render.com: **New → Web Service**, välj repot.
3. Build command `npm install`, start command `npm start`. Klart – dela adressen.

## Struktur

- `src/game.js` – regelmotorn (utdelning, bytesrundor, spel, poäng). Oklara regler samlas i `RULES` överst.
- `src/server.js` – rum, rumskoder, lobby, återanslutning och dragkontroll.
- `public/` – klienten (HTML/CSS/JS utan byggsteg).

## Regler som Alfred har bekräftat (2026-11-07)

1. Varje runda spelas klart: alla lägger en gång, även om någon tar styret, så att alla har lika många kort. Den som senast tog styret (eller styrspelaren om ingen tog det) startar nästa runda, och den som tar styret blir den kombination nästa spelare måste slå.
   Styrspelaren kan gå ut genom att lägga alla sina kort på en gång, men bara om alla har samma valör. Då slutar spelomgången och var och en räknar ihop sina kort – den som gick ut räknar korten den gick ut med.
2. Inga nya kort dras efter att man lagt – handen krymper.
3. Turordning medurs.
4. Om ingen tar styret behåller styrspelaren det.
5. Man måste alltid slå om man kan.
6. Man ska aldrig ha färre kort än rundan kräver (händer det ändå läggs alla kort).
7. Tar kortleken slut blandas slänghögen till en ny lek.
8. Avgörandekort vid lika högsta kort läggs undan.
9. Ersättningskort delas ut en spelare i taget, med början hos styrspelaren och sedan medurs. Spelaren får alla sina kort på en gång med framsidan upp (alla ser dem) och behåller alla eller tar lika många dolda innan nästa spelare får sina.
10. Efter de två bytesrundorna kan vem som helst fråga om alla vill slänga ett visst antal kort till. Är alla med slänger alla det antalet; säger någon nej, eller är alla nöjda, börjar spelet.
11. Att slå: lika många kort av samma valör som är samma eller högre tar styret. Lika många kort som alla är samma eller högre men av olika valör "lägger över" – det tar inte styret och den ursprungliga kombinationen gäller. Kan man lägga över måste man; annars läggs de lägsta korten.
12. Lägst poäng vinner, flera med samma lägsta vinner tillsammans. Högst poäng förlorar, flera med samma högsta förlorar tillsammans. Har alla samma blir det oavgjort.
13. Synliga kort (det sjätte utdelade kortet och behållna synliga ersättningskort) syns för alla så länge de ligger kvar på handen.
