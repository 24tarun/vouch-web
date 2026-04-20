import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SettingsClient from "./settings-client";
import { getFriends } from "@/actions/friends";
import { getGoogleCalendarIntegrationState } from "@/actions/google-calendar";
import { BuildStamp } from "@/components/BuildStamp";

export default async function SettingsPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login");
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    if (!profile) {
        // This should theoretically not happen if signIn enforces it, 
        // but if it does, force a logout or redirect
        await supabase.auth.signOut();
        redirect("/login?error=profile_missing");
    }

    const [friends, googleCalendarIntegration] = await Promise.all([
        getFriends(),
        getGoogleCalendarIntegrationState(),
    ]);
    const { data: charities } = await supabase
        .from("charities")
        .select("id, key, name, is_active, created_at, updated_at")
        .order("name", { ascending: true });

    return (
        <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
            <div className="flex-1">
                <SettingsClient
                    profile={profile}
                    friends={friends}
                    googleCalendarIntegration={googleCalendarIntegration}
                    charities={(charities as Array<{ id: string; key: string; name: string; is_active: boolean; created_at: string; updated_at: string }> | null) ?? []}
                />
            </div>
            <div className="pt-6 pb-safe">
                <BuildStamp className="text-center text-[10px] leading-4 tracking-[0.03em] text-slate-400 font-mono" />
            </div>
        </div>
    );
}
