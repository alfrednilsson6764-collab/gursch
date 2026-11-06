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

## Antaganden om oklara regler (ändras lätt)

1. Spelomgången tar slut när en spelare har lagt sitt sista kort.
2. Inga nya kort dras efter att man lagt – handen krymper.
3. Turordning medurs.
4. Om ingen slår och turen kommer tillbaka behåller styrspelaren styret och startar ny runda.
5. Man får lägga sina lägsta kort även om man kan slå (`RULES.mayDumpWhenCanBeat`).
6. Har man färre kort än rundan kräver lägger man alla sina kort.
7. Tar kortleken slut blandas slänghögen till en ny lek.
8. Avgörandekort vid lika högsta kort går till slänghögen.
9. Synliga kort (det sjätte utdelade kortet och behållna synliga ersättningskort) syns för alla så länge de ligger kvar på handen.
