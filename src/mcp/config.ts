import path from "path";

export function defaultMcpVaultPath(): string {
  return path.resolve(process.cwd(), "data", "mcp-vault.json");
}

export function resolveMcpVaultPath(argv = process.argv.slice(2), env = process.env): string {
  const dataIndex = argv.indexOf("--data");
  if (dataIndex >= 0 && argv[dataIndex + 1]) {
    return path.resolve(argv[dataIndex + 1]);
  }
  return path.resolve(env.MCP_VAULT_PATH || defaultMcpVaultPath());
}
