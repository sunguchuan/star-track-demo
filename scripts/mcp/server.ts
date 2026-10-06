/**
 * Stdio entry for the fab MCP server (src/lib/mcp/fab-server.ts).
 *
 *   npm run mcp             # or let Cursor start it from .cursor/mcp.json
 *   MCP_TARGET=cloud        # knowledge search with cloud vectors + rerank (needs OPENAI_API_KEY)
 *
 * stdout is the protocol channel: logs go to stderr (Cursor: Output → MCP Logs).
 */
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
// Data and knowledge paths are resolved from the cwd at import time; the client may start us anywhere.
process.chdir(root);
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

await import("../../tests/setup/register.mjs");
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { createFabMcpServer, MCP_SERVER_NAME, resolveMcpTarget } = await import("@/lib/mcp/fab-server");

const log = (line: string) => process.stderr.write(`[${new Date().toISOString()}] ${line}\n`);
const target = resolveMcpTarget();
await createFabMcpServer({ target, log }).connect(new StdioServerTransport());
log(`${MCP_SERVER_NAME} MCP server ready (knowledge search: ${target})`);
