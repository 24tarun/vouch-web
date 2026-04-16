import { ORCA_PROFILE_ID } from "@/lib/ai-voucher/constants";

// task_events.actor_id is a UUID FK to profiles.id, so system-originated events
// must use a valid profile UUID rather than a string sentinel.
export const SYSTEM_ACTOR_PROFILE_ID = ORCA_PROFILE_ID;
