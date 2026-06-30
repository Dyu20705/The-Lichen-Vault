import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { InMemorySpecimenRepository } from "../infrastructure/persistence/inMemorySpecimenRepository";
import { createVaultTools } from "./vaultTools";

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

server.registerTool("list_specimens", {
  title: "List specimens",
  description: "List persisted lichen specimens visible to the MCP repository.",
  inputSchema: {}
}, async () => jsonContent(await tools.list_specimens()));

server.registerTool("get_specimen", {
  title: "Get specimen",
  description: "Read a single specimen by id.",
  inputSchema: { specimenId: z.string().min(1) }
}, async (input) => jsonContent(await tools.get_specimen(input)));

server.registerTool("get_specimen_events", {
  title: "Get specimen events",
  description: "Read event ledger entries for a specimen.",
  inputSchema: { specimenId: z.string().min(1) }
}, async (input) => jsonContent(await tools.get_specimen_events(input)));

server.registerTool("get_evidence", {
  title: "Get evidence",
  description: "Read a persisted evidence record by id.",
  inputSchema: { evidenceId: z.string().min(1) }
}, async (input) => jsonContent(await tools.get_evidence(input)));

server.registerTool("append_observation", {
  title: "Append observation",
  description: "Append an evidence-validated observation. Evidence ids must resolve before the specimen is updated.",
  inputSchema: {
    specimenId: z.string().min(1),
    text: z.string().min(1).max(800),
    evidenceIds: z.array(z.string()).default([])
  }
}, async (input) => jsonContent(await tools.append_observation(input)));

server.registerTool("propose_intervention", {
  title: "Propose intervention",
  description: "Create an intervention proposal. High-risk actions are proposed only and never executed by this tool.",
  inputSchema: {
    specimenId: z.string().min(1),
    action: z.enum(["adjust_light", "adjust_humidity", "pause_growth", "merge_records", "delete_specimen", "export_data"]),
    reason: z.string().min(1),
    evidenceIds: z.array(z.string()).default([])
  }
}, async (input) => jsonContent(await tools.propose_intervention(input)));

server.registerTool("approve_intervention", {
  title: "Approve intervention",
  description: "Approve a proposal only with trusted user-action context from the application.",
  inputSchema: {
    proposalId: z.string().min(1),
    userId: z.string().min(1),
    trustedUserAction: z.literal(true),
    actionNonce: z.string().min(1)
  }
}, async (input) => jsonContent(await tools.approve_intervention(input)));

server.registerTool("reject_intervention", {
  title: "Reject intervention",
  description: "Reject a proposal only with trusted user-action context from the application.",
  inputSchema: {
    proposalId: z.string().min(1),
    userId: z.string().min(1),
    trustedUserAction: z.literal(true),
    actionNonce: z.string().min(1)
  }
}, async (input) => jsonContent(await tools.reject_intervention(input)));

server.registerTool("export_specimen", {
  title: "Export specimen",
  description: "Create a versioned JSON export only after explicit user confirmation.",
  inputSchema: {
    specimenId: z.string().min(1),
    trustedUserAction: z.literal(true)
  }
}, async (input) => jsonContent(await tools.export_specimen(input)));

const transport = new StdioServerTransport();
await server.connect(transport);
