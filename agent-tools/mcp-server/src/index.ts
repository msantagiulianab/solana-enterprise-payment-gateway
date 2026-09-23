#!/usr/bin/env node
/**
 * MCP server exposing the x402 `screen-address` compliance endpoint as an
 * autonomous tool for AI agents (Claude Desktop, Cursor, ElizaOS).
 *
 * Runs over stdio; stdout is reserved exclusively for the JSON-RPC transport,
 * so all human-readable logging goes to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { isValidSolanaAddress } from "./base58.js";
import { DEFAULT_GATEWAY_BASE_URL, X402Client, type ScreeningResult } from "./x402-client.js";

const TOOL_NAME = "screen_solana_address";
const TOOL_DESCRIPTION =
  "Inspect a Solana address against sanctions and threat intelligence databases. " +
  "Automatically negotiates and settles micro-payments via x402.";

const solanaAddressSchema = z.string().refine(isValidSolanaAddress, {
  message: "address must be a valid Base58 Solana public key (decodes to 32 bytes)",
});

export function formatScreeningResult(result: ScreeningResult): string {
  return JSON.stringify(
    {
      address: result.address,
      verdict: result.verdict,
      riskScore: result.riskScore,
      flags: result.flags ?? [],
      sanctionsMatch: result.sanctionsMatch,
      lastEvaluated: result.lastEvaluated,
      evaluationTimestamp: result.timestamp ?? result.lastEvaluated,
    },
    null,
    2,
  );
}

export function createServer(client: X402Client): McpServer {
  const server = new McpServer({
    name: "x402-compliance-gateway",
    version: "1.0.0",
  });

  server.registerTool(
    TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema: { address: solanaAddressSchema },
    },
    async ({ address }) => {
      try {
        const result = await client.screenAddress(address);
        return {
          content: [{ type: "text" as const, text: formatScreeningResult(result) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `screen-address failed: ${message}` }],
        };
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const client = new X402Client();
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const gateway = process.env.GATEWAY_BASE_URL?.trim() || DEFAULT_GATEWAY_BASE_URL;
  const channelId = process.env.X402_CHANNEL_ID ?? "chan_smoke_test_001";
  process.stderr.write(
    `[x402-mcp] connected (gateway=${gateway}, channel=${channelId}, payer=${client.payerPublicKey})\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `[x402-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});

