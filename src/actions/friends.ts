"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeFullReputationScore } from "@/lib/reputation/algorithm";
import type { ReputationTaskInput } from "@/lib/reputation/types";
import { type Database, type FriendPomoActivity, type FriendProfile } from "@/lib/types";
import { ORCA_PROFILE_ID } from "@/lib/ai-voucher/constants";
import { type SupabaseClient } from "@supabase/supabase-js";

const PENDING_VOUCHER_STATUSES = [
    "ACTIVE",
    "POSTPONED",
    "MARKED_COMPLETE",
    "AWAITING_VOUCHER",
    "AWAITING_ORCA",
    "AWAITING_USER",
    "ESCALATED",
];

const REPUTATION_TASK_SELECT =
    "id, user_id, voucher_id, status, deadline, created_at, updated_at, marked_completed_at, postponed_at, recurrence_rule_id, voucher_timeout_auto_accepted, ai_escalated_from, has_proof";

type ReputationTaskRow = {
    id: string;
    user_id: string;
    voucher_id: string | null;
    status: string;
    deadline: string | null;
    created_at: string;
    updated_at: string;
    marked_completed_at: string | null;
    postponed_at: string | null;
    recurrence_rule_id: string | null;
    voucher_timeout_auto_accepted: boolean | null;
    ai_escalated_from: boolean | null;
    has_proof: boolean | null;
};

type PomoElapsedRow = {
    user_id: string;
    task_id: string;
    elapsed_seconds: number;
};

type RelationshipUserSummary = {
    id: string;
    username: string;
    email: string;
    initial: string;
    rp_score: number;
};

export type IncomingFriendRequest = {
    id: string;
    sender_id: string;
    created_at: string;
    sender: RelationshipUserSummary;
};

export type OutgoingFriendRequest = {
    id: string;
    receiver_id: string;
    created_at: string;
    receiver: RelationshipUserSummary;
};

export type SearchCandidate = {
    id: string;
    email: string;
    username: string;
    already_friends: boolean;
    incoming_request_pending: boolean;
    outgoing_request_pending: boolean;
};

export type BlockedUserOption = {
    id: string;
    username: string;
    email: string;
};

type RelationshipDataResult = {
    friends: RelationshipUserSummary[];
    incomingRequests: IncomingFriendRequest[];
    outgoingRequests: OutgoingFriendRequest[];
    error?: string;
};

function buildRelationshipUserSummary(
    profile: { id?: string; username?: string | null; email?: string | null } | null,
    scores: Map<string, number>
): RelationshipUserSummary | null {
    if (!profile?.id) return null;
    const username = profile.username?.trim() || "Friend";
    return {
        id: profile.id,
        username,
        email: profile.email?.trim().toLowerCase() || "",
        initial: username[0]?.toUpperCase() || "?",
        rp_score: profile.id === ORCA_PROFILE_ID ? 1000 : scores.get(profile.id) ?? 400,
    };
}

function revalidateFriendPaths() {
    try {
        revalidatePath("/friends");
        revalidatePath("/settings");
        revalidatePath("/tasks");
    } catch {
        // Ignore revalidation errors
    }
}

function mapReputationTask(
    task: ReputationTaskRow,
    pomoByTaskId: Map<string, number>
): ReputationTaskInput {
    return {
        id: task.id,
        user_id: task.user_id,
        voucher_id: task.voucher_id ?? null,
        status: task.status,
        deadline: task.deadline ?? null,
        created_at: task.created_at,
        updated_at: task.updated_at,
        marked_completed_at: task.marked_completed_at ?? null,
        postponed_at: task.postponed_at ?? null,
        recurrence_rule_id: task.recurrence_rule_id ?? null,
        voucher_timeout_auto_accepted: task.voucher_timeout_auto_accepted ?? null,
        ai_escalated_from: task.ai_escalated_from ?? false,
        has_uploaded_proof: task.has_proof ?? false,
        pomo_total_seconds: pomoByTaskId.get(task.id) ?? 0,
    };
}

