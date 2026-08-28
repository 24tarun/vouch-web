import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    generateIntegrationApiKey,
    parseIntegrationApiKey,
    verifyIntegrationApiKeySecret,
} from "../../src/lib/integration-api-key";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const migration = readFileSync(
    join(root, "supabase/migrations/20260828215813_add_integration_api_keys.sql"),
    "utf8"
);

test("generates a parseable API key while storing only its secret hash", () => {
    const generated = generateIntegrationApiKey();
    const parsed = parseIntegrationApiKey(generated.apiKey);

    assert.ok(parsed);
    assert.equal(parsed.keyPrefix, generated.keyPrefix);
    assert.equal(generated.secretHash.length, 64);
    assert.equal(generated.apiKey.includes(generated.secretHash), false);
    assert.equal(
        verifyIntegrationApiKeySecret(parsed.secret, generated.secretHash),
        true
    );
});

test("rejects malformed keys and a different secret", () => {
    const generated = generateIntegrationApiKey();
    const parsed = parseIntegrationApiKey(generated.apiKey);
    assert.ok(parsed);

    assert.equal(parseIntegrationApiKey("vouch_invalid"), null);
    assert.equal(
        verifyIntegrationApiKeySecret("x".repeat(43), generated.secretHash),
        false
    );
});

test("database enforces one protected API key row per user", () => {
    assert.match(
        migration,
        /CONSTRAINT integration_api_keys_pkey PRIMARY KEY \(user_id\)/
    );
    assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
    assert.match(
        migration,
        /REVOKE ALL ON TABLE public\.integration_api_keys FROM anon, authenticated/
    );
    assert.match(
        migration,
        /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.integration_api_keys TO service_role/
    );
});
