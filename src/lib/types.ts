import type { TaskStatus } from "./xstate/task-machine";

// Database types matching Supabase schema
export interface Profile {
    id: string;
    email: string;
    username: string;
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
    deadline: string;
    status: TaskStatus;
    postponed_at: string | null;
    marked_completed_at: string | null;
    voucher_response_deadline: string | null;
    created_at: string;
    updated_at: string;
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
    entry_type: "failure" | "rectified";
    created_at: string;
}

export interface RectifyPass {
    id: string;
    user_id: string;
    task_id: string;
    authorized_by: string;
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

// Extended types with relations
export interface TaskWithRelations extends Task {
    user?: Profile;
    voucher?: Profile;
    events?: TaskEvent[];
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
                Insert: Profile
                Update: Partial<Profile>
            }
            friendships: {
                Row: Friendship
                Insert: Friendship
                Update: Partial<Friendship>
            }
            tasks: {
                Row: Task
                Insert: Partial<Task>
                Update: Partial<Task>
            }
            task_events: {
                Row: TaskEvent
                Insert: Partial<TaskEvent>
                Update: Partial<TaskEvent>
            }
            ledger_entries: {
                Row: LedgerEntry
                Insert: Partial<LedgerEntry>
                Update: Partial<LedgerEntry>
            }
            rectify_passes: {
                Row: RectifyPass
                Insert: Partial<RectifyPass>
                Update: Partial<RectifyPass>
            }
            force_majeure: {
                Row: ForceMajeure
                Insert: Partial<ForceMajeure>
                Update: Partial<ForceMajeure>
            }
        }
    }
}
