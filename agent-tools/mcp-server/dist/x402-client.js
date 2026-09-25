/**
 * Autonomous x402 payment client for the Solana Enterprise Payment Gateway.
 *
 * Zero Web3 dependencies: Ed25519 signing and Base58 encoding use Node.js
 * built-in `crypto` plus the hand-rolled codec in `base58.ts`.
 */
import { base58Encode } from "./base58.js";
import { buildCanonicalPayload, deriveKeypairFromSeed, deriveSeedFromMaterial, signCanonicalPayload, } from "./ed25519.js";
export class X402ClientError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`Gateway returned HTTP ${status}: ${body}`);
        this.name = "X402ClientError";
        this.status = status;
        this.body = body;
    }
}
export const DEFAULT_GATEWAY_BASE_URL = "https://msb-solana-enterprise-payment-gateway.duckdns.org";
const DEFAULT_CHANNEL_ID = "chan_smoke_test_001";
const DEFAULT_SEED_MATERIAL = "smoke-test-payer-seed-v1";
const DEFAULT_PRICE_ATOMIC_UNITS = 5000;
/**
 * Resolve the gateway root URL from the environment, preferring
 * `X402_GATEWAY_URL` and falling back to the legacy `GATEWAY_BASE_URL`.
 */
export function resolveGatewayBaseUrl() {
    return (process.env.X402_GATEWAY_URL?.trim() ||
        process.env.GATEWAY_BASE_URL?.trim() ||
        DEFAULT_GATEWAY_BASE_URL);
}
/**
 * Resolve the x402 payment channel id, preferring `X402_CHANNEL_ID` and
 * falling back to the legacy `CHANNEL_ID`.
 */
export function resolveChannelId() {
    return (process.env.X402_CHANNEL_ID?.trim() ||
        process.env.CHANNEL_ID?.trim() ||
        DEFAULT_CHANNEL_ID);
}
export class X402Client {
    baseUrl;
    channelId;
    keypair;
    payerPubkey;
    fetchImpl;
    lastNonce = 0n;
    cumulativeAmountAtomic = 0n;
    constructor(options = {}) {
        const resolvedBaseUrl = options.baseUrl ?? resolveGatewayBaseUrl();
        this.baseUrl = resolvedBaseUrl.replace(/\/+$/, "");
        this.channelId = options.channelId ?? resolveChannelId();
        this.keypair = deriveKeypairFromSeed(resolveSeed(options.seed));
        this.payerPubkey = base58Encode(this.keypair.publicKey);
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    }
    get payerPublicKey() {
        return this.payerPubkey;
    }
    get currentCumulativeAmountAtomic() {
        return this.cumulativeAmountAtomic;
    }
    /**
     * Screens a Solana address, negotiating and settling the x402 micro-payment
     * automatically. Returns the gateway's final screening verdict.
     */
    async screenAddress(address) {
        const endpoint = `${this.baseUrl}/api/v1/compliance/screen-address`;
        const body = JSON.stringify({ address });
        let response = await this.fetchImpl(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
        });
        if (response.status === 402) {
            const challenge = await this.readChallenge(response);
            const voucherHeader = this.signVoucher(challenge.priceAtomicUnits);
            response = await this.fetchImpl(endpoint, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "PAYMENT-SIGNATURE": voucherHeader,
                },
                body,
            });
        }
        if (!response.ok) {
            throw new X402ClientError(response.status, await safeText(response));
        }
        return (await response.json());
    }
    signVoucher(priceAtomicUnits) {
        const nonce = this.nextNonce();
        const price = Number.isFinite(priceAtomicUnits) && priceAtomicUnits > 0
            ? BigInt(Math.trunc(priceAtomicUnits))
            : BigInt(DEFAULT_PRICE_ATOMIC_UNITS);
        this.cumulativeAmountAtomic += price;
        const payload = buildCanonicalPayload(this.channelId, this.cumulativeAmountAtomic, nonce);
        const signature = signCanonicalPayload(payload, this.keypair.privateKey);
        const voucher = {
            channelId: this.channelId,
            payerPubkey: this.payerPubkey,
            cumulativeAmountAtomic: toSafeNumber(this.cumulativeAmountAtomic),
            nonce: toSafeNumber(nonce),
            signature: base58Encode(signature),
        };
        return Buffer.from(JSON.stringify(voucher), "utf8").toString("base64");
    }
    nextNonce() {
        // Monotonic, wall-clock-seeded nonce: strictly increases across calls and
        // starts far above any nonce previously persisted by the smoke test.
        const now = BigInt(Date.now());
        const candidate = now > this.lastNonce ? now : this.lastNonce + 1n;
        this.lastNonce = candidate;
        return candidate;
    }
    async readChallenge(response) {
        const header = response.headers.get("PAYMENT-REQUIRED") ?? response.headers.get("X-PAYMENT-REQUIRED");
        if (header) {
            try {
                const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
                if (parsed && typeof parsed === "object") {
                    return parsed;
                }
            }
            catch {
                // fall through to the body payload
            }
        }
        const text = await response.text();
        try {
            return JSON.parse(text);
        }
        catch {
            return {};
        }
    }
}
function resolveSeed(seed) {
    if (seed !== undefined && seed !== null) {
        if (typeof seed === "string") {
            const trimmed = seed.trim();
            if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
                return Buffer.from(trimmed, "hex");
            }
            return deriveSeedFromMaterial(trimmed);
        }
        const buf = Buffer.from(seed);
        if (buf.length !== 32) {
            throw new Error(`Ed25519 seed must be 32 bytes, got ${buf.length}`);
        }
        return buf;
    }
    const envSeed = process.env.X402_PRIVATE_KEY_SEED?.trim();
    if (envSeed) {
        if (/^[0-9a-fA-F]{64}$/.test(envSeed)) {
            return Buffer.from(envSeed, "hex");
        }
        return deriveSeedFromMaterial(envSeed);
    }
    return deriveSeedFromMaterial(DEFAULT_SEED_MATERIAL);
}
function toSafeNumber(value) {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`Value ${value} exceeds Number.MAX_SAFE_INTEGER`);
    }
    return Number(value);
}
async function safeText(response) {
    try {
        return await response.text();
    }
    catch {
        return "";
    }
}
