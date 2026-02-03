"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { sendLedgerReportEmail } from "@/actions/ledger";
import { Mail, Loader2, Check } from "lucide-react";

export function LedgerReportButton() {
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

    async function handleRequest() {
        if (status === "loading") return;

        setStatus("loading");
        try {
            const result = await sendLedgerReportEmail();
            if (result.success) {
                setStatus("success");
                setTimeout(() => setStatus("idle"), 3000);
            } else {
                setStatus("error");
                setTimeout(() => setStatus("idle"), 3000);
            }
        } catch (error) {
            setStatus("error");
            setTimeout(() => setStatus("idle"), 3000);
        }
    }

    return (
        <Button
            size="sm"
            variant="outline"
            onClick={handleRequest}
            disabled={status === "loading"}
            className="h-8 border-slate-800 bg-slate-900/50 text-slate-400 hover:text-slate-200 transition-all gap-2"
        >
            {status === "loading" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
            ) : status === "success" ? (
                <Check className="h-3 w-3 text-green-500" />
            ) : (
                <Mail className="h-3 w-3" />
            )}
            {status === "loading" ? "Sending..." : status === "success" ? "Sent!" : status === "error" ? "Failed" : "request ledger till date"}
        </Button>
    );
}
