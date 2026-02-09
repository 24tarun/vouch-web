import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_req: NextRequest, context: { params: Promise<{ taskId: string }> }) {
    const secFetchSite = _req.headers.get("sec-fetch-site");
    const secFetchDest = _req.headers.get("sec-fetch-dest");
    const allowedDests = new Set(["image", "video", "empty"]);

    // Best-effort hardening: only serve same-origin media fetches, not top-level document navigation.
    if (secFetchSite && secFetchSite !== "same-origin") {
        return NextResponse.json({ error: "Cross-site access denied" }, { status: 403 });
    }
    if (secFetchDest && !allowedDests.has(secFetchDest)) {
        return NextResponse.json({ error: "Unsupported fetch destination" }, { status: 403 });
    }

    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { taskId } = await context.params;
    if (!taskId) {
        return NextResponse.json({ error: "Task id is required" }, { status: 400 });
    }

    const { data: task } = await (supabase.from("tasks") as any)
        .select("id, voucher_id, status, voucher_response_deadline")
        .eq("id", taskId as any)
        .eq("voucher_id", user.id as any)
        .maybeSingle();

    if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if ((task as any).status !== "AWAITING_VOUCHER") {
        return NextResponse.json({ error: "Proof is no longer available" }, { status: 410 });
    }

    const responseDeadline = (task as any).voucher_response_deadline as string | null;
    if (responseDeadline && Date.now() > new Date(responseDeadline).getTime()) {
        return NextResponse.json({ error: "Proof window has expired" }, { status: 410 });
    }

    const { data: proof } = await (supabase.from("task_completion_proofs") as any)
        .select("bucket, object_path, mime_type, upload_state")
        .eq("task_id", taskId as any)
        .eq("voucher_id", user.id as any)
        .eq("upload_state", "UPLOADED")
        .maybeSingle();

    if (!proof) {
        return NextResponse.json({ error: "Proof not found" }, { status: 404 });
    }

    const supabaseAdmin = createAdminClient();
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
        .from((proof as any).bucket as string)
        .download((proof as any).object_path as string);

    if (downloadError || !fileData) {
        return NextResponse.json(
            { error: downloadError?.message || "Could not download proof media" },
            { status: 404 }
        );
    }

    const buffer = await fileData.arrayBuffer();
    return new NextResponse(buffer, {
        status: 200,
        headers: {
            "Content-Type": ((proof as any).mime_type as string) || "application/octet-stream",
            "Content-Length": String(buffer.byteLength),
            "Cache-Control": "private, no-store, no-cache, must-revalidate, proxy-revalidate",
            Pragma: "no-cache",
            Expires: "0",
            "Content-Disposition": "inline",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
