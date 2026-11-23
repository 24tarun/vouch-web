import * as auth from "@/actions/auth";
import * as calendar from "@/actions/calendar";
import * as commitments from "@/actions/commitments";
import * as dataExport from "@/actions/export";
import * as friends from "@/actions/friends";
import * as googleCalendar from "@/actions/google-calendar";
import * as groups from "@/actions/groups";
import * as ledger from "@/actions/ledger";
import * as rectification from "@/actions/rectification";
import * as reputation from "@/actions/reputation";
import * as tasks from "@/actions/tasks";
import * as pomodoro from "@/actions/tasks/pomodoro";
import * as recurrence from "@/actions/tasks/recurrence";
import * as voucher from "@/actions/voucher";

/**
 * Never callable with an API key: sign-in/out and account deletion, key management
 * (a key must not mint or keep itself alive), browser-only flows, and the one action
 * that takes an arbitrary user id.
 */
const BLOCKED = new Set([
    "signIn", "signUp", "requestPasswordReset", "completePasswordReset", "signOut", "deleteAccount",
    "startGoogleCalendarConnect",
    "getCachedActiveTasksForUser",
]);

type Action = (...args: unknown[]) => Promise<unknown>;

export const INTEGRATION_ACTIONS: Record<string, Action> = Object.fromEntries(
    Object.entries({
        ...auth, ...calendar, ...commitments, ...dataExport, ...friends, ...googleCalendar, ...groups,
        ...ledger, ...rectification, ...reputation, ...tasks, ...pomodoro, ...recurrence, ...voucher,
    }).filter(([name, value]) => typeof value === "function" && !BLOCKED.has(name))
) as Record<string, Action>;

/** JSON can't carry FormData, so `{ "$formData": { key: value | value[] } }` becomes one. */
export function decodeActionArgs(args: unknown[]): unknown[] {
    return args.map((arg) => {
        if (!arg || typeof arg !== "object" || !("$formData" in arg)) return arg;
        const formData = new FormData();
        for (const [key, value] of Object.entries((arg as { $formData: Record<string, unknown> }).$formData ?? {})) {
            for (const entry of Array.isArray(value) ? value : [value]) {
                if (entry !== undefined && entry !== null) formData.append(key, typeof entry === "string" ? entry : JSON.stringify(entry));
            }
        }
        return formData;
    });
}
