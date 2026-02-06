"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

type PomoAutoEndSource = "sign_in_auto_end" | "sign_out_auto_end";

async function autoEndLingeringPomoSession(
    supabase: SupabaseClient<Database>,
    userId: string,
    source: PomoAutoEndSource
) {
    const { data: session, error: sessionError } = await supabase.from("pomo_sessions")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["ACTIVE", "PAUSED"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

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

    const { data: updatedSession, error: updateError } = await supabase.from("pomo_sessions")
        .update({
            status: "COMPLETED",
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

    if (!session.task_id) return;

    const { data: task } = await supabase.from("tasks")
        .select("status")
        .eq("id", session.task_id)
        .eq("user_id", userId)
        .single();

    if (!task?.status) return;

    const { error: eventError } = await supabase.from("task_events").insert({
        task_id: session.task_id,
        event_type: "POMO_COMPLETED",
        actor_id: userId,
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

    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/tasks/${session.task_id}`);
}

export async function signIn(formData: FormData) {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const supabase = await createClient();

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

    await autoEndLingeringPomoSession(supabase, data.user.id, "sign_in_auto_end");

    revalidatePath("/", "layout");
    redirect("/dashboard");
}

export async function signUp(formData: FormData) {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const supabase = await createClient();

    console.log("Attemping sign up for:", email);

    const { error, data } = await supabase.auth.signUp({
        email,
        password,
        options: {
            emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
            data: {
                username: email.split("@")[0],
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

export async function signOut() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (user) {
        await autoEndLingeringPomoSession(supabase, user.id, "sign_out_auto_end");
    }

    await supabase.auth.signOut();
    revalidatePath("/", "layout");
    redirect("https://tas.tarunh.com");
}

export async function getUser() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    return user;
}

export async function getProfile() {
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

    return profile;
}

export async function updateUsername(formData: FormData) {
    const supabase = await createClient();
    const username = formData.get("username") as string;

    if (!username || username.length < 3) {
        return { error: "Username must be at least 3 characters" };
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

    revalidatePath("/dashboard/settings");
    return { success: true };
}
