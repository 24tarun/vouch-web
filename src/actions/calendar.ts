"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
    createBlockForUser,
    deleteBlockForUser,
    loadCalendarRange,
    updateBlockForUser,
} from "@/lib/calendar/service";
import type { BlockTarget, CalendarBlock, CalendarWeekData } from "@/lib/calendar/types";

async function getAuthedClient() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    // task_time_blocks is newer than the generated Database types, so use the untyped client.
    return { supabase: supabase as unknown as SupabaseClient, user };
}

export async function getCalendarWeek(rangeStartIso: string, rangeEndIso: string): Promise<{ data?: CalendarWeekData; error?: string }> {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { error: "Not authenticated" };
    return loadCalendarRange(supabase, user.id, rangeStartIso, rangeEndIso);
}

export async function createTimeBlock(target: BlockTarget, startIso: string, endIso: string): Promise<{ block?: CalendarBlock; error?: string }> {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { error: "Not authenticated" };
    return createBlockForUser(supabase, user.id, target, startIso, endIso);
}

export async function updateTimeBlock(blockId: string, startIso: string, endIso: string): Promise<{ block?: CalendarBlock; error?: string }> {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { error: "Not authenticated" };
    return updateBlockForUser(supabase, user.id, blockId, startIso, endIso);
}

export async function deleteTimeBlock(blockId: string): Promise<{ success?: true; error?: string }> {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { error: "Not authenticated" };
    return deleteBlockForUser(supabase, user.id, blockId);
}
