import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { cancelRepetition, overrideTask, ownerTempDeleteTask } from "@/actions/tasks";
import { escalateToHumanVoucher } from "@/actions/voucher";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";
import { runOptimisticMutation } from "@/lib/ui/runOptimisticMutation";
import type { TaskWithRelations } from "@/lib/types";

interface FriendOption {
    id: string;
    username: string | null;
    email: string;
}

interface UseTaskDetailActionsArgs {
    taskState: TaskWithRelations;
    viewerId: string;
    canTempDelete: boolean;
    hasUsedOverrideThisMonth: boolean;
    isRepetitionStopped: boolean;
    escalationPending: boolean;
    setEscalationPending: Dispatch<SetStateAction<boolean>>;
    setShowEscalationPicker: Dispatch<SetStateAction<boolean>>;
    setFriends: Dispatch<SetStateAction<FriendOption[]>>;
    friendsLoading: boolean;
    setFriendsLoading: Dispatch<SetStateAction<boolean>>;
    setIsRepetitionStopped: Dispatch<SetStateAction<boolean>>;
    setTaskState: Dispatch<SetStateAction<TaskWithRelations>>;
    setActionPending: (action: string, pending: boolean) => void;
    isActionPending: (action: string) => boolean;
    refreshInBackground: () => void;
    pushToTasks: () => void;
}

export function useTaskDetailActions({
    taskState,
    viewerId,
    canTempDelete,
    hasUsedOverrideThisMonth,
    isRepetitionStopped,
    escalationPending,
    setEscalationPending,
    setShowEscalationPicker,
    setFriends,
    friendsLoading,
    setFriendsLoading,
    setIsRepetitionStopped,
    setTaskState,
    setActionPending,
    isActionPending,
    refreshInBackground,
    pushToTasks,
}: UseTaskDetailActionsArgs) {
    const handleOverride = useCallback(async () => {
        if (isActionPending("override")) return;
        if (hasUsedOverrideThisMonth) {
            toast.error("You have already used your override for this month");
            return;
        }
        if (!confirm("Are you sure? This uses your 1 monthly Override pass and will settle the task without failure cost.")) return;

        setActionPending("override", true);
        const optimisticUpdatedAt = new Date().toISOString();

        await runOptimisticMutation({
            captureSnapshot: () => ({ taskState }),
            applyOptimistic: () => {
                setTaskState((prev) => ({
                    ...prev,
                    status: "SETTLED",
                    updated_at: optimisticUpdatedAt,
                }));
            },
            runMutation: () => overrideTask(taskState.id),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        setActionPending("override", false);
    }, [hasUsedOverrideThisMonth, isActionPending, refreshInBackground, setActionPending, setTaskState, taskState]);

    const handleCancelRepetition = useCallback(async () => {
        if (isRepetitionStopped || isActionPending("cancelRepetition")) return;
        if (!confirm("Are you sure you want to stop future repetitions? This task will remain, but no more will be created.")) return;

        setActionPending("cancelRepetition", true);

        await runOptimisticMutation({
            captureSnapshot: () => ({ taskState, isRepetitionStopped }),
            applyOptimistic: () => {
                setIsRepetitionStopped(true);
                setTaskState((prev) => ({
                    ...prev,
                    recurrence_rule_id: null,
                    recurrence_rule: null,
                }));
            },
            runMutation: () => cancelRepetition(taskState.id),
            rollback: (snapshot) => {
                setTaskState(snapshot.taskState);
                setIsRepetitionStopped(snapshot.isRepetitionStopped);
            },
            onSuccess: () => {
                refreshInBackground();
            },
        });

        setActionPending("cancelRepetition", false);
    }, [isActionPending, isRepetitionStopped, refreshInBackground, setActionPending, setIsRepetitionStopped, setTaskState, taskState]);

    const handleTempDelete = useCallback(async () => {
        if (isActionPending("tempDelete") || !canTempDelete) return;
        setActionPending("tempDelete", true);

        const result = await ownerTempDeleteTask(taskState.id);
        if (result?.error) {
            toast.error(result.error);
            setActionPending("tempDelete", false);
            return;
        }

        refreshInBackground();
        pushToTasks();
        setActionPending("tempDelete", false);
    }, [canTempDelete, isActionPending, pushToTasks, refreshInBackground, setActionPending, taskState.id]);

    const loadFriendsForEscalation = useCallback(async () => {
        if (friendsLoading) return;
        setFriendsLoading(true);
        try {
            const supabase = createBrowserSupabaseClient();
            const { data, error } = await supabase
                .from("friendships")
                .select("friend_id, friend:profiles!friendships_friend_id_fkey(id, username, email)")
                .eq("user_id", viewerId);

            if (!error && data) {
                const friendsList = data
                    .map((f) => f.friend as FriendOption | null)
                    .filter((f): f is FriendOption => Boolean(f && f.id));
                setFriends(friendsList);
            }
        } catch (error) {
            console.error("Failed to load friends:", error);
        } finally {
            setFriendsLoading(false);
        }
    }, [friendsLoading, setFriends, setFriendsLoading, viewerId]);

    const handleEscalateToFriend = useCallback(async (friendId: string) => {
        if (escalationPending) return;
        setEscalationPending(true);

        const result = await escalateToHumanVoucher(taskState.id, friendId);

        if (result?.error) {
            toast.error(result.error);
        } else if (result?.success) {
            toast.success("Task escalated to friend for review");
            setShowEscalationPicker(false);
            refreshInBackground();
        }

        setEscalationPending(false);
    }, [escalationPending, refreshInBackground, setEscalationPending, setShowEscalationPicker, taskState.id]);

    return {
        handleOverride,
        handleCancelRepetition,
        handleTempDelete,
        loadFriendsForEscalation,
        handleEscalateToFriend,
    };
}
