import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemorySpecimenRepository } from "../infrastructure/persistence/inMemorySpecimenRepository";
import {
  AppendObservationSchema,
  createVaultTools,
  ExportSpecimenInputSchema,
  GetEvidenceInputSchema,
  GetSpecimenEventsInputSchema,
  GetSpecimenInputSchema,
  GetWorkflowTracesInputSchema,
  ListSpecimensInputSchema,
  ProposeInterventionSchema,
  TrustedDecisionSchema,
  VaultToolNames
} from "./vaultTools";

const repo = new InMemorySpecimenRepository();
const tools = createVaultTools(repo);

function jsonContent(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}

const server = new McpServer({
  name: "the-lichen-vault",
  version: "0.1.0"
});

if (process.argv.includes("--check")) {
  console.log(JSON.stringify({
    ok: true,
    transport: "stdio",
    tools: VaultToolNames
  }, null, 2));
  process.exit(0);
}

server.registerTool("list_specimens", {
  title: "List specimens",
  description: "List persisted lichen specimens visible to the MCP repository.",
  inputSchema: ListSpecimensInputSchema.shape
}, async () => jsonContent(await tools.list_specimens()));

server.registerTool("get_specimen", {
  title: "Get specimen",
  description: "Read a single specimen by id.",
  inputSchema: GetSpecimenInputSchema.shape
}, async (input) => jsonContent(await tools.get_specimen(input)));

server.registerTool("get_specimen_events", {
  title: "Get specimen events",
  description: "Read event ledger entries for a specimen.",
  inputSchema: GetSpecimenEventsInputSchema.shape
}, async (input) => jsonContent(await tools.get_specimen_events(input)));

server.registerTool("get_evidence", {
  title: "Get evidence",
  description: "Read a persisted evidence record by id.",
  inputSchema: GetEvidenceInputSchema.shape
}, async (input) => jsonContent(await tools.get_evidence(input)));

server.registerTool("get_workflow_traces", {
  title: "Get workflow traces",
  description: "Read persisted workflow/tool traces for a specimen.",
  inputSchema: GetWorkflowTracesInputSchema.shape
}, async (input) => jsonContent(await tools.get_workflow_traces(input)));

server.registerTool("append_observation", {
  title: "Append observation",
  description: "Append an evidence-validated fallback observation. Evidence ids must resolve before the specimen is updated; MCP cannot self-declare grounded text.",
  inputSchema: AppendObservationSchema.shape
}, async (input) => jsonContent(await tools.append_observation(input)));

server.registerTool("propose_intervention", {
  title: "Propose intervention",
  description: "Create an intervention proposal. High-risk actions are proposed only and never executed by this tool.",
  inputSchema: ProposeInterventionSchema.shape
}, async (input) => jsonContent(await tools.propose_intervention(input)));

server.registerTool("approve_intervention", {
  title: "Approve intervention",
  description: "Approve a proposal only when the application boundary validates the user action token.",
  inputSchema: TrustedDecisionSchema.shape
}, async (input) => jsonContent(await tools.approve_intervention(input)));

server.registerTool("reject_intervention", {
  title: "Reject intervention",
  description: "Reject a proposal only when the application boundary validates the user action token.",
  inputSchema: TrustedDecisionSchema.shape
}, async (input) => jsonContent(await tools.reject_intervention(input)));

server.registerTool("export_specimen", {
  title: "Export specimen",
  description: "Create a versioned JSON export only after explicit user confirmation.",
  inputSchema: ExportSpecimenInputSchema.shape
}, async (input) => jsonContent(await tools.export_specimen(input)));

const transport = new StdioServerTransport();
await server.connect(transport);
