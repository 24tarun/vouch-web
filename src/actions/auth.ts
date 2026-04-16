"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authLimiter, signupLimiter, passwordResetLimiter, checkRateLimit } from "@/lib/rate-limit";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";
import {
    getCurrencySymbol,
    getFailureCostBounds,
    isSupportedCurrency,
    normalizeCurrency,
    type SupportedCurrency,
} from "@/lib/currency";
import { pendingVoucherRequestsTag } from "@/lib/cache-tags";
import { TASK_PROOFS_BUCKET } from "@/lib/task-proof-shared";
import {
    DEFAULT_FAILURE_COST_CENTS,
    DEFAULT_EVENT_DURATION_MINUTES,
    DEFAULT_POMO_DURATION_MINUTES,
    MAX_POMO_DURATION_MINUTES,
} from "@/lib/constants";
import { resolveWebUserClientInstanceId } from "@/lib/user-client-instance";

type PomoAutoEndSource = "sign_out_auto_end";
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

const signInSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
});

const signUpSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
});

const usernameSchema = z.string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores");

const passwordResetSchema = z.object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});

async function autoEndLingeringPomoSession(
    supabase: SupabaseClient<Database>,
    userId: string,
    source: PomoAutoEndSource
) {
    const sessionResult = await (supabase.from("pomo_sessions") as any)
        .select("*")
        .eq("user_id", userId)
        .in("status", ["ACTIVE", "PAUSED"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    const session = sessionResult.data as any;
    const sessionError = sessionResult.error;

    if (sessionError) {
        console.error("Failed to fetch active pomo during sign-out:", sessionError);
        return;
    }

    if (!session) return;

    const now = new Date();
    const startedAt = session.started_at ? new Date(session.started_at) : now;
    const additionalElapsed = session.status === "ACTIVE"
        ? Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000))
        : 0;
    const finalElapsed = (session.elapsed_seconds || 0) + additionalElapsed;
    const isStrictSession = Boolean(session.is_strict);

    const { data: updatedSession, error: updateError } = await (supabase.from("pomo_sessions") as any)
        .update({
            status: isStrictSession ? "DELETED" : "COMPLETED",
            elapsed_seconds: finalElapsed,
            completed_at: now.toISOString(),
        })
        .eq("id", session.id)
        .eq("user_id", userId)
        .in("status", ["ACTIVE", "PAUSED"])
        .select("id")
        .maybeSingle();

    if (updateError) {
        console.error("Failed to auto-end active pomo during sign-out:", updateError);
        return;
    }

    if (!updatedSession) return;
    if (isStrictSession) {
        revalidatePath("/tasks");
        if (session.task_id) {
            revalidatePath(`/tasks/${session.task_id}`);
        }
        return;
    }

    if (!session.task_id) return;

    const { data: task } = await (supabase.from("tasks") as any)
        .select("status")
        .eq("id", session.task_id)
        .eq("user_id", userId)
        .single();

    if (!task?.status) return;

    const { error: eventError } = await (supabase.from("task_events") as any).insert({
        task_id: session.task_id,
        event_type: "POMO_COMPLETED",
        actor_id: userId,
        actor_user_client_instance_id: await resolveWebUserClientInstanceId(userId),
        from_status: task.status,
        to_status: task.status,
        metadata: {
            session_id: session.id,
            duration_minutes: session.duration_minutes,
            elapsed_seconds: finalElapsed,
            source,
        },
    });

    if (eventError && eventError.code !== "23505") {
        console.error("Failed to log auto-ended pomo event:", eventError);
    }

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${session.task_id}`);
}

export async function signIn(formData: FormData) {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const supabase = await createClient();

    const parsedSignIn = signInSchema.safeParse({ email, password });
    if (!parsedSignIn.success) {
        return { error: parsedSignIn.error.issues[0].message };
    }

    const { limited: signInLimited } = await checkRateLimit(authLimiter, `signin:${email}`);
    if (signInLimited) {
        return { error: "Too many attempts. Please try again later." };
    }

    console.log("Attemping sign in for:", email);

    const { error, data } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) {
        console.error("Sign in error:", error);
        return { error: error.message };
    }

    if (!data.user) {
        return { error: "Authentication failed" };
    }

    // Strict Profile Check
    const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", data.user.id)
        .single();

    if (!profile) {
        console.error("No profile found for user:", data.user.id);
        await supabase.auth.signOut();
        return {
            error: "Profile not found. Please contact support or try signing up again."
        };
    }

    revalidatePath("/", "layout");
    redirect("/tasks");
}

export async function signUp(formData: FormData) {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const privacyPolicyAccepted = formData.get("privacyPolicyAccepted");
    const privacyPolicyClicked = formData.get("privacyPolicyClicked");
    const supabase = await createClient();

    const parsedSignUp = signUpSchema.safeParse({ email, password });
    if (!parsedSignUp.success) {
        return { error: parsedSignUp.error.issues[0].message };
    }
    if (privacyPolicyClicked !== "true") {
        return { error: "Please open the Privacy Policy before signing up." };
    }
    if (privacyPolicyAccepted !== "true") {
        return { error: "You must accept the Privacy Policy to create an account." };
    }

    const { limited: signUpLimited } = await checkRateLimit(signupLimiter, `signup:${email}`);
    if (signUpLimited) {
        return { error: "Too many attempts. Please try again later." };
    }

    console.log("Attemping sign up for:", email);

    const { error, data } = await supabase.auth.signUp({
        email,
        password,
        options: {
            emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
            data: {
                username: email.split("@")[0],
                privacy_policy_accepted_at: new Date().toISOString(),
            },
        },
    });

    if (error) {
        console.error("Sign up error:", error);
        return { error: error.message };
    }

    console.log("Sign up successful. User ID:", data.user?.id);

    return { success: true, message: "Check your email to confirm your account!" };
}

export async function requestPasswordReset(formData: FormData) {
    const email = (formData.get("email") as string | null)?.trim() || "";
    if (!email) {
        return { error: "Email is required." };
    }

    const parsedEmail = z.string().email("Invalid email address").safeParse(email);
    if (!parsedEmail.success) {
        return { error: parsedEmail.error.issues[0].message };
    }

    const { limited: pwResetLimited } = await checkRateLimit(passwordResetLimiter, `pwreset:${email}`);
    if (pwResetLimited) {
        return { error: "Too many attempts. Please try again later." };
    }

    const supabase = await createClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const resetRedirectTo = `${appUrl}/auth/callback?next=${encodeURIComponent("/login?mode=reset")}`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: resetRedirectTo,
    });

    if (error) {
        console.error("Password reset request error:", error);
        return { error: error.message };
    }

    return {
        success: true,
        message: "If an account exists for this email, a password reset link has been sent.",
    };
}

export async function completePasswordReset(formData: FormData) {
    const password = (formData.get("password") as string | null) || "";
    const confirmPassword = (formData.get("confirmPassword") as string | null) || "";

    const parsedReset = passwordResetSchema.safeParse({ password, confirmPassword });
    if (!parsedReset.success) {
        return { error: parsedReset.error.issues[0].message };
    }

    const supabase = await createClient();
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
        return { error: "Reset link is invalid or has expired. Please request a new one." };
    }

    const { error } = await supabase.auth.updateUser({
        password,
    });

    if (error) {
        console.error("Password reset completion error:", error);
        return { error: error.message };
    }

    await supabase.auth.signOut();
    revalidatePath("/", "layout");

    return {
        success: true,
        message: "Password updated successfully. Please sign in with your new password.",
    };
}

export async function signOut() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (user) {
        await autoEndLingeringPomoSession(supabase, user.id, "sign_out_auto_end");
        // Reset dashboard tip visibility for the next signed-in session.
        // @ts-ignore
        const { error: resetTipsError } = await (supabase.from("profiles" as any) as any)
            .update({ hide_tips: false } as any)
            .eq("id", user.id as any);

        if (resetTipsError) {
            console.error("Failed to reset hide_tips on sign out:", resetTipsError.message);
        }
    }

    await supabase.auth.signOut();
    revalidatePath("/", "layout");
    redirect("https://tas.tarunh.com");
}

export async function deleteAccount(): Promise<{ success: true } | { error: string }> {
    const supabase = await createClient();
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
        return { error: "Not authenticated" };
    }

    const userId = user.id;
    const supabaseAdmin = createAdminClient();

    const [ownerProofRowsResult, voucherProofRowsResult] = await Promise.all([
        (supabaseAdmin.from("task_completion_proofs") as any)
            .select("bucket, object_path")
            .eq("owner_id", userId as any),
        (supabaseAdmin.from("task_completion_proofs") as any)
            .select("bucket, object_path")
            .eq("voucher_id", userId as any),
    ]);

    if (ownerProofRowsResult.error) {
        return { error: ownerProofRowsResult.error.message };
    }

    if (voucherProofRowsResult.error) {
        return { error: voucherProofRowsResult.error.message };
    }

    const { error: recurrenceRulesDeleteError } = await (supabaseAdmin.from("recurrence_rules") as any)
        .delete()
        .eq("voucher_id", userId as any);

    if (recurrenceRulesDeleteError) {
        return { error: recurrenceRulesDeleteError.message };
    }

    const { error: taskEventsUpdateError } = await (supabaseAdmin.from("task_events") as any)
        .update({ actor_id: null } as any)
        .eq("actor_id", userId as any);

    if (taskEventsUpdateError) {
        return { error: taskEventsUpdateError.message };
    }

    const { error: rectifyPassesUpdateError } = await (supabaseAdmin.from("rectify_passes") as any)
        .update({ authorized_by: null } as any)
        .eq("authorized_by", userId as any);

    if (rectifyPassesUpdateError) {
        return { error: rectifyPassesUpdateError.message };
    }

    const proofRows = [
        ...(((ownerProofRowsResult.data as Array<{ bucket: string | null; object_path: string | null }> | null) || [])),
        ...(((voucherProofRowsResult.data as Array<{ bucket: string | null; object_path: string | null }> | null) || [])),
    ];

    const bucketToPaths = new Map<string, Set<string>>();
    for (const row of proofRows) {
        const objectPath = row.object_path?.trim();
        if (!objectPath) continue;

        const bucket = (row.bucket?.trim() || TASK_PROOFS_BUCKET);
        const existing = bucketToPaths.get(bucket) || new Set<string>();
        existing.add(objectPath);
        bucketToPaths.set(bucket, existing);
    }

    const STORAGE_REMOVE_CHUNK_SIZE = 100;
    for (const [bucket, pathSet] of bucketToPaths.entries()) {
        const paths = Array.from(pathSet.values());
        for (let i = 0; i < paths.length; i += STORAGE_REMOVE_CHUNK_SIZE) {
            const chunk = paths.slice(i, i + STORAGE_REMOVE_CHUNK_SIZE);
            const { error: storageRemoveError } = await supabaseAdmin.storage.from(bucket).remove(chunk);
            if (storageRemoveError) {
                console.error(`Failed deleting proof media from storage bucket ${bucket}:`, storageRemoveError);
            }
        }
    }

    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
        return { error: signOutError.message };
    }

    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(userId, false);
    if (deleteUserError) {
        return { error: deleteUserError.message };
    }

    revalidatePath("/", "layout");
    return { success: true };
}

export async function getActiveVoucherTasks():
Promise<{ tasks: Array<{ id: string; title: string; ownerUsername: string }> } | { error: string }> {
    const supabase = await createClient();
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
        return { error: "Not authenticated" };
    }

    const supabaseAdmin = createAdminClient();
    const { data, error } = await (supabaseAdmin.from("tasks") as any)
        .select("id, title, owner:profiles!tasks_user_id_fkey(username)")
        .eq("voucher_id", user.id as any)
        .in("status", ["ACTIVE", "POSTPONED", "MARKED_COMPLETE", "AWAITING_VOUCHER", "AWAITING_AI", "AWAITING_USER", "ESCALATED"] as any);

    if (error) {
        return { error: error.message };
    }

    const tasks = ((data as any[]) || []).map((task) => ({
        id: String(task.id),
        title: String(task.title || ""),
        ownerUsername: String(task.owner?.username || "unknown"),
    }));

    return { tasks };
}

export async function getUser() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    return user;
}

export async function getProfile(): Promise<ProfileRow | null> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    return (profile as ProfileRow | null) ?? null;
}

export async function updateUserDefaults(formData: FormData) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const defaultPomoDurationRaw = formData.get("defaultPomoDurationMinutes") as string;
    const defaultEventDurationRaw = formData.get("defaultEventDurationMinutes");
    const defaultFailureCostRaw = formData.get("defaultFailureCost") as string;
    const defaultVoucherIdRaw = formData.get("defaultVoucherId") as string;
    const strictPomoEnabledRaw = formData.get("strictPomoEnabled");
    const deadlineOneHourWarningEnabledRaw = formData.get("deadlineOneHourWarningEnabled");
    const deadlineFinalWarningEnabledRaw = formData.get("deadlineFinalWarningEnabled");
    const voucherCanViewActiveTasksEnabledRaw = formData.get("voucherCanViewActiveTasksEnabled");
    const mobileNotificationsEnabledRaw = formData.get("mobileNotificationsEnabled");
    const currencyRaw = formData.get("currency");

    let currency: SupportedCurrency | undefined;
    if (currencyRaw != null && currencyRaw !== "") {
        if (typeof currencyRaw !== "string" || !isSupportedCurrency(currencyRaw)) {
            return { error: "Currency value is invalid." };
        }
        currency = currencyRaw;
    }

    const { data: currentProfile, error: currentProfileError } = await supabase
        .from("profiles")
        .select("currency, default_event_duration_minutes")
        .eq("id", user.id)
        .maybeSingle();

    if (currentProfileError) {
        return { error: currentProfileError.message };
    }

    const defaultPomoDurationMinutes = Number(defaultPomoDurationRaw);
    if (
        !Number.isFinite(defaultPomoDurationMinutes) ||
        !Number.isInteger(defaultPomoDurationMinutes) ||
        defaultPomoDurationMinutes < 1 ||
        defaultPomoDurationMinutes > MAX_POMO_DURATION_MINUTES
    ) {
        return {
            error: `Default Pomodoro duration must be an integer between 1 and ${MAX_POMO_DURATION_MINUTES}.`,
        };
    }

    let defaultEventDurationMinutes: number;
    if (typeof defaultEventDurationRaw === "string" && defaultEventDurationRaw.trim() !== "") {
        defaultEventDurationMinutes = Number(defaultEventDurationRaw);
    } else {
        defaultEventDurationMinutes = Number(
            (currentProfile as { default_event_duration_minutes?: unknown } | null)?.default_event_duration_minutes
            ?? DEFAULT_EVENT_DURATION_MINUTES
        );
    }
    if (
        !Number.isFinite(defaultEventDurationMinutes) ||
        !Number.isInteger(defaultEventDurationMinutes) ||
        defaultEventDurationMinutes < 1 ||
        defaultEventDurationMinutes > 720
    ) {
        return { error: "Default event duration must be an integer between 1 and 720 minutes." };
    }

    const nextCurrency = currency ?? normalizeCurrency((currentProfile as { currency?: unknown } | null)?.currency);
    const failureCostBounds = getFailureCostBounds(nextCurrency);
    const defaultFailureCostMajor = Number(defaultFailureCostRaw);
    if (
        !Number.isFinite(defaultFailureCostMajor)
    ) {
        const currencySymbol = getCurrencySymbol(nextCurrency);
        return {
            error: `Default failure cost must be between ${currencySymbol}${failureCostBounds.minMajor} and ${currencySymbol}${failureCostBounds.maxMajor}.`,
        };
    }

    const defaultFailureCostCents = Math.round(defaultFailureCostMajor * 100);
    if (defaultFailureCostCents < failureCostBounds.minCents || defaultFailureCostCents > failureCostBounds.maxCents) {
        const currencySymbol = getCurrencySymbol(nextCurrency);
        return {
            error: `Default failure cost must be between ${currencySymbol}${failureCostBounds.minMajor} and ${currencySymbol}${failureCostBounds.maxMajor}.`,
        };
    }

    const defaultVoucherId = defaultVoucherIdRaw?.trim() ? defaultVoucherIdRaw.trim() : user.id;
    let strictPomoEnabled: boolean | undefined;
    if (strictPomoEnabledRaw != null && strictPomoEnabledRaw !== "") {
        if (typeof strictPomoEnabledRaw !== "string") {
            return { error: "Strict Pomodoro toggle value is invalid." };
        }
        if (strictPomoEnabledRaw !== "true" && strictPomoEnabledRaw !== "false") {
            return { error: "Strict Pomodoro toggle value is invalid." };
        }
        strictPomoEnabled = strictPomoEnabledRaw === "true";
    }
    let deadlineOneHourWarningEnabled: boolean | undefined;
    if (deadlineOneHourWarningEnabledRaw != null && deadlineOneHourWarningEnabledRaw !== "") {
        if (typeof deadlineOneHourWarningEnabledRaw !== "string") {
            return { error: "1-hour deadline warning toggle value is invalid." };
        }
        if (deadlineOneHourWarningEnabledRaw !== "true" && deadlineOneHourWarningEnabledRaw !== "false") {
            return { error: "1-hour deadline warning toggle value is invalid." };
        }
        deadlineOneHourWarningEnabled = deadlineOneHourWarningEnabledRaw === "true";
    }
    let deadlineFinalWarningEnabled: boolean | undefined;
    if (deadlineFinalWarningEnabledRaw != null && deadlineFinalWarningEnabledRaw !== "") {
        if (typeof deadlineFinalWarningEnabledRaw !== "string") {
            return { error: "Final deadline warning toggle value is invalid." };
        }
        if (deadlineFinalWarningEnabledRaw !== "true" && deadlineFinalWarningEnabledRaw !== "false") {
            return { error: "Final deadline warning toggle value is invalid." };
        }
        deadlineFinalWarningEnabled = deadlineFinalWarningEnabledRaw === "true";
    }
    let voucherCanViewActiveTasksEnabled: boolean | undefined;
    if (voucherCanViewActiveTasksEnabledRaw != null && voucherCanViewActiveTasksEnabledRaw !== "") {
        if (typeof voucherCanViewActiveTasksEnabledRaw !== "string") {
            return { error: "Voucher active-task visibility toggle value is invalid." };
        }
        if (voucherCanViewActiveTasksEnabledRaw !== "true" && voucherCanViewActiveTasksEnabledRaw !== "false") {
            return { error: "Voucher active-task visibility toggle value is invalid." };
        }
        voucherCanViewActiveTasksEnabled = voucherCanViewActiveTasksEnabledRaw === "true";
    }
    let mobileNotificationsEnabled: boolean | undefined;
    if (mobileNotificationsEnabledRaw != null && mobileNotificationsEnabledRaw !== "") {
        if (typeof mobileNotificationsEnabledRaw !== "string") {
            return { error: "Mobile notifications toggle value is invalid." };
        }
        if (mobileNotificationsEnabledRaw !== "true" && mobileNotificationsEnabledRaw !== "false") {
            return { error: "Mobile notifications toggle value is invalid." };
        }
        mobileNotificationsEnabled = mobileNotificationsEnabledRaw === "true";
    }
    if (defaultVoucherId !== user.id) {
        const { data: friendship } = await supabase
            .from("friendships")
            .select("id")
            .eq("user_id", user.id)
            .eq("friend_id", defaultVoucherId)
            .maybeSingle();

        if (!friendship) {
            return { error: "Default voucher must be one of your friends." };
        }
    }

    const profileUpdate: Record<string, unknown> = {
        default_pomo_duration_minutes: defaultPomoDurationMinutes ?? DEFAULT_POMO_DURATION_MINUTES,
        default_event_duration_minutes: defaultEventDurationMinutes ?? DEFAULT_EVENT_DURATION_MINUTES,
        default_failure_cost_cents: defaultFailureCostCents ?? DEFAULT_FAILURE_COST_CENTS,
        default_voucher_id: defaultVoucherId,
    };
    if (strictPomoEnabled !== undefined) {
        profileUpdate.strict_pomo_enabled = strictPomoEnabled;
    }
    if (deadlineOneHourWarningEnabled !== undefined) {
        profileUpdate.deadline_one_hour_warning_enabled = deadlineOneHourWarningEnabled;
    }
    if (deadlineFinalWarningEnabled !== undefined) {
        profileUpdate.deadline_final_warning_enabled = deadlineFinalWarningEnabled;
    }
    if (voucherCanViewActiveTasksEnabled !== undefined) {
        profileUpdate.voucher_can_view_active_tasks = voucherCanViewActiveTasksEnabled;
    }
    if (mobileNotificationsEnabled !== undefined) {
        profileUpdate.mobile_notifications_enabled = mobileNotificationsEnabled;
    }
    if (currency !== undefined) {
        profileUpdate.currency = currency;
    }

    // @ts-ignore
    const { error } = await (supabase.from("profiles" as any) as any)
        .update(profileUpdate as any)
        .eq("id", user.id);

    if (error) {
        return { error: error.message };
    }

    // Invalidate voucher pending caches so owner currency updates are reflected quickly.
    const { data: ownerTaskRows } = await (supabase.from("tasks") as any)
        .select("voucher_id")
        .eq("user_id", user.id as any)
        .in("status", ["ACTIVE", "POSTPONED", "MARKED_COMPLETE", "AWAITING_VOUCHER", "AWAITING_AI", "AWAITING_USER", "ESCALATED"] as any);

    const voucherIds = new Set<string>(
        ((ownerTaskRows as Array<{ voucher_id: string | null }> | null) || [])
            .map((row) => row.voucher_id)
            .filter((value): value is string => typeof value === "string" && value.length > 0)
    );
    for (const voucherId of voucherIds) {
        revalidateTag(pendingVoucherRequestsTag(voucherId), "max");
    }

    revalidatePath("/settings");
    revalidatePath("/tasks");
    revalidatePath("/ledger");
    revalidatePath("/friends");
    return { success: true };
}

export async function setDashboardTipsHidden(hidden: boolean) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    // @ts-ignore
    const { error } = await (supabase.from("profiles" as any) as any)
        .update({ hide_tips: hidden } as any)
        .eq("id", user.id as any);

    if (error) {
        return { error: error.message };
    }

    revalidatePath("/tasks");
    revalidatePath("/settings");
    return { success: true };
}

export async function updateUsername(formData: FormData) {
    const supabase = await createClient();
    const username = formData.get("username") as string;

    const parsedUsername = usernameSchema.safeParse(username);
    if (!parsedUsername.success) {
        return { error: parsedUsername.error.issues[0].message };
    }

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    // Check if username is taken
    const { data: existing } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", username)
        .neq("id", user.id)
        .single();

    if (existing) {
        return { error: "Username already taken" };
    }

    // @ts-ignore
    const { error } = await (supabase.from("profiles" as any) as any)
        .update({ username } as any)
        .eq("id", user.id as any);

    if (error) {
        return { error: error.message };
    }

    revalidatePath("/settings");
    return { success: true };
}