async function getFriendReputationScores(friendIds: string[]): Promise<Map<string, number>> {
    const scores = new Map<string, number>();
    const scoringIds = friendIds.filter((friendId) => friendId !== ORCA_PROFILE_ID);
    if (scoringIds.length === 0) return scores;

    try {
        const supabaseAdmin = createAdminClient();

        // Use admin reads for consistent score computation while still limiting scope to explicit friend IDs.
        const [ownedResult, vouchedResult, pomoResult] = await Promise.all([
            (supabaseAdmin.from("tasks" as any) as any)
                .select(REPUTATION_TASK_SELECT)
                .in("user_id", scoringIds as any)
                .neq("status", "DELETED"),
            (supabaseAdmin.from("tasks" as any) as any)
                .select(REPUTATION_TASK_SELECT)
                .in("voucher_id", scoringIds as any)
                .neq("status", "DELETED"),
            (supabaseAdmin.from("pomo_sessions" as any) as any)
                .select("user_id, task_id, elapsed_seconds")
                .in("user_id", scoringIds as any)
                .neq("status", "DELETED"),
        ]);

        if (ownedResult.error || vouchedResult.error || pomoResult.error) {
            console.error("Failed to load friend reputation data:", ownedResult.error || vouchedResult.error || pomoResult.error);
            return scores;
        }

        const ownedRows = (ownedResult.data as ReputationTaskRow[] | null) ?? [];
        const vouchedRows = (vouchedResult.data as ReputationTaskRow[] | null) ?? [];
        const pomoRows = (pomoResult.data as PomoElapsedRow[] | null) ?? [];

        const ownedByUser = new Map<string, ReputationTaskRow[]>();
        for (const row of ownedRows) {
            const current = ownedByUser.get(row.user_id) ?? [];
            current.push(row);
            ownedByUser.set(row.user_id, current);
        }

        const vouchedByUser = new Map<string, ReputationTaskRow[]>();
        for (const row of vouchedRows) {
            if (!row.voucher_id) continue;
            const current = vouchedByUser.get(row.voucher_id) ?? [];
            current.push(row);
            vouchedByUser.set(row.voucher_id, current);
        }

        const pomoByUserTask = new Map<string, Map<string, number>>();
        for (const row of pomoRows) {
            if (!row.user_id || !row.task_id) continue;
            const taskMap = pomoByUserTask.get(row.user_id) ?? new Map<string, number>();
            taskMap.set(row.task_id, (taskMap.get(row.task_id) ?? 0) + (row.elapsed_seconds ?? 0));
            pomoByUserTask.set(row.user_id, taskMap);
        }

        for (const friendId of scoringIds) {
            const userPomoByTask = pomoByUserTask.get(friendId) ?? new Map<string, number>();
            const ownedTasks = ownedByUser.get(friendId) ?? [];
            const vouchedTasks = (vouchedByUser.get(friendId) ?? []).filter((task) => task.user_id !== friendId);
            const tasks = [...ownedTasks, ...vouchedTasks].map((task) => mapReputationTask(task, userPomoByTask));
            scores.set(friendId, computeFullReputationScore(tasks, friendId).score);
        }
    } catch (error) {
        console.error("Unexpected friend reputation score computation error:", error);
    }

    return scores;
}

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

    const friendProfile = (friend as { id: string } | null);

    if (!friendProfile) {
        return { error: "No user found with that email" };
    }

    // @ts-ignore
    if (friendProfile.id === user.id) {
        return { error: "You cannot add yourself as a friend" };
    }
    if (friendProfile.id === ORCA_PROFILE_ID) {
        return { error: "Use AI Features in Settings to add Orca as a friend." };
    }

    // Check if already friends (either direction)
    // @ts-ignore
    const { data: existing } = await supabase
        .from("friendships" as any)
        .select("*")
        .eq("user_id", (user as any).id)
        .eq("friend_id", friendProfile.id as any)
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
        friend_id: friendProfile.id,
    });

    if (error1 && error1.code !== '23505') {
        console.error("Failed to create friendship (user->friend):", error1);
        return { error: "Failed to add friend" };
    }

    // 2. Friend -> User (reciprocal)
    // @ts-ignore
    const { error: error2 } = await supabaseAdmin.from("friendships" as any).insert({
        user_id: friendProfile.id,
        friend_id: (user as any).id,
    });

    if (error2 && error2.code !== '23505') {
        console.error("Failed to create reciprocal friendship (friend->user):", error2);
        // Don't fail - the first link was created
    }

    revalidateFriendPaths();
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
    if (friendId === ORCA_PROFILE_ID) {
        return { error: "Use AI Features in Settings to remove Orca as a friend." };
    }

    // Check if friend is active voucher for any pending tasks
    // @ts-ignore
    const { data: activeTasks } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .eq("voucher_id", friendId)
        .in("status", PENDING_VOUCHER_STATUSES as any);

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

    // If the removed friend was the default voucher, fall back to self.
    // @ts-ignore
    const { error: clearDefaultError } = await (supabase.from("profiles" as any) as any)
        .update({ default_voucher_id: user.id } as any)
        .eq("id", user.id as any)
        .eq("default_voucher_id", friendId as any);

    if (clearDefaultError) {
        console.error("Failed to clear default voucher after removing friend:", clearDefaultError);
    }

    revalidateFriendPaths();
    return { success: true };
}

