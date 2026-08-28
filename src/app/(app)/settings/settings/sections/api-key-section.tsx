"use client";

import { useState } from "react";
import { Copy, KeyRound, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
    createIntegrationApiKey,
    deleteIntegrationApiKey,
    rotateIntegrationApiKey,
    type IntegrationApiKeySummary,
} from "@/actions/integration-api-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ApiKeySectionProps {
    initialSummary: IntegrationApiKeySummary | null;
}

type PendingAction = "create" | "rotate" | "delete" | null;

function maskApiKeyPrefix(keyPrefix: string): string {
    return `vouch_${keyPrefix.slice(0, 6)}••••••`;
}

export function ApiKeySection({ initialSummary }: ApiKeySectionProps) {
    const [summary, setSummary] = useState(initialSummary);
    const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<PendingAction>(null);

    async function handleCreate() {
        if (pendingAction) return;
        setPendingAction("create");
        try {
            const result = await createIntegrationApiKey();
            if (result.error) {
                toast.error(result.error);
                return;
            }
            setSummary(result.summary);
            setRevealedApiKey(result.apiKey);
        } catch {
            toast.error("Could not create API key.");
        } finally {
            setPendingAction(null);
        }
    }

    async function handleRotate() {
        if (pendingAction || !window.confirm("Rotate API key?")) return;
        setPendingAction("rotate");
        try {
            const result = await rotateIntegrationApiKey();
            if (result.error) {
                toast.error(result.error);
                return;
            }
            setSummary(result.summary);
            setRevealedApiKey(result.apiKey);
        } catch {
            toast.error("Could not rotate API key.");
        } finally {
            setPendingAction(null);
        }
    }

    async function handleDelete() {
        if (pendingAction || !window.confirm("Delete API key?")) return;
        setPendingAction("delete");
        try {
            const result = await deleteIntegrationApiKey();
            if (result.error) {
                toast.error(result.error);
                return;
            }
            setSummary(null);
            setRevealedApiKey(null);
        } catch {
            toast.error("Could not delete API key.");
        } finally {
            setPendingAction(null);
        }
    }

    async function handleCopy() {
        if (!revealedApiKey) return;
        try {
            await navigator.clipboard.writeText(revealedApiKey);
            toast.success("Copied");
        } catch {
            toast.error("Could not copy API key.");
        }
    }

    return (
        <section id="api" className="scroll-mt-24 space-y-5 border-b border-slate-800/80 pb-8">
            <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center text-slate-400">
                    <KeyRound className="h-4 w-4" />
                </span>
                <h2 className="text-lg font-semibold text-white">API</h2>
            </div>

            {revealedApiKey && (
                <div className="flex items-center gap-2">
                    <Input
                        readOnly
                        value={revealedApiKey}
                        aria-label="API key"
                        className="h-11 min-w-0 rounded-xl border-slate-800 bg-slate-950/50 font-mono text-xs text-white"
                    />
                    <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        onClick={handleCopy}
                        aria-label="Copy API key"
                        title="Copy"
                        className="rounded-xl border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white"
                    >
                        <Copy className="h-4 w-4" />
                    </Button>
                </div>
            )}

            <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-mono text-sm text-slate-300">
                    {summary ? maskApiKeyPrefix(summary.keyPrefix) : "No API key"}
                </span>

                {summary ? (
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleRotate}
                            disabled={pendingAction !== null}
                            className="rounded-xl border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white"
                        >
                            <RotateCw className={pendingAction === "rotate" ? "animate-spin" : ""} />
                            {pendingAction === "rotate" ? "Rotating..." : "Rotate"}
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={handleDelete}
                            disabled={pendingAction !== null}
                            className="rounded-xl bg-red-700 text-white hover:bg-red-600"
                        >
                            <Trash2 />
                            {pendingAction === "delete" ? "Deleting..." : "Delete"}
                        </Button>
                    </div>
                ) : (
                    <Button
                        type="button"
                        onClick={handleCreate}
                        disabled={pendingAction !== null}
                        className="rounded-xl bg-slate-100 font-semibold text-slate-950 hover:bg-white"
                    >
                        <KeyRound />
                        {pendingAction === "create" ? "Creating..." : "New key"}
                    </Button>
                )}
            </div>
        </section>
    );
}
