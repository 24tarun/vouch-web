import type { TaskStatus } from "./xstate/task-machine";

// Database types matching Supabase schema
export interface Profile {
    id: string;
    email: string;
    username: string;
    currency: "EUR" | "USD" | "INR";
    default_pomo_duration_minutes: number;
    default_event_duration_minutes: number;
    default_failure_cost_cents: number;
    default_voucher_id: string | null;
    strict_pomo_enabled: boolean;
    deadline_one_hour_warning_enabled: boolean;
    deadline_final_warning_enabled: boolean;
    voucher_can_view_active_tasks: boolean;
    mobile_notifications_enabled?: boolean;
    orca_friend_opt_in?: boolean;
    hide_tips: boolean;
    created_at: string;
}

export interface Friendship {
    id: string;
    user_id: string;
    friend_id: string;
    created_at: string;
}

export interface Task {
    id: string;
    user_id: string;
    voucher_id: string;
    title: string;
    description: string | null;
    failure_cost_cents: number;
    required_pomo_minutes: number | null;
    requires_proof?: boolean;
    commitment_proof_required?: boolean;
    deadline: string;
    status: TaskStatus;
    postponed_at: string | null;
    marked_completed_at: string | null;
    voucher_response_deadline: string | null;
    recurrence_rule_id: string | null;
    iteration_number?: number | null;
    google_sync_for_task: boolean;
    google_event_start_at?: string | null;
    google_event_end_at?: string | null;
    google_event_color_id?: string | null;
    created_at: string;
    updated_at: string;
    has_proof?: boolean;
    proof_request_open?: boolean;
    proof_requested_at?: string | null;
    proof_requested_by?: string | null;
    voucher_timeout_auto_accepted?: boolean;
    pomo_total_seconds?: number;
    subtasks?: TaskSubtask[];
    completion_proof?: TaskCompletionProof | null;
    ai_escalated_from?: boolean;
    resubmit_count?: number;
    ai_vouch_calls_count?: number;
    ai_vouch_denials?: AiVouchDenial[];
}