export async function getFriends(): Promise<FriendProfile[]> {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    const [friendshipsRes, blocksRes] = await Promise.all([
        // @ts-ignore
        supabase
            .from("friendships")
            .select(
                `
          *,
          friend:profiles!friendships_friend_id_fkey(*)
        `
            )
            .eq("user_id", user.id),
        // @ts-ignore
        supabase
            .from("user_blocks")
            .select("blocked_id")
            .eq("blocker_id", user.id),
    ]);

    if (friendshipsRes.error || blocksRes.error) {
        console.error("Failed to load friends:", friendshipsRes.error || blocksRes.error);
        return [];
    }

    const blockedIds = new Set(
        ((blocksRes.data ?? []) as Array<{ blocked_id?: string | null }>)
            .map((row) => row.blocked_id)
            .filter((id): id is string => Boolean(id))
    );

    const friends = (((friendshipsRes.data as any)?.map((f: any) => f.friend) || []) as FriendProfile[])
        .filter((friend): friend is FriendProfile => Boolean(friend?.id))
        .filter((friend) => !blockedIds.has(friend.id));
    if (friends.length === 0) return [];

    const friendIds = friends.map((friend) => friend.id);

    const friendScores = await getFriendReputationScores(friendIds);

    return friends.map((friend) => ({
        ...friend,
        rp_score: friend.id === ORCA_PROFILE_ID ? 1000 : friendScores.get(friend.id) ?? 400,
    }));
}

export async function getRelationshipData(): Promise<RelationshipDataResult> {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return {
            friends: [],
            incomingRequests: [],
            outgoingRequests: [],
            error: "Not authenticated",
        };
    }

    const [friendshipsRes, incomingRes, outgoingRes, blockedRes] = await Promise.all([
        // @ts-ignore
        supabase
            .from("friendships")
            .select(
                `
          friend:profiles!friendships_friend_id_fkey(
            id,
            username,
            email
          )
        `
            )
            .eq("user_id", user.id),
        // @ts-ignore
        supabase
            .from("friend_requests")
            .select(
                `
          id,
          sender_id,
          created_at,
          sender:profiles!friend_requests_sender_id_fkey(
            id,
            username,
            email
          )
        `
            )
            .eq("receiver_id", user.id)
            .eq("status", "PENDING")
            .order("created_at", { ascending: false }),
        // @ts-ignore
        supabase
            .from("friend_requests")
            .select(
                `
          id,
          receiver_id,
          created_at,
          receiver:profiles!friend_requests_receiver_id_fkey(
            id,
            username,
            email
          )
        `
            )
            .eq("sender_id", user.id)
            .eq("status", "PENDING")
            .order("created_at", { ascending: false }),
        // @ts-ignore
        supabase
            .from("user_blocks")
            .select("blocked_id")
            .eq("blocker_id", user.id),
    ]);

    if (friendshipsRes.error || incomingRes.error || outgoingRes.error || blockedRes.error) {
        return {
            friends: [],
            incomingRequests: [],
            outgoingRequests: [],
            error:
                friendshipsRes.error?.message ||
                incomingRes.error?.message ||
                outgoingRes.error?.message ||
                blockedRes.error?.message ||
                "Failed to load friend relationships",
        };
    }

    const blockedIds = new Set(
        ((blockedRes.data ?? []) as Array<{ blocked_id?: string | null }>)
            .map((row) => row.blocked_id)
            .filter((id): id is string => Boolean(id))
    );

    const friendProfiles = ((friendshipsRes.data ?? []) as any[])
        .map((row) => row?.friend as { id?: string; username?: string | null; email?: string | null } | null)
        .filter((profile): profile is { id: string; username?: string | null; email?: string | null } => Boolean(profile?.id))
        .filter((profile) => !blockedIds.has(profile.id));

    const friendScores = await getFriendReputationScores(friendProfiles.map((entry) => entry.id));

    const friends = friendProfiles
        .map((profile) => buildRelationshipUserSummary(profile, friendScores))
        .filter((entry): entry is RelationshipUserSummary => Boolean(entry))
        .sort((a, b) => a.username.localeCompare(b.username));

    const incomingRequests = ((incomingRes.data ?? []) as any[])
        .map((row) => {
            const sender = buildRelationshipUserSummary(
                row?.sender as { id?: string; username?: string | null; email?: string | null } | null,
                friendScores
            );
            if (!sender || !row?.id || !row?.sender_id) return null;
            return {
                id: row.id as string,
                sender_id: row.sender_id as string,
                created_at: row.created_at as string,
                sender,
            } satisfies IncomingFriendRequest;
        })
        .filter((entry): entry is IncomingFriendRequest => Boolean(entry));

    const outgoingRequests = ((outgoingRes.data ?? []) as any[])
        .map((row) => {
            const receiver = buildRelationshipUserSummary(
                row?.receiver as { id?: string; username?: string | null; email?: string | null } | null,
                friendScores
            );
            if (!receiver || !row?.id || !row?.receiver_id) return null;
            return {
                id: row.id as string,
                receiver_id: row.receiver_id as string,
                created_at: row.created_at as string,
                receiver,
            } satisfies OutgoingFriendRequest;
        })
        .filter((entry): entry is OutgoingFriendRequest => Boolean(entry));

    return { friends, incomingRequests, outgoingRequests };
}

