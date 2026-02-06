"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type Database } from "@/lib/types";
import { type SupabaseClient } from "@supabase/supabase-js";

export async function addFriend(formData: FormData) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    const email = formData.get("email") as string;

    if (!email) {
        return { error: "Email is required" };
    }

    // Find user by email
    // @ts-ignore
    const { data: friend } = await supabase
        .from("profiles" as any)
        .select("*")
        .eq("email", email)
        .single();

    if (!friend) {
        return { error: "No user found with that email" };
    }

    // @ts-ignore
    if (friend.id === user.id) {
        return { error: "You cannot add yourself as a friend" };
    }

    // Check if already friends (either direction)
    // @ts-ignore
    const { data: existing } = await supabase
        .from("friendships" as any)
        .select("*")
        .eq("user_id", (user as any).id)
        .eq("friend_id", (friend as any).id)
        .single();

    if (existing) {
        return { error: "Already friends with this user" };
    }

    // Use admin client for both inserts to ensure symmetric creation
    const supabaseAdmin = createAdminClient();

    // 1. User -> Friend
    // @ts-ignore
    const { error: error1 } = await supabaseAdmin.from("friendships" as any).insert({
        user_id: (user as any).id,
        friend_id: (friend as any).id,
    });

    if (error1 && error1.code !== '23505') {
        console.error("Failed to create friendship (user->friend):", error1);
        return { error: "Failed to add friend" };
    }

    // 2. Friend -> User (reciprocal)
    // @ts-ignore
    const { error: error2 } = await supabaseAdmin.from("friendships" as any).insert({
        user_id: (friend as any).id,
        friend_id: (user as any).id,
    });

    if (error2 && error2.code !== '23505') {
        console.error("Failed to create reciprocal friendship (friend->user):", error2);
        // Don't fail - the first link was created
    }

    try {
        revalidatePath("/dashboard/friends");
    } catch (e) {
        // Ignore revalidation errors
    }
    return { success: true };
}

export async function removeFriend(friendId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    // Check if friend is active voucher for any pending tasks
    // @ts-ignore
    const { data: activeTasks } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .eq("voucher_id", friendId)
        .in("status", [
            "CREATED",
            "POSTPONED",
            "MARKED_COMPLETED",
            "AWAITING_VOUCHER",
        ]);

    if (activeTasks && activeTasks.length > 0) {
        return {
            error:
                "Cannot remove friend who is an active voucher for pending tasks",
        };
    }

    // Use admin client for both deletions to ensure symmetric removal
    const supabaseAdmin = createAdminClient();

    // Delete User -> Friend
    // @ts-ignore
    const { error: error1 } = await supabaseAdmin
        .from("friendships")
        .delete()
        .eq("user_id", user.id)
        .eq("friend_id", friendId);

    if (error1) {
        console.error("Failed to delete friendship (user->friend):", error1);
        return { error: "Failed to remove friend" };
    }

    // Delete Friend -> User (reciprocal)
    // @ts-ignore
    const { error: error2 } = await supabaseAdmin
        .from("friendships")
        .delete()
        .eq("user_id", friendId)
        .eq("friend_id", user.id);

    if (error2) {
        console.error("Failed to delete reciprocal friendship:", error2);
        // Don't fail - the first deletion was successful
    }

    // Clear stale default voucher if it was set to the removed friend.
    // @ts-ignore
    const { error: clearDefaultError } = await (supabase.from("profiles" as any) as any)
        .update({ default_voucher_id: null } as any)
        .eq("id", user.id as any)
        .eq("default_voucher_id", friendId as any);

    if (clearDefaultError) {
        console.error("Failed to clear default voucher after removing friend:", clearDefaultError);
    }

    try {
        revalidatePath("/dashboard/friends");
        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard");
        revalidatePath("/dashboard/tasks/new");
    } catch (e) {
        // Ignore revalidation errors
    }
    return { success: true };
}

export async function getFriends() {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    // @ts-ignore
    const { data: friendships } = await supabase
        .from("friendships")
        .select(
            `
      *,
      friend:profiles!friendships_friend_id_fkey(*)
    `
        )
        .eq("user_id", user.id);

    return (friendships as any)?.map((f: any) => f.friend) || [];
}
