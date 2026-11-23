import { NextRequest } from "next/server";
import { z } from "zod";
import { authenticateIntegrationRequest, jsonNoStore } from "@/lib/integration-request";
import { loadCalendarRange } from "@/lib/calendar/service";
import { integrationDb, serializeCalendar } from "@/lib/calendar/integration";

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = z.iso.datetime({ offset: true });

/** GET /api/integrations/calendar?from=&to= — deadlines, blocks, upcoming repeats (max 15 days, default next 7). */
export async function GET(request: NextRequest) {
    const auth = await authenticateIntegrationRequest(request, "calendar");
    if (auth.response) return auth.response;

    const params = request.nextUrl.searchParams;
    const fromInput = params.get("from");
    const toInput = params.get("to");
    if ((fromInput && !iso.safeParse(fromInput).success) || (toInput && !iso.safeParse(toInput).success)) {
        return jsonNoStore({ error: "from and to must be ISO 8601 timestamps with a timezone." }, 400);
    }
    const fromMs = fromInput ? Date.parse(fromInput) : Date.now();
    const toMs = toInput ? Date.parse(toInput) : fromMs + 7 * DAY_MS;
    const range = { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };

    const db = integrationDb();
    const [result, profile] = await Promise.all([
        loadCalendarRange(db, auth.userId, range.from, range.to),
        db.from("profiles").select("timezone").eq("id", auth.userId).maybeSingle(),
    ]);
    if (!result.data) return jsonNoStore({ error: result.error || "Could not load calendar." }, 400);
    return jsonNoStore(serializeCalendar(result.data, range, (profile.data as { timezone?: string | null } | null)?.timezone ?? null));
}
