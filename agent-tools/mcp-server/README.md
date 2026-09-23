# x402 MCP Server

A lightweight, zero-bloat [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server that exposes the Solana Enterprise Payment Gateway's
`POST /api/v1/compliance/screen-address` endpoint as an autonomous tool for AI
agents (Claude Desktop, Cursor, ElizaOS).

The agent transparently negotiates and settles the x402 micro-payment on every
screen: it receives the HTTP `402 Payment Required` challenge, signs an
Ed25519 channel voucher in-memory (Node.js built-in `crypto`, no Web3 SDK), and
retries with a `PAYMENT-SIGNATURE` header.

## Layout

```
agent-tools/mcp-server/
├── src/
│   ├── base58.ts          # zero-dependency Base58 codec
│   ├── ed25519.ts         # Node crypto Ed25519 keypair + canonical payload
│   ├── x402-client.ts     # autonomous X402Client (402 -> sign -> retry)
│   └── index.ts           # MCP server + tool registration
├── test/                  # offline unit + stdio integration tests
├── test-agent-call.js     # live verification against the running Docker stack
├── package.json
└── tsconfig.json
```

## Install & build

```bash
cd agent-tools/mcp-server
npm install
npm run build          # tsc -> dist/ (ESM)
```

## Run (stdio transport)

```bash
npm start
# or: node dist/index.js
```

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GATEWAY_BASE_URL` | `https://msb-solana-enterprise-payment-gateway.duckdns.org` | Gateway root URL |
| `X402_CHANNEL_ID` | `chan_smoke_test_001` | x402 payment channel id |
| `X402_PRIVATE_KEY_SEED` | sha256 of `smoke-test-payer-seed-v1` | 64-hex or UTF-8 material seed |

The tool `screen_solana_address`:

- **Description:** _Inspect a Solana address against sanctions and threat
  intelligence databases. Automatically negotiates and settles micro-payments
  via x402._
- **Input:** `address` — a valid Base58 Solana public key (decodes to 32 bytes).
- **Output:** formatted JSON text containing `verdict`, `riskScore`, `flags`,
  and the evaluation timestamp.

## Tests

```bash
npm test
```

This compiles the project and runs:

- `base58.test.js` — Base58 codec round-trips and 32-byte address validation.
- `ed25519.test.js` — golden-vector check that the canonical payload and Ed25519
  signature exactly match `smoke-test.sh` / the JVM `PaymentVoucher` layout.
- `x402-client.test.js` — full 402→sign→retry negotiation against a mock gateway,
  with independent Ed25519 signature verification of the emitted voucher.
- `mcp-server.test.js` — spawns the real server and drives it with an MCP client
  over stdio (list tools + call `screen_solana_address`).

## Live verification against the running stack

With the Docker stack up (`docker compose up -d --build`):

```bash
npm run test:tool
```

This exercises the tool handler against `http://localhost:8080`:

- Clean address `4Nd1mBQtrMJVYVfKf2PJy9NZGibCcTRxpETqdrBHu19Y` → `CLEAR_TO_TRANSACT`.
- Flagged address `Fc1EwQUZyTEagaDvA1utHXCcZNyG1x2PLt2DfNu1cJdH` → `BLOCKED`.

## Client configuration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "x402-compliance": {
      "command": "node",
      "args": ["C:/Development/solana-enterprise-payment-gateway/agent-tools/mcp-server/dist/index.js"],
      "env": {
        "GATEWAY_BASE_URL": "http://localhost:8080",
        "X402_CHANNEL_ID": "chan_smoke_test_001"
      }
    }
  }
}
```

### Cursor

Add an MCP server entry (Settings → MCP) pointing at the same
`node dist/index.js` command.

### ElizaOS

Register a stdio-based MCP client plugin using the same command; the tool
`screen_solana_address` becomes callable by the agent.
