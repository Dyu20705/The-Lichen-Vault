import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction =
  process.env.NODE_ENV === "production" ||
  process.argv.includes("--production") ||
  process.env.npm_lifecycle_event === "start";

app.use(express.json());

// Initialize GoogleGenAI client lazily or if key is present
let aiClient: any = null;
function getGeminiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY not configured. Falling back to local whispering matrix.");
      return null;
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

const LOCAL_FALLBACKS = [
  "The specimen has shifted slightly since the previous observation.",
  "No explanation has been recorded for the amber nodes in the thallus.",
  "The organism appears to favor complete darkness; luminescent spikes reduce when exposed to light.",
  "Thin filaments have begun to wind around the lower contact pins of the glass vessel.",
  "A faint growth appeared overnight near the left node, although no environmental change was registered.",
  "The third breath footprint continues to pulse at a frequency of 0.8 HZ. This remains unexplained.",
  "The outer membrane has taken on a drier, paper-like texture. Air exchange rates remain completely constant.",
  "An unexpected circular spot has matured near the base of the thallus. It mimics classical stone rust.",
  "We have noticed a faint, mineral-scented exudate pooling on the container floor. Vacuum pressure is unaffected.",
  "The specimen appears darker than previous photographic plates. The lighting system has been verified.",
  "A new fork emerged from the primary stem. It does not follow the traditional branching sequence.",
  "The current form no longer resembles the initial deposit photograph. The original plates remain in the ledger."
];

// Endpoint to generate mysterious lichen Archival Observation
app.post("/api/generate-fragment", async (req, res) => {
  try {
    const { name, age, growthStage } = req.body;
    
    const client = getGeminiClient();
    if (!client) {
      // Pick random fallback
      const randomMsg = LOCAL_FALLBACKS[Math.floor(Math.random() * LOCAL_FALLBACKS.length)];
      return res.json({ fragment: randomMsg });
    }

    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `You are the Archivist of the Lichen Vault, a silent, forgotten biological archive and deep-time monastery where human breathing volatiles are preserved as slow-growing digital organisms.
You are writing a short, chronological observation ledger entry about the specimen named "${name}" (botanical class of "${growthStage}").
The entry must feel like a calm, scientific, slightly unsettling (but never horror) note written in a custodian's ledger.
It must sound as if you are observing the physical, quiet changes of a living organism that has been kept in a dark containing vault.

Guidelines:
- Write about slow chemical transitions, thallus behaviors under glass, response to complete darkness, structural developments, quiet anomalies, or physical shift.
- NEVER use game-like terms (no "level", "evolution", "experience", "power", "rarity", "stats", "upgrade", "species class").
- NEVER refer to software, algorithms, or digital concepts. Treat the specimen as a physical biological organism in a vacuum cell.
- Do NOT explain why things occur; leave it unresolved (e.g. "We have no explanation", "No trigger has been captured").
- The tone must be neutral, calm, scientific, and atmospheric.
- Keep the length strictly to 1 or 2 elegant, highly readable sentences.
- Do NOT use emojis or surround in quotes.`,
      config: {
        temperature: 0.9
      }
    });

    const generatedText = response.text?.trim()?.replace(/^["']|["']$/g, "") || LOCAL_FALLBACKS[0];
    res.json({ fragment: generatedText });
  } catch (err: any) {
    console.error("Error generating fragment from Gemini:", err);
    const randomMsg = LOCAL_FALLBACKS[Math.floor(Math.random() * LOCAL_FALLBACKS.length)];
    res.json({ fragment: randomMsg });
  }
});

async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Serve index.html for any remaining route in production
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`The Lichen Vault Server running on http://localhost:${PORT}`);
  });
}

startServer();
