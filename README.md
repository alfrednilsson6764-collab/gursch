# GURSCH

Onlinekortspel för 2–6 spelare. Servern (Node.js + Socket.IO) äger all spellogik och skickar till varje spelare bara det den får se.

## Testversion mot bottar

`node offline/build.js` bygger `dist/gursch-test.html` – en fil som körs helt i webbläsaren mot bottar (`src/bots.js`).

## Poängtavla

Så länge man spelar flera omgångar i samma rum sparas allas poäng. Rutan i nedre vänstra hörnet visar plus/minus mot de spelare man vunnit eller förlorat mot. Bara omgångens vinnare mot förlorare räknas: vinnaren får skillnaden i slutpoäng i plus mot varje förlorare, och förloraren lika mycket i minus. De som hamnar i mitten räknas inte. "Avsluta och visa ställning" visar slutskärmen med totalpoäng, en tabell över alla mot alla och en text att kopiera.

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

## Inloggning och konton (Supabase, valfritt)

Utan inställningar fungerar allt som förut: alla spelar som gäst och knappen Logga in syns inte. Med Supabase kan man logga in med e-postlänk eller Google, välja ett unikt användarnamn och få sin statistik sparad. Gäster kan alltid spela.

### 1. Skapa databasen

1. Skapa ett projekt på https://supabase.com (Free räcker).
2. Öppna **SQL Editor → New query**, klistra in hela `db/schema.sql` och tryck **Run**. Det skapar tabellerna `profiles` och `owned_decks` med Row Level Security påslaget: inloggade får bara läsa sin egen rad och ingen kan skriva direkt – bara servern skriver, med secret key.
3. Skriptet går att köra igen utan att något försvinner.

### 2. Miljövariabler i Render

I Render: din tjänst → **Environment → Add Environment Variable**. Värdena finns i Supabase under **Project Settings → API Keys** (och **Data API** för URL:en).

| Variabel | Värde |
| --- | --- |
| `SUPABASE_URL` | `https://<projekt>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | publishable key (`sb_publishable_…`, eller den gamla `anon`-nyckeln) |
| `SUPABASE_SECRET_KEY` | secret key (`sb_secret_…`, eller den gamla `service_role`-nyckeln) |

Secret key får aldrig hamna i klienten eller i GitHub – den finns bara som miljövariabel på servern. Klienten hämtar URL och publishable key från `/config`.

Servern gör en liten fråga mot databasen en gång per dygn så att Supabase-projektet inte pausas.

### 3. Inloggningsadresser

I Supabase: **Authentication → URL Configuration**

- **Site URL**: din Render-adress, t.ex. `https://gursch.onrender.com`
- **Redirect URLs**: lägg till `https://gursch.onrender.com/**` (och `http://localhost:3000/**` om du testar lokalt)

E-postlänk (magic link) fungerar direkt. Supabase gratismejl har en låg gräns per timme; för fler mejl kan man lägga in egen SMTP under **Authentication → Emails**.

### 4. Slå på Google-inloggning

1. Gå till https://console.cloud.google.com → skapa (eller välj) ett projekt.
2. **APIs & Services → OAuth consent screen**: välj External, fyll i appnamn (Gursch) och din e-post, spara och publicera.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, typ **Web application**.
   - Authorized JavaScript origins: `https://gursch.onrender.com`
   - Authorized redirect URIs: `https://<projekt>.supabase.co/auth/v1/callback` (står också i Supabase under Google-providern)
4. Kopiera Client ID och Client secret.
5. I Supabase: **Authentication → Sign In / Providers → Google**, slå på, klistra in Client ID och Client secret, spara.

### Integritet

Vi sparar bara e-post (sköts av Supabase Auth), användarnamn och spelstatistik/samling. `/integritet` beskriver det för spelarna. Under **Min profil → Radera mitt konto** tas profil, samling och själva inloggningen bort.

## Mynt, kistor och kortlekar

- **Guldmynt 🪙** delas bara ut av servern. Efter varje avslutad omgång får man 10 mynt för att ha spelat klart, +10 vid vinst och +5 om man varken vann eller förlorade. Vinst ger alltså 20, mitten 15 och förlust 10. Mot bara bottar blir det hälften. Bara den som var med hela omgången får mynt: man ska vara ansluten när omgången tar slut och inte ha varit borta i mer än 30 sekunder.
- **Inloggade** får mynten sparade i databasen. **Gäster** (och testversionen) sparar dem i webbläsaren (localStorage).
- **En kista** kostar 100 🪙 och ger en kortlek. Oddsen är Vanlig 60 %, Sällsynt 30 %, Episk 9 % och Legendarisk 1 %. Efter 10 kistor i rad utan Episk eller bättre blir nästa kista minst Episk. En dubblett ger 30 🪙 tillbaka. För inloggade öppnas kistan på servern, som drar slumpen, drar av mynten och sparar leken.
- **12 kortlekar** är ritade i SVG och CSS (`public/decks.js`). Reglerna finns i `src/economy.js`. Klassisk grön är startleken och den följer med alla konton. Den valda leken används för ens egna kort, och de andra ser den på ens plats vid bordet.
- **Gäst blir konto:** vid första inloggningen erbjuds man att flytta sina gästmynt och gästlekar till kontot. Högst 300 mynt och bara Vanliga och Sällsynta lekar kan flyttas.
- Mynt kan aldrig köpas för riktiga pengar.

## Struktur

- `src/game.js` – regelmotorn (utdelning, bytesrundor, spel, poäng). Oklara regler samlas i `RULES` överst.
- `src/server.js` – rum, rumskoder, lobby, återanslutning och dragkontroll.
- `src/accounts.js` – konton mot Supabase (verifierar token, profiler, statistik, radering). `src/usernames.js` – regler och filter för användarnamn.
- `db/schema.sql` – databasschemat med RLS.
- `public/` – klienten (HTML/CSS/JS utan byggsteg). `public/auth.js` sköter inloggningen.

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