export async function searchUsersForFriendship(query: string): Promise<{ candidates: SearchCandidate[]; error?: string }> {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { candidates: [], error: "Not authenticated" };

    const normalizedQuery = query.trim();
    if (!normalizedQuery) return { candidates: [] };

    const { data, error } = await (supabase.rpc("search_users_for_friendship" as any, {
        p_query: normalizedQuery,
        p_limit: 20,
    } as any) as any);

    if (error) {
        return { candidates: [], error: error.message ?? "Failed to search users" };
    }

    const candidates = ((data ?? []) as SearchCandidate[])
        .filter((entry) => !entry.already_friends)
        .sort((a, b) => a.username.localeCompare(b.username));

    return { candidates };
}

export async function sendFriendRequestToUser(targetUserId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };

    const { error } = await (supabase.rpc("send_friend_request" as any, {
        p_target_user_id: targetUserId,
    } as any) as any);

    if (error) return { error: error.message ?? "Could not send request" };

    revalidateFriendPaths();
    return { success: true };
}

export async function acceptIncomingFriendRequest(requestId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };

    const { error } = await (supabase.rpc("accept_friend_request" as any, {
        p_request_id: requestId,
    } as any) as any);

    if (error) return { error: error.message ?? "Could not accept friend request" };

    revalidateFriendPaths();
    return { success: true };
}

export async function rejectIncomingFriendRequest(requestId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };

    const { error } = await (supabase.rpc("reject_friend_request" as any, {
        p_request_id: requestId,
    } as any) as any);

    if (error) return { error: error.message ?? "Could not reject friend request" };

    revalidateFriendPaths();
    return { success: true };
}

export async function withdrawOutgoingFriendRequest(requestId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };

    const supabaseAdmin = createAdminClient();

    const { data: requestRow, error: requestError } = await (supabaseAdmin.from("friend_requests" as any) as any)
        .select("id, sender_id, status")
        .eq("id", requestId as any)
        .maybeSingle();

    if (requestError) {
        return { error: requestError.message ?? "Could not load friend request" };
    }

    if (!requestRow || requestRow.sender_id !== user.id) {
        return { error: "You can only withdraw your own outgoing request." };
    }

    if (requestRow.status !== "PENDING") {
        return { error: "This friend request is no longer pending." };
    }

    const { error } = await (supabaseAdmin.from("friend_requests" as any) as any)
        .delete()
        .eq("id", requestId as any)
        .eq("sender_id", user.id as any)
        .eq("status", "PENDING" as any);

    if (error) return { error: error.message ?? "Could not withdraw friend request" };

    revalidateFriendPaths();
    return { success: true };
}

export async function removeFriendById(targetUserId: string) {
    const result = await removeFriend(targetUserId);
    if (result.error) return { error: result.error };
    return { success: true };
}

export async function blockRelationshipUser(targetUserId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };

    const { error } = await (supabase.rpc("block_user" as any, {
        p_target_user_id: targetUserId,
    } as any) as any);

    if (error) return { error: error.message ?? "Could not block user" };

    revalidateFriendPaths();
    return { success: true };
}