export interface TaskSubtask {
    id: string;
    parent_task_id: string;
    user_id: string;
    title: string;
    is_completed: boolean;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface TaskReminder {
    id: string;
    parent_task_id: string;
    user_id: string;
    reminder_at: string;
    source: "MANUAL" | "DEFAULT_DEADLINE_1H" | "DEFAULT_DEADLINE_5M";
    notified_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface TaskCompletionProof {
    id: string;
    task_id: string;
    owner_id: string;
    voucher_id: string;
    bucket: string;
    object_path: string;
    media_kind: "image" | "video";
    mime_type: string;
    size_bytes: number;
    duration_ms: number | null;
    overlay_timestamp_text: string;
    upload_state: "PENDING" | "UPLOADED" | "FAILED";
    created_at: string;
    updated_at: string;
}

export interface AiVouchDenial {
    id: string;
    task_id: string;
    attempt_number: number;
    reason: string;
    denied_at: string;
}

export interface TaskEvent {
    id: string;
    task_id: string;
    event_type: string;
    actor_id: string | null;
    from_status: TaskStatus;
    to_status: TaskStatus;
    metadata: Record<string, unknown> | null;
    created_at: string;
}

export interface LedgerEntry {
    id: string;
    user_id: string;
    task_id: string;
    period: string; // YYYY-MM
    amount_cents: number;
    entry_type: "failure" | "rectified" | "force_majeure" | "voucher_timeout_penalty";
    created_at: string;
}

export interface RectifyPass {
    id: string;
    user_id: string;
    task_id: string;
    authorized_by: string | null;
    period: string; // YYYY-MM
    created_at: string;
}

export interface ForceMajeure {
    id: string;
    user_id: string;
    task_id: string;
    period: string; // YYYY-MM
    created_at: string;
}

export interface PomoSession {
    id: string;
    user_id: string;
    task_id: string;
    duration_minutes: number;
    elapsed_seconds: number;
    is_strict: boolean;
    status: "ACTIVE" | "PAUSED" | "COMPLETED" | "DELETED";
    started_at: string;
    paused_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface WebPushSubscription {
    id: string;
    user_id: string;
    subscription: Json;
    created_at: string;
    updated_at: string;
}

export interface VoucherReminderLog {
    id: string;
    voucher_id: string;
    reminder_date: string;
    pending_count: number;
    created_at: string;
}

export interface GoogleCalendarConnection {
    user_id: string;
    sync_app_to_google_enabled: boolean;
    sync_google_to_app_enabled: boolean;
    import_only_tagged_google_events: boolean;
    google_account_email: string | null;
    selected_calendar_id: string | null;
    selected_calendar_summary: string | null;
    encrypted_access_token: string | null;
    encrypted_refresh_token: string | null;
    token_expires_at: string | null;
    watch_channel_id: string | null;
    watch_resource_id: string | null;
    watch_expires_at: string | null;
    sync_token: string | null;
    last_webhook_at: string | null;
    last_sync_at: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
}

export interface GoogleCalendarTaskLink {
    task_id: string;
    user_id: string;
    calendar_id: string;
    google_event_id: string;
    last_google_etag: string | null;
    last_google_updated_at: string | null;
    last_app_updated_at: string | null;
    last_origin: "APP" | "GOOGLE";
    created_at: string;
    updated_at: string;
}

export interface GoogleCalendarSyncOutbox {
    id: number;
    user_id: string;
    task_id: string | null;
    intent: "UPSERT" | "DELETE";
    status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
    attempt_count: number;
    next_attempt_at: string;
    payload: Json | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
}

export type CommitmentStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "FAILED";

export interface Commitment {
    id: string;
    user_id: string;
    name: string;
    description: string;
    status: CommitmentStatus;
    start_date: string; // YYYY-MM-DD
    end_date: string; // YYYY-MM-DD
    created_at: string;
    updated_at: string;
}

export interface CommitmentTaskLink {
    id: string;
    commitment_id: string;
    task_id: string | null;
    recurrence_rule_id: string | null;
    created_at: string;
}

export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | "WEEKDAYS" | "CUSTOM";

export interface RecurrenceRuleConfig {
    frequency: RecurrenceFrequency;
    interval: number;
    days_of_week?: number[]; // 0=Sun, 1=Mon, etc.
    time_of_day: string; // HH:MM
}

export interface RecurrenceRule {
    id: string;
    user_id: string;
    voucher_id: string;
    title: string;
    description: string | null;
    failure_cost_cents: number;
    required_pomo_minutes: number | null;
    requires_proof?: boolean;
    rule_config: RecurrenceRuleConfig;
    timezone: string;
    google_sync_for_rule: boolean;
    google_event_duration_minutes?: number | null;
    google_event_color_id?: string | null;
    manual_reminder_offsets_ms?: number[] | null;
    last_generated_date: string | null; // YYYY-MM-DD
    latest_iteration?: number;
    created_at: string;
    updated_at: string;
}

// Extended types with relations
export interface TaskWithRelations extends Task {
    user?: Profile;
    voucher?: Profile;
    events?: TaskEvent[];
    recurrence_rule?: RecurrenceRule | null;
    subtasks?: TaskSubtask[];
    reminders?: TaskReminder[];
    completion_proof?: TaskCompletionProof | null;
    google_sync_linked?: boolean;
    google_sync_last_origin?: "APP" | "GOOGLE" | null;
}

export type VoucherPendingDisplayType = "ACTIVE" | "AWAITING_VOUCHER";

export interface VoucherPendingTask extends TaskWithRelations {
    pending_display_type: VoucherPendingDisplayType;
    pending_deadline_at: string | null;
    pending_actionable: boolean;
    proof_request_count: number;
}

export interface FriendPomoActivity {
    friend_id: string;
    friend_username: string;
    status: "ACTIVE" | "PAUSED";
}

export interface ProfileWithFriends extends Profile {
    friends?: Profile[];
}

// API response types
export interface ApiResponse<T> {
    data: T | null;
    error: string | null;
}

export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            profiles: {
                Row: Profile
                Insert: Omit<Profile, "id" | "created_at" | "currency" | "default_pomo_duration_minutes" | "default_event_duration_minutes" | "default_failure_cost_cents" | "default_voucher_id" | "strict_pomo_enabled" | "deadline_one_hour_warning_enabled" | "deadline_final_warning_enabled" | "voucher_can_view_active_tasks" | "mobile_notifications_enabled" | "orca_friend_opt_in" | "hide_tips"> & Partial<Pick<Profile, "currency" | "default_pomo_duration_minutes" | "default_event_duration_minutes" | "default_failure_cost_cents" | "default_voucher_id" | "strict_pomo_enabled" | "deadline_one_hour_warning_enabled" | "deadline_final_warning_enabled" | "voucher_can_view_active_tasks" | "mobile_notifications_enabled" | "orca_friend_opt_in" | "hide_tips">>
                Update: Partial<Profile>
            }
            friendships: {
                Row: Friendship
                Insert: Omit<Friendship, "id" | "created_at">
                Update: Partial<Friendship>
            }
            tasks: {
                Row: Task
                Insert: Omit<Task, "id" | "created_at" | "updated_at">
                Update: Partial<Task>
            }
            recurrence_rules: {
                Row: RecurrenceRule
                Insert: Omit<RecurrenceRule, "id" | "created_at" | "updated_at">
                Update: Partial<RecurrenceRule>
            }
            commitments: {
                Row: Commitment
                Insert: Omit<Commitment, "id" | "created_at" | "updated_at" | "status"> & Partial<Pick<Commitment, "status">>
                Update: Partial<Commitment>
            }
            commitment_task_links: {
                Row: CommitmentTaskLink
                Insert: Omit<CommitmentTaskLink, "id" | "created_at">
                Update: Partial<CommitmentTaskLink>
            }
            task_subtasks: {
                Row: TaskSubtask
                Insert: Omit<TaskSubtask, "id" | "created_at" | "updated_at">
                Update: Partial<TaskSubtask>
            }
            task_reminders: {
                Row: TaskReminder
                Insert: Omit<TaskReminder, "id" | "created_at" | "updated_at" | "source"> & Partial<Pick<TaskReminder, "created_at" | "updated_at" | "source">>
                Update: Partial<TaskReminder>
            }
            task_completion_proofs: {
                Row: TaskCompletionProof
                Insert: Omit<TaskCompletionProof, "id" | "created_at" | "updated_at">
                Update: Partial<TaskCompletionProof>
            }
            task_events: {
                Row: TaskEvent
                Insert: Omit<TaskEvent, "id" | "created_at">
                Update: Partial<TaskEvent>
            }
            ledger_entries: {
                Row: LedgerEntry
                Insert: Omit<LedgerEntry, "id" | "created_at">
                Update: Partial<LedgerEntry>
            }
            rectify_passes: {
                Row: RectifyPass
                Insert: Omit<RectifyPass, "id" | "created_at">
                Update: Partial<RectifyPass>
            }
            force_majeure: {
                Row: ForceMajeure
                Insert: Omit<ForceMajeure, "id" | "created_at">
                Update: Partial<ForceMajeure>
            }
            pomo_sessions: {
                Row: PomoSession
                Insert: Omit<PomoSession, "id" | "created_at" | "updated_at">
                Update: Partial<PomoSession>
            }
            web_push_subscriptions: {
                Row: WebPushSubscription
                Insert: Omit<WebPushSubscription, "id" | "created_at" | "updated_at">
                Update: Partial<WebPushSubscription>
            }
            google_calendar_connections: {
                Row: GoogleCalendarConnection
                Insert: Omit<GoogleCalendarConnection, "created_at" | "updated_at">
                Update: Partial<GoogleCalendarConnection>
            }
            google_calendar_task_links: {
                Row: GoogleCalendarTaskLink
                Insert: Omit<GoogleCalendarTaskLink, "created_at" | "updated_at">
                Update: Partial<GoogleCalendarTaskLink>
            }
            google_calendar_sync_outbox: {
                Row: GoogleCalendarSyncOutbox
                Insert: Omit<GoogleCalendarSyncOutbox, "id" | "created_at" | "updated_at">
                Update: Partial<GoogleCalendarSyncOutbox>
            }
            voucher_reminder_logs: {
                Row: VoucherReminderLog
                Insert: Omit<VoucherReminderLog, "id" | "created_at">
                Update: Partial<VoucherReminderLog>
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            [_ in never]: never
        }
        Enums: {
            [_ in never]: never
        }
    }
}
