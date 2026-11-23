import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { authenticateIntegrationRequest, jsonNoStore } from "@/lib/integration-request";
import { getIntegrationSession } from "@/lib/integration-session";
import { runWithIntegrationContext } from "@/lib/integration-context";
import { MCP_TOOLS } from "@/lib/mcp/tools";

/**
 * Stateless MCP server (Streamable HTTP, JSON responses). Auth: `Authorization: Bearer vouch_…`.
 * Every tool runs as the API key's owner through the app's own actions.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS =
    "Vouch is an accountability app: tasks have deadlines, a voucher who approves completion, and a failure cost. " +
    "Times are ISO 8601; read times back to the user in the 'timezone' returned by get_calendar. " +
    "Tool results with an 'error' field mean the action was refused; tell the user why.";

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const toolList = MCP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, { io: "input" }),
}));

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
    return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
    return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function textResult(value: unknown, isError = false) {
    return { content: [{ type: "text", text: JSON.stringify(value ?? null, null, 2) }], ...(isError ? { isError: true } : {}) };
}

async function callTool(params: Record<string, unknown> | undefined, userId: string, keyPrefix: string) {
    const tool = MCP_TOOLS.find((entry) => entry.name === params?.name);
    if (!tool) return textResult({ error: `Unknown tool "${String(params?.name)}".` }, true);
    const parsed = tool.input.safeParse(params?.arguments ?? {});
    if (!parsed.success) return textResult({ error: "Invalid arguments.", issues: z.flattenError(parsed.error) }, true);

    const { session, error } = await getIntegrationSession(userId, keyPrefix);
    if (!session) return textResult({ error }, true);
    try {
        const result = await runWithIntegrationContext(
            { userId, instanceKey: `api-${keyPrefix}`, session },
            () => tool.run(parsed.data as never, userId)
        );
        const failed = Boolean(result && typeof result === "object" && "error" in result && (result as { error?: unknown }).error);
        return textResult(result, failed);
    } catch (thrown) {
        if (isRedirectError(thrown)) return textResult({ ok: true });
        console.error(`MCP tool ${tool.name} failed`, thrown);
        return textResult({ error: thrown instanceof Error ? thrown.message : "Tool failed." }, true);
    }
}

async function handle(message: JsonRpcRequest, userId: string, keyPrefix: string) {
    switch (message.method) {
        case "initialize": {
            const requested = String(message.params?.protocolVersion ?? "");
            return rpcResult(message.id, {
                protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: "vouch", version: "1.0.0" },
                instructions: INSTRUCTIONS,
            });
        }
        case "ping":
            return rpcResult(message.id, {});
        case "tools/list":
            return rpcResult(message.id, { tools: toolList });
        case "tools/call":
            return rpcResult(message.id, await callTool(message.params, userId, keyPrefix));
        default:
            return rpcError(message.id, -32601, `Method not found: ${message.method}`);
    }
}

export async function POST(request: NextRequest) {
    const auth = await authenticateIntegrationRequest(request, "mcp");
    if (auth.response) return auth.response;

    const body = await request.json().catch(() => null);
    const messages: unknown[] = Array.isArray(body) ? body : [body];
    const valid = messages.filter((message): message is JsonRpcRequest =>
        Boolean(message && typeof message === "object" && typeof (message as JsonRpcRequest).method === "string"));
    if (valid.length === 0) return jsonNoStore(rpcError(null, -32700, "Parse error"), 400);

    // Notifications (no id) get no response body.
    const requests = valid.filter((message) => message.id !== undefined && message.id !== null);
    const responses = await Promise.all(requests.map((message) => handle(message, auth.userId, auth.keyPrefix)));
    if (responses.length === 0) return new NextResponse(null, { status: 202 });
    return jsonNoStore(Array.isArray(body) ? responses : responses[0]);
}

/** No server-initiated stream: this server is stateless. */
export function GET() {
    return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