export async function getBlockedUsers(): Promise<{ users: BlockedUserOption[]; error?: string }> {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { users: [], error: "Not authenticated" };

    const { data, error } = await (supabase
        .from("user_blocks" as any)
        .select(
            `
      blocked_id,
      blocked:profiles!user_blocks_blocked_id_fkey(
        id,
        username,
        email
      )
    `
        )
        .eq("blocker_id", user.id as any)
        .order("created_at", { ascending: false }) as any);

    if (error) return { users: [], error: error.message ?? "Failed to load blocked users" };

    const users = ((data ?? []) as any[])
        .map((row) => {
            const blocked = row?.blocked as { id?: string; username?: string | null; email?: string | null } | null;
            if (!blocked?.id) return null;
            return {
                id: blocked.id,
                username: blocked.username?.trim() || "Blocked user",
                email: blocked.email?.trim().toLowerCase() || "",
            } satisfies BlockedUserOption;
        })
        .filter((entry): entry is BlockedUserOption => Boolean(entry))
        .sort((a, b) => a.username.localeCompare(b.username));

    return { users };
}

export async function unblockRelationshipUser(targetUserId: string) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { error: "Not authenticated" };

    const { error } = await (supabase.rpc("unblock_user" as any, {
        p_target_user_id: targetUserId,
    } as any) as any);

    if (error) return { error: error.message ?? "Could not unblock user" };

    revalidateFriendPaths();
    return { success: true };
}

export async function setOrcaAsFriendEnabled(enabled: boolean) {
    const supabase: SupabaseClient<Database> = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Not authenticated" };
    }
    if (typeof enabled !== "boolean") {
        return { error: "Invalid Orca toggle value." };
    }

    const { data: orcaProfile } = await (supabase.from("profiles" as any) as any)
        .select("id")
        .eq("id", ORCA_PROFILE_ID as any)
        .maybeSingle();

    if (!orcaProfile) {
        return { error: "Orca profile is not available. Run the latest database migrations." };
    }

    if (!enabled) {
        // Prevent disabling while Orca is actively assigned as voucher for pending owner tasks.
        // @ts-ignore
        const { data: activeTasks } = await supabase
            .from("tasks")
            .select("id")
            .eq("user_id", user.id)
            .eq("voucher_id", ORCA_PROFILE_ID)
            .in("status", PENDING_VOUCHER_STATUSES as any);

        if (activeTasks && activeTasks.length > 0) {
            return { error: "Cannot remove Orca while she is voucher on your pending tasks." };
        }
    }

    const supabaseAdmin = createAdminClient();

    if (enabled) {
        // @ts-ignore
        const { error: ownerToOrcaError } = await (supabaseAdmin.from("friendships" as any) as any).insert({
            user_id: user.id,
            friend_id: ORCA_PROFILE_ID,
        });

        if (ownerToOrcaError && ownerToOrcaError.code !== "23505") {
            console.error("Failed to create friendship (user->orca):", ownerToOrcaError);
            return { error: "Could not add Orca as a friend." };
        }

        // @ts-ignore
        const { error: orcaToOwnerError } = await (supabaseAdmin.from("friendships" as any) as any).insert({
            user_id: ORCA_PROFILE_ID,
            friend_id: user.id,
        });

        if (orcaToOwnerError && orcaToOwnerError.code !== "23505") {
            console.error("Failed to create reciprocal friendship (orca->user):", orcaToOwnerError);
        }
    } else {
        // @ts-ignore
        const { error: ownerToOrcaDeleteError } = await (supabaseAdmin.from("friendships" as any) as any)
            .delete()
            .eq("user_id", user.id as any)
            .eq("friend_id", ORCA_PROFILE_ID as any);

        if (ownerToOrcaDeleteError) {
            console.error("Failed to delete friendship (user->orca):", ownerToOrcaDeleteError);
            return { error: "Could not remove Orca as a friend." };
        }

        // @ts-ignore
        const { error: orcaToOwnerDeleteError } = await (supabaseAdmin.from("friendships" as any) as any)
            .delete()
            .eq("user_id", ORCA_PROFILE_ID as any)
            .eq("friend_id", user.id as any);

        if (orcaToOwnerDeleteError) {
            console.error("Failed to delete reciprocal friendship (orca->user):", orcaToOwnerDeleteError);
        }

        // @ts-ignore
        const { error: clearDefaultError } = await (supabase.from("profiles" as any) as any)
            .update({ default_voucher_id: user.id } as any)
            .eq("id", user.id as any)
            .eq("default_voucher_id", ORCA_PROFILE_ID as any);

        if (clearDefaultError) {
            console.error("Failed to clear default voucher after removing Orca:", clearDefaultError);
        }
    }

    const { data: friendship, error: friendshipError } = await (supabase.from("friendships" as any) as any)
        .select("id")
        .eq("user_id", user.id as any)
        .eq("friend_id", ORCA_PROFILE_ID as any)
        .maybeSingle();

    if (friendshipError) {
        console.error("Failed to load Orca friendship state:", friendshipError);
        return { error: "Could not verify Orca friendship state." };
    }

    const resolvedEnabled = Boolean(friendship);
    // @ts-ignore
    const { error: profileUpdateError } = await (supabase.from("profiles" as any) as any)
        .update({ orca_friend_opt_in: resolvedEnabled } as any)
        .eq("id", user.id as any);

    if (profileUpdateError) {
        console.error("Failed to persist Orca opt-in preference:", profileUpdateError);
        return { error: "Could not save Orca preference." };
    }

    revalidateFriendPaths();
    return { success: true, enabled: resolvedEnabled };
}

