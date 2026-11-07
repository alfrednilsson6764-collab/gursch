# GURSCH

Onlinekortspel för 2–6 spelare. Servern (Node.js + Socket.IO) äger all spellogik och skickar till varje spelare bara det den får se.

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

1. När en spelare får slut på kort är det sista rundan. Den spelas klart (alla som är kvar i rundan lägger en gång) och sedan räknas poängen.
2. Inga nya kort dras efter att man lagt – handen krymper.
3. Turordning medurs.
4. Om ingen slår och turen kommer tillbaka behåller styrspelaren styret och startar ny runda.
5. Man måste alltid slå om man kan.
6. Man ska aldrig ha färre kort än rundan kräver (händer det ändå läggs alla kort).
7. Tar kortleken slut blandas slänghögen till en ny lek.
8. Avgörandekort vid lika högsta kort läggs undan.
9. Lägst poäng vinner, flera med samma lägsta vinner tillsammans. Högst poäng förlorar, flera med samma högsta förlorar tillsammans. Har alla samma blir det oavgjort.
10. Synliga kort (det sjätte utdelade kortet och behållna synliga ersättningskort) syns för alla så länge de ligger kvar på handen.
