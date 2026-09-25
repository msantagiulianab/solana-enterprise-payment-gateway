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
const TX_SIGNATURE =
  "3zKcze3Q9DDRui2YCMeTPsBs3mxymxMN3oCvNDVKkrbgtZsR6CVfrLaMPd1kVHjoiAYEqTLNYxAzeABmdBMWSWhm";

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

async function connectServer() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env: { ...process.env, GATEWAY_BASE_URL: "http://127.0.0.1:9" },
  });
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(transport);
  return client;
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

test(
  "exposes and executes the get_channel_status MCP tool over stdio",
  { timeout: 30000 },
  async () => {
    const client = await connectServer();
    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((t) => t.name === "get_channel_status");
      assert.ok(tool, "get_channel_status tool is registered");
      assert.match(tool.description, /operational status/);

      const result = await client.callTool({
        name: "get_channel_status",
        arguments: { channel_id: "chan_smoke_test_001" },
      });
      const text = result.content.find((c) => c.type === "text")?.text ?? "";
      const payload = JSON.parse(text);
      assert.equal(payload.channelId, "chan_smoke_test_001");
      assert.equal(payload.status, "ACTIVE");
      assert.equal(payload.currency, "USDC");
      assert.equal(payload.network, "solana-devnet");
      assert.equal(payload.capacity, "10000.00");
      assert.ok(Number.isInteger(payload.lastSettlementBlock));
      assert.ok(payload.lastSettlementBlock > 0);

      const blank = await client.callTool({
        name: "get_channel_status",
        arguments: { channel_id: "   " },
      });
      assert.equal(blank.isError, true);

      const invalid = await client.callTool({
        name: "get_channel_status",
        arguments: { channel_id: "not a channel!!" },
      });
      assert.equal(invalid.isError, true);
    } finally {
      await client.close();
    }
  },
);

test(
  "exposes and executes the generate_compliance_report MCP tool over stdio",
  { timeout: 30000 },
  async () => {
    const client = await connectServer();
    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((t) => t.name === "generate_compliance_report");
      assert.ok(tool, "generate_compliance_report tool is registered");
      assert.match(tool.description, /immutable audit summary/);

      const addressResult = await client.callTool({
        name: "generate_compliance_report",
        arguments: { identifier: CLEAN_ADDRESS },
      });
      const addressText = addressResult.content.find((c) => c.type === "text")?.text ?? "";
      const addressReport = JSON.parse(addressText);
      assert.equal(addressReport.identifier, CLEAN_ADDRESS);
      assert.equal(addressReport.complianceStatus, "PASSED");
      assert.equal(addressReport.riskScore, 0);
      assert.deepEqual(addressReport.checkedLists, ["OFAC", "EU_SANCTIONS", "CHAIN_REPUTATION"]);
      assert.ok(addressReport.timestamp, "timestamp is present");
      assert.match(addressReport.reportId, /^rpt_[0-9a-f]{32}$/);

      const sigResult = await client.callTool({
        name: "generate_compliance_report",
        arguments: { identifier: TX_SIGNATURE },
      });
      const sigText = sigResult.content.find((c) => c.type === "text")?.text ?? "";
      assert.match(sigText, /PASSED/);

      const blank = await client.callTool({
        name: "generate_compliance_report",
        arguments: { identifier: "" },
      });
      assert.equal(blank.isError, true);

      const malformed = await client.callTool({
        name: "generate_compliance_report",
        arguments: { identifier: "not-a-valid-solana-identifier" },
      });
      assert.equal(malformed.isError, true);
    } finally {
      await client.close();
    }
  },
);