function getPomoStatusPriority(status: "ACTIVE" | "PAUSED") {
    return status === "ACTIVE" ? 2 : 1;
}

export async function getWorkingFriendActivities(): Promise<FriendPomoActivity[]> {
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
      friend_id,
      friend:profiles!friendships_friend_id_fkey(id, username)
    `
        )
        .eq("user_id", user.id);

    const rows = (friendships as Array<{ friend_id: string; friend: { id: string; username: string | null } | null }> | null) || [];
    if (rows.length === 0) return [];

    const friendMetaById = new Map<string, string>();
    for (const row of rows) {
        if (!row?.friend_id) continue;
        const fallbackName = "Friend";
        friendMetaById.set(row.friend_id, row.friend?.username || fallbackName);
    }

    const friendIds = [...friendMetaById.keys()];
    if (friendIds.length === 0) return [];

    // Rely on RLS: friends can only read ACTIVE/PAUSED sessions for linked friends.
    // @ts-ignore
    const { data: sessions, error: sessionsError } = await (supabase.from("pomo_sessions") as any)
        .select("user_id, status, updated_at")
        .in("user_id", friendIds as any)
        .in("status", ["ACTIVE", "PAUSED"] as any)
        .order("updated_at", { ascending: false });

    if (sessionsError) {
        console.error("Failed to load working friend activities:", sessionsError);
        return [];
    }

    const bestSessionByFriend = new Map<string, { status: "ACTIVE" | "PAUSED"; updated_at: string }>();

    for (const session of ((sessions as Array<{ user_id: string; status: "ACTIVE" | "PAUSED"; updated_at: string }> | null) || [])) {
        if (!session?.user_id || !friendMetaById.has(session.user_id)) continue;
        if (session.status !== "ACTIVE" && session.status !== "PAUSED") continue;

        const current = bestSessionByFriend.get(session.user_id);
        if (!current) {
            bestSessionByFriend.set(session.user_id, {
                status: session.status,
                updated_at: session.updated_at,
            });
            continue;
        }

        const currentPriority = getPomoStatusPriority(current.status);
        const incomingPriority = getPomoStatusPriority(session.status);
        const currentUpdatedTs = new Date(current.updated_at).getTime() || 0;
        const incomingUpdatedTs = new Date(session.updated_at).getTime() || 0;

        if (
            incomingPriority > currentPriority ||
            (incomingPriority === currentPriority && incomingUpdatedTs > currentUpdatedTs)
        ) {
            bestSessionByFriend.set(session.user_id, {
                status: session.status,
                updated_at: session.updated_at,
            });
        }
    }

    return [...bestSessionByFriend.entries()]
        .map(([friendId, session]) => ({
            friend_id: friendId,
            friend_username: friendMetaById.get(friendId) || "Friend",
            status: session.status,
        }))
        .sort((a, b) => {
            const priorityDiff = getPomoStatusPriority(b.status) - getPomoStatusPriority(a.status);
            if (priorityDiff !== 0) return priorityDiff;
            return a.friend_username.localeCompare(b.friend_username);
        });
}
