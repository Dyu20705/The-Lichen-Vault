import path from "path";
import { JsonFileSpecimenRepository } from "../infrastructure/persistence/jsonFileSpecimenRepository";
import { resolveMcpVaultPath } from "./config";
import { importVaultExport } from "./importExport";

const positional = process.argv.slice(2).filter((arg, index, args) => arg !== "--data" && args[index - 1] !== "--data");
const exportPath = positional[0];

if (!exportPath) {
  console.error("Usage: npm run mcp:import -- ./path/to/lichen-vault-export.json [--data ./data/vault.json]");
  process.exit(1);
}

try {
  const dataPath = resolveMcpVaultPath();
  const summary = await importVaultExport({
    exportPath: path.resolve(exportPath),
    repository: new JsonFileSpecimenRepository(dataPath)
  });
  console.log(JSON.stringify({ ok: true, dataPath, summary }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
