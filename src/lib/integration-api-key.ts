import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const API_KEY_PATTERN = /^vouch_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{43})$/;

export interface IntegrationApiKeyMaterial {
    apiKey: string;
    keyPrefix: string;
    secretHash: string;
}

export interface ParsedIntegrationApiKey {
    keyPrefix: string;
    secret: string;
}

export function hashIntegrationApiKeySecret(secret: string): string {
    return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function generateIntegrationApiKey(): IntegrationApiKeyMaterial {
    const keyPrefix = randomBytes(9).toString("base64url");
    const secret = randomBytes(32).toString("base64url");

    return {
        apiKey: `vouch_${keyPrefix}_${secret}`,
        keyPrefix,
        secretHash: hashIntegrationApiKeySecret(secret),
    };
}

export function parseIntegrationApiKey(apiKey: string): ParsedIntegrationApiKey | null {
    const match = API_KEY_PATTERN.exec(apiKey);
    if (!match) return null;

    return {
        keyPrefix: match[1],
        secret: match[2],
    };
}

export function verifyIntegrationApiKeySecret(secret: string, storedHash: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(storedHash)) return false;

    const candidate = Buffer.from(hashIntegrationApiKeySecret(secret), "hex");
    const expected = Buffer.from(storedHash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
