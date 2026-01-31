"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addFriend(formData: FormData) {
    const supabase = await createClient();
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
    const { data: friend } = await supabase
        .from("profiles")
        .select("*")
        .eq("email", email)
        .single();

    if (!friend) {
        return { error: "No user found with that email" };
    }

    if (friend.id === user.id) {
        return { error: "You cannot add yourself as a friend" };
    }

    // Check if already friends
    const { data: existing } = await supabase
        .from("friendships")
        .select("*")
        .eq("user_id", user.id)
        .eq("friend_id", friend.id)
        .single();

    if (existing) {
        return { error: "Already friends with this user" };
    }

    const { error } = await supabase.from("friendships").insert({
        user_id: user.id,
        friend_id: friend.id,
    });

    if (error) {
        return { error: error.message };
    }

    revalidatePath("/dashboard/friends");
    return { success: true };
}

export async function removeFriend(friendId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }

    // Check if friend is active voucher for any pending tasks
    const { data: activeTasks } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .eq("voucher_id", friendId)
        .in("status", [
            "CREATED",
            "ACTIVE",
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

    const { error } = await supabase
        .from("friendships")
        .delete()
        .eq("user_id", user.id)
        .eq("friend_id", friendId);

    if (error) {
        return { error: error.message };
    }

    revalidatePath("/dashboard/friends");
    return { success: true };
}

export async function getFriends() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    const { data: friendships } = await supabase
        .from("friendships")
        .select(
            `
      *,
      friend:profiles!friendships_friend_id_fkey(*)
    `
        )
        .eq("user_id", user.id);

    return friendships?.map((f) => f.friend) || [];
}
