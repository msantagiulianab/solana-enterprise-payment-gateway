import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, "..", "dist", "index.js");

const CLEAN_ADDRESS = "4Nd1mBQtrMJVYVfKf2PJy9NZGibCcTRxpETqdrBHu19Y";
const FLAGGED_ADDRESS = "Fc1EwQUZyTEagaDvA1utHXCcZNyG1x2PLt2DfNu1cJdH";

const CHALLENGE = {
  x402Version: 2,
  scheme: "channel",
  network: "solana:devnet",
  escrowAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  asset: "USDC",
  priceAtomicUnits: 5000,
  unit: "per-call",
  message: "Payment required via Solana payment channel or gasless voucher",
};

function startGateway() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const signature = req.headers["payment-signature"];
      if (!signature) {
        const b64 = Buffer.from(JSON.stringify(CHALLENGE), "utf8").toString("base64");
        res.writeHead(402, {
          "content-type": "application/json",
          "PAYMENT-REQUIRED": b64,
        });
        res.end(JSON.stringify(CHALLENGE));
        return;
      }

      const address = JSON.parse(body).address;
      const blocked = address === FLAGGED_ADDRESS;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          address,
          verdict: blocked ? "BLOCKED" : "CLEAR_TO_TRANSACT",
          riskScore: blocked ? 100 : 0,
          flags: blocked
            ? [{ category: "OFAC_SANCTIONED", riskScore: 100, description: "OFAC SDN listed" }]
            : [],
          sanctionsMatch: blocked,
          lastEvaluated: new Date().toISOString(),
          timestamp: Date.now(),
        }),
      );
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port }),
    );
  });
}

test(
  "exposes and executes the screen_solana_address MCP tool over stdio",
  { timeout: 30000 },
  async () => {
    const gw = await startGateway();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_ENTRY],
      env: { ...process.env, GATEWAY_BASE_URL: `http://127.0.0.1:${gw.port}` },
    });
    const client = new Client({ name: "test-agent", version: "1.0.0" });

    try {
      await client.connect(transport);

      const tools = await client.listTools();
      const tool = tools.tools.find((t) => t.name === "screen_solana_address");
      assert.ok(tool, "screen_solana_address tool is registered");
      assert.match(tool.description, /sanctions and threat intelligence/);

      const cleanResult = await client.callTool({
        name: "screen_solana_address",
        arguments: { address: CLEAN_ADDRESS },
      });
      const cleanText = cleanResult.content.find((c) => c.type === "text")?.text ?? "";
      assert.match(cleanText, /CLEAR_TO_TRANSACT/);

      const blockedResult = await client.callTool({
        name: "screen_solana_address",
        arguments: { address: FLAGGED_ADDRESS },
      });
      const blockedText = blockedResult.content.find((c) => c.type === "text")?.text ?? "";
      assert.match(blockedText, /BLOCKED/);
      assert.match(blockedText, /OFAC_SANCTIONED/);
    } finally {
      await client.close();
      gw.server.close();
    }
  },
);
