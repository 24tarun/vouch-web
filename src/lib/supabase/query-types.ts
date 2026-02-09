import type { Database } from "@/lib/types";

type PublicSchema = Database["public"];
type Tables = PublicSchema["Tables"];

export type TableName = keyof Tables;

export type TableRow<T extends TableName> = Tables[T]["Row"];
export type TableInsert<T extends TableName> = Tables[T]["Insert"];
export type TableUpdate<T extends TableName> = Tables[T]["Update"];

export type TaskRow = TableRow<"tasks">;
export type ProfileRow = TableRow<"profiles">;
export type FriendshipRow = TableRow<"friendships">;
export type TaskEventRow = TableRow<"task_events">;
export type TaskSubtaskRow = TableRow<"task_subtasks">;
export type TaskReminderRow = TableRow<"task_reminders">;
export type TaskCompletionProofRow = TableRow<"task_completion_proofs">;
export type LedgerEntryRow = TableRow<"ledger_entries">;
export type RectifyPassRow = TableRow<"rectify_passes">;
export type ForceMajeureRow = TableRow<"force_majeure">;
export type PomoSessionRow = TableRow<"pomo_sessions">;
export type VoucherReminderLogRow = TableRow<"voucher_reminder_logs">;
export type WebPushSubscriptionRow = TableRow<"web_push_subscriptions">;

export type TaskWithUserProfile = TaskRow & {
    user: Pick<ProfileRow, "id" | "email" | "username"> | null;
};

export type TaskWithVoucherProfile = TaskRow & {
    voucher: Pick<ProfileRow, "id" | "email" | "username"> | null;
};

export type FriendshipWithFriend = FriendshipRow & {
    friend: ProfileRow;
};

export type LedgerEntryWithTask = LedgerEntryRow & {
    task: TaskRow | null;
};
