import type { TaskStatus } from "./xstate/task-machine";

// Database types matching Supabase schema
export interface Profile {
    id: string;
    email: string;
    username: string;
    currency: "EUR" | "USD" | "INR";
    default_pomo_duration_minutes: number;
    default_event_duration_minutes: number;
    default_task_deadline_time: string;
    default_failure_cost_cents: number;
    default_voucher_id: string | null;
    default_requires_proof_for_all_tasks: boolean;
    auto_submit_after_proof_upload: boolean;
    strict_pomo_enabled: boolean;
    deadline_one_hour_warning_enabled: boolean;
    deadline_final_warning_enabled: boolean;
    deadline_due_warning_enabled: boolean;
    voucher_can_view_active_tasks: boolean;
    always_show_active_tasks: boolean;
    web_notifications_enabled?: boolean;
    ai_friend_opt_in?: boolean;
    charity_enabled: boolean;
    selected_charity_id: string | null;
    timezone: string;
    timezone_user_set: boolean;
    hide_tips: boolean;
    created_at: string;
}

export interface Charity {
    id: string;
    key: string;
    name: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface FriendProfile extends Profile {
    rp_score?: number;
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
    creation_input?: string | null;
    description: string | null;
    failure_cost_cents: number;
    required_pomo_minutes: number | null;
    requires_proof?: boolean;
    commitment_proof_required?: boolean;
    deadline: string;
    original_deadline?: string | null;
    status: TaskStatus;
    postponed_at: string | null;
    marked_completed_at: string | null;
    voucher_response_deadline: string | null;
    recurrence_rule_id: string | null;
    iteration_number?: number | null;
    start_at?: string | null;
    is_strict?: boolean;
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
    ai_vouches?: AiVouch[];
    recurrence_rule?: RecurrenceRule | null;
    rectification_request?: RectificationRequest | null;
}

export type RectificationRequestState =
    | "PENDING_HUMAN"
    | "PENDING_AI"
    | "AWAITING_AI_APPEAL"
    | "APPROVED"
    | "AUTO_APPROVED"
    | "DECLINED"
    | "CANCELLED";

export interface RectificationRequest {
    id: string;
    task_id: string;
    owner_id: string;
    original_voucher_id: string;
    target_voucher_id: string;
    target_type: "ORIGINAL_VOUCHER" | "AI";
    original_status: "DENIED" | "MISSED" | "SURRENDERED";
    failure_period: string;
    request_period: string;
    owner_timezone: string;
    reason: string | null;
    state: RectificationRequestState;
    auto_rectify_at: string;
    ai_appeal_count: number;
    ai_attempt_count: number;
    proof_requested_at: string | null;
    proof_requested_by: string | null;
    decision_reason: string | null;
    requested_at: string;
    resolved_at: string | null;
    created_at: string;
    updated_at: string;
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
    source: "MANUAL" | "DEFAULT_DEADLINE_1H" | "DEFAULT_DEADLINE_10M" | "DEFAULT_DEADLINE_DUE";
    notified_at: string | null;
    created_at: string;
    updated_at: string;
}

/**
 * A device's record that it has armed a reminder on its own OS scheduler.
 * The reminder cron skips pushing to any device holding a live claim, which is
 * what keeps punctual local delivery from double-notifying. `armed_until` is a
 * lease: a device that stops syncing lets its claims expire and is pushed to
 * again.
 */
export interface ReminderDeviceClaim {
    reminder_id: string;
    user_id: string;
    user_client_instance_id: string;
    armed_until: string;
    created_at: string;
    updated_at: string;
}

/** Outbox row telling a device its armed reminders are stale and must re-sync. */
export interface ReminderInvalidation {
    id: number;
    user_id: string;
    user_client_instance_id: string;
    created_at: string;
    dispatched_at: string | null;
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
    proof_origin?: "CAMERA" | "LIBRARY" | "UNKNOWN";
    proof_timestamp_at?: string | null;
    proof_timestamp_source?: "CAMERA_CAPTURE" | "EXIF" | "EMBEDDED_METADATA" | "FILE_CREATION" | "FILE_MODIFICATION" | "ATTACHED" | "UNKNOWN";
    proof_timezone?: string | null;
    upload_state: "PENDING" | "UPLOADED" | "FAILED";
    created_at: string;
    updated_at: string;
}

export interface AiVouch {
    id: string;
    task_id: string;
    attempt_number: number;
    reason: string;
    decision: "approved" | "denied";
    vouched_at: string;
    approved_at: string | null;
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
    entry_type: "denied" | "missed" | "surrendered" | "rectified" | "override" | "voucher_timeout_penalty";
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

export interface Override {
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

export interface MonthlySettlementRun {
    id: string;
    user_id: string;
    period: string;
    timezone: string;
    total_cents: number | null;
    charity_key: string | null;
    claimed_at: string;
    sent_at: string | null;
    email_sent: boolean;
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
    default_event_duration_minutes: number;
    default_event_color_id: string;
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

export interface EnqueueGoogleCalendarTaskResult {
    status: "enqueued" | "skipped";
    reason: "task_not_event" | "google_not_connected" | "app_to_google_disabled" | "calendar_not_selected" | "google_event_missing" | null;
    outbox_id: number | null;
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
    time_bound_for_rule?: boolean;
    window_start_offset_minutes?: number | null;
    google_event_duration_minutes?: number | null;
    google_event_color_id?: string | null;
    manual_reminder_offsets_ms?: number[] | null;
    last_generated_date: string | null; // YYYY-MM-DD
    latest_iteration?: number;
    paused_at?: string | null;
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
    friends?: FriendProfile[];
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
                Insert: Omit<Profile, "id" | "created_at" | "currency" | "default_pomo_duration_minutes" | "default_event_duration_minutes" | "default_task_deadline_time" | "default_failure_cost_cents" | "default_voucher_id" | "default_requires_proof_for_all_tasks" | "auto_submit_after_proof_upload" | "strict_pomo_enabled" | "deadline_one_hour_warning_enabled" | "deadline_final_warning_enabled" | "deadline_due_warning_enabled" | "voucher_can_view_active_tasks" | "always_show_active_tasks" | "web_notifications_enabled" | "ai_friend_opt_in" | "hide_tips" | "charity_enabled" | "selected_charity_id" | "timezone" | "timezone_user_set"> & Partial<Pick<Profile, "currency" | "default_pomo_duration_minutes" | "default_event_duration_minutes" | "default_task_deadline_time" | "default_failure_cost_cents" | "default_voucher_id" | "default_requires_proof_for_all_tasks" | "auto_submit_after_proof_upload" | "strict_pomo_enabled" | "deadline_one_hour_warning_enabled" | "deadline_final_warning_enabled" | "deadline_due_warning_enabled" | "voucher_can_view_active_tasks" | "always_show_active_tasks" | "web_notifications_enabled" | "ai_friend_opt_in" | "hide_tips" | "charity_enabled" | "selected_charity_id" | "timezone" | "timezone_user_set">>
                Update: Partial<Profile>
            }
            charities: {
                Row: Charity
                Insert: Omit<Charity, "id" | "created_at" | "updated_at" | "is_active"> & Partial<Pick<Charity, "id" | "created_at" | "updated_at" | "is_active">>
                Update: Partial<Charity>
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
            reminder_device_claims: {
                Row: ReminderDeviceClaim
                Insert: Omit<ReminderDeviceClaim, "created_at" | "updated_at"> & Partial<Pick<ReminderDeviceClaim, "created_at" | "updated_at">>
                Update: Partial<ReminderDeviceClaim>
            }
            reminder_invalidations: {
                Row: ReminderInvalidation
                Insert: Omit<ReminderInvalidation, "id" | "created_at" | "dispatched_at"> & Partial<Pick<ReminderInvalidation, "created_at" | "dispatched_at">>
                Update: Partial<ReminderInvalidation>
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
            rectification_requests: {
                Row: RectificationRequest
                Insert: Omit<RectificationRequest, "id" | "created_at" | "updated_at" | "requested_at">
                Update: Partial<RectificationRequest>
            }
            overrides: {
                Row: Override
                Insert: Omit<Override, "id" | "created_at">
                Update: Partial<Override>
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
            monthly_settlement_runs: {
                Row: MonthlySettlementRun
                Insert: Omit<MonthlySettlementRun, "id" | "claimed_at" | "email_sent"> & Partial<Pick<MonthlySettlementRun, "id" | "claimed_at" | "email_sent">>
                Update: Partial<MonthlySettlementRun>
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            enqueue_google_calendar_task_upsert: {
                Args: {
                    p_task_id: string
                }
                Returns: EnqueueGoogleCalendarTaskResult[]
            }
            enqueue_google_calendar_task_delete: {
                Args: {
                    p_task_id: string
                    p_google_event_id?: string | null
                    p_calendar_id?: string | null
                }
                Returns: EnqueueGoogleCalendarTaskResult[]
            }
            set_recurrence_paused: {
                Args: {
                    p_task_id: string
                    p_paused: boolean
                    p_actor_user_client_instance_id?: string | null
                }
                Returns: Array<{
                    recurrence_rule_id: string
                    paused_at: string | null
                    state_changed: boolean
                }>
            }
            update_paused_recurrence_settings: {
                Args: {
                    p_task_id: string
                    p_time_of_day?: string | null
                    p_failure_cost_cents?: number | null
                    p_voucher_id?: string | null
                    p_requires_proof?: boolean | null
                }
                Returns: Array<{
                    recurrence_rule_id: string
                    time_of_day: string
                    failure_cost_cents: number
                    voucher_id: string
                    requires_proof: boolean
                    updated_at: string
                }>
            }
            surrender_task_atomic: {
                Args: {
                    p_task_id: string
                    p_actor_user_client_instance_id?: string | null
                }
                Returns: Array<{
                    task_id: string
                    user_id: string
                    voucher_id: string
                    recurrence_rule_id: string | null
                    failure_cost_cents: number
                    previous_status: string
                }>
            }
        }
        Enums: {
            [_ in never]: never
        }
    }
}
