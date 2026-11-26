// Plaggjakt – liten server: visar appen och gör bildanalysen med Claude.
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { demoSvar } from "./public/js/demo-data.js";

const MAPP = path.dirname(fileURLToPath(import.meta.url));

// Läs .env om filen finns (inbyggt i Node 20.12+)
try {
  process.loadEnvFile(path.join(MAPP, ".env"));
} catch {
  // ingen .env – då körs demoläget
}

const PORT = Number(process.env.PORT) || 3030;
const MODELL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";
const harNyckel = Boolean(process.env.ANTHROPIC_API_KEY);
const claude = harNyckel ? new Anthropic() : null;

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(MAPP, "public")));

// ---------- Svarsformat (JSON-schema) ----------

const KATEGORIER = ["Överdel", "Underdel", "Ytterplagg", "Klänning/helkropp", "Skor", "Väska", "Accessoar"];
const STILAR = ["Old money", "Skandinavisk minimalism", "Streetwear", "Smart casual", "Vintage", "Sportig"];

const plaggSchema = {
  type: "object",
  properties: {
    typ: { type: "string", description: "Plaggtyp, t.ex. 'Kavaj' eller 'Loafers'" },
    kategori: { type: "string", enum: KATEGORIER },
    marke: { type: "string", description: "Troligt märke, eller 'Okänt'" },
    modell: { type: "string", description: "Trolig modell, eller tom sträng" },
    sakerhet: { type: "string", enum: ["låg", "medel", "hög"], description: "Hur säker märkesgissningen är" },
    sakerhetProcent: { type: "integer", description: "0–100" },
    farg: { type: "string" },
    material: { type: "string" },
    stil: { type: "string", enum: STILAR },
    beskrivning: { type: "string", description: "En kort mening om plagget" },
    sokord: { type: "string", description: "Bra sökfras på svenska för att hitta liknande plagg" },
  },
  required: ["typ", "kategori", "marke", "modell", "sakerhet", "sakerhetProcent", "farg", "material", "stil", "beskrivning", "sokord"],
  additionalProperties: false,
};

const svarSchema = {
  type: "object",
  properties: {
    sammanfattning: { type: "string", description: "1–2 meningar om helheten och stilen" },
    plagg: { type: "array", items: plaggSchema },
  },
  required: ["sammanfattning", "plagg"],
  additionalProperties: false,
};

const SYSTEM = `Du är en erfaren modeexpert och stylist i en svensk modeapp.
Du får en bild på ett plagg eller en hel outfit. Identifiera varje synligt plagg, skor, väskor och tydliga accessoarer.
Svara alltid på svenska.
För märke och modell: gissa bara om det finns tydliga ledtrådar (logga, typiska detaljer, kända silhuetter). Annars skriv "Okänt" och sätt säkerheten till "låg". Var ärlig om osäkerhet.
Sökorden ska vara korta och fungera i en webbutik, t.ex. "kamelfärgad ullkappa dam" eller "vita läder sneakers minimalistiska". Ta med märket i sökorden bara om säkerheten är hög.
Om bilden inte visar några kläder: returnera en tom lista och förklara kort i sammanfattningen.`;

// ---------- Bildanalys ----------

app.post("/api/analysera", async (req, res) => {
  const bild = String(req.body?.bild || "");
  const match = bild.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ fel: "Ingen giltig bild skickades." });
  }

  if (!claude) {
    // Demoläge: ingen API-nyckel – visa ett exempelsvar så att man kan klicka runt.
    await new Promise((r) => setTimeout(r, 1200));
    return res.json({ ...demoSvar, demo: true });
  }

  try {
    const svar = await claude.messages.create({
      model: MODELL,
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema", schema: svarSchema } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } },
            { type: "text", text: "Analysera plaggen i bilden." },
          ],
        },
      ],
    });

    if (svar.stop_reason === "refusal") {
      return res.status(422).json({ fel: "AI:n kunde inte analysera den här bilden. Prova en annan bild." });
    }
    if (svar.stop_reason === "max_tokens") {
      return res.status(502).json({ fel: "Svaret blev för långt. Prova en bild med färre plagg." });
    }

    const text = svar.content.find((b) => b.type === "text")?.text;
    const data = JSON.parse(text);
    res.json(data);
  } catch (err) {
    console.error("Bildanalysen misslyckades:", err);
    let fel = "Något gick fel med bildanalysen. Försök igen.";
    if (err instanceof Anthropic.AuthenticationError) fel = "API-nyckeln fungerar inte. Kontrollera ANTHROPIC_API_KEY i .env.";
    else if (err instanceof Anthropic.RateLimitError) fel = "För många förfrågningar just nu. Vänta en stund och försök igen.";
    else if (err instanceof Anthropic.APIConnectionError) fel = "Kunde inte nå AI-tjänsten. Kontrollera internetanslutningen.";
    res.status(500).json({ fel });
  }
});

app.get("/api/status", (_req, res) => {
  res.json({ demo: !harNyckel, modell: MODELL });
});

// ---------- Start ----------

app.listen(PORT, "0.0.0.0", () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  console.log(`\nPlaggjakt körs på http://localhost:${PORT}`);
  if (lan) console.log(`På mobilen (samma wifi): http://${lan}:${PORT}`);
  console.log(harNyckel ? `AI: ${MODELL}` : "AI: demoläge (ingen ANTHROPIC_API_KEY i .env)");
  console.log("");
});
