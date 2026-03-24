import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TASK_PROOFS_BUCKET } from "@/lib/task-proof-shared";
import { proofUploadLimiter, checkRateLimit } from "@/lib/rate-limit";

interface ProofAccessTask {
    id: string;
    user_id: string;
    voucher_id: string;
    status: string;
    voucher_response_deadline: string | null;
}

interface CompletionProofRow {
    bucket: string;
    object_path: string;
    mime_type: string;
    owner_id: string;
}

function hasSafeProofPath(objectPath: string): boolean {
    if (!objectPath) return false;
    if (objectPath.startsWith("/") || objectPath.includes("..") || objectPath.includes("\\")) {
        return false;
    }
    return true;
}

function jsonNoStore(body: { error: string }, status: number) {
    return NextResponse.json(body, {
        status,
        headers: {
            "Cache-Control": "private, no-store, no-cache, must-revalidate, proxy-revalidate",
            Pragma: "no-cache",
            Expires: "0",
        },
    });
}

export async function GET(_req: NextRequest, context: { params: Promise<{ taskId: string }> }) {
    const secFetchSite = _req.headers.get("sec-fetch-site");
    const secFetchDest = _req.headers.get("sec-fetch-dest");
    const allowedDests = new Set(["image", "video", "empty"]);

    // Best-effort hardening: only serve same-origin media fetches, not top-level document navigation.
    if (secFetchSite && secFetchSite !== "same-origin") {
        return jsonNoStore({ error: "Cross-site access denied" }, 403);
    }
    if (secFetchDest && !allowedDests.has(secFetchDest)) {
        return jsonNoStore({ error: "Unsupported fetch destination" }, 403);
    }

    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return jsonNoStore({ error: "Not authenticated" }, 401);
    }

    const { limited } = await checkRateLimit(proofUploadLimiter, `proof:${user.id}`);
    if (limited) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const { taskId } = await context.params;
    if (!taskId) {
        return jsonNoStore({ error: "Task id is required" }, 400);
    }

    const { data: rawTask } = await supabase
        .from("tasks")
        .select("id, user_id, voucher_id, status, voucher_response_deadline")
        .eq("id", taskId)
        .maybeSingle();
    const task = rawTask as ProofAccessTask | null;

    if (!task) {
        return jsonNoStore({ error: "Task not found" }, 404);
    }

    const isOwner = task.user_id === user.id;
    const isVoucher = task.voucher_id === user.id;
    if (!isOwner && !isVoucher) {
        return jsonNoStore({ error: "Task not found" }, 404);
    }

    const status = task.status;
    if (status !== "AWAITING_VOUCHER" && status !== "AWAITING_ORCA" && status !== "MARKED_COMPLETE") {
        return jsonNoStore({ error: "Proof is no longer available" }, 410);
    }

    const responseDeadline = task.voucher_response_deadline;
    if (responseDeadline && Date.now() > new Date(responseDeadline).getTime()) {
        return jsonNoStore({ error: "Proof window has expired" }, 410);
    }

    const { data: rawProof } = await supabase
        .from("task_completion_proofs")
        .select("bucket, object_path, mime_type, upload_state, owner_id")
        .eq("task_id", taskId)
        .eq("upload_state", "UPLOADED")
        .maybeSingle();
    const proof = rawProof as CompletionProofRow | null;

    if (!proof) {
        return jsonNoStore({ error: "Proof not found" }, 404);
    }

    const expectedPrefix = `${task.user_id}/${task.id}/`;
    if (
        proof.bucket !== TASK_PROOFS_BUCKET ||
        proof.owner_id !== task.user_id ||
        !hasSafeProofPath(proof.object_path) ||
        !proof.object_path.startsWith(expectedPrefix)
    ) {
        return jsonNoStore({ error: "Proof metadata is invalid" }, 400);
    }

    const supabaseAdmin = createAdminClient();
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
        .from(proof.bucket)
        .download(proof.object_path);

    if (downloadError || !fileData) {
        return jsonNoStore(
            { error: downloadError?.message || "Could not download proof media" },
            404
        );
    }

    const buffer = await fileData.arrayBuffer();
    return new NextResponse(buffer, {
        status: 200,
        headers: {
            "Content-Type": proof.mime_type || "application/octet-stream",
            "Content-Length": String(buffer.byteLength),
            "Cache-Control": "private, max-age=300, immutable",
            "Content-Disposition": "inline",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
