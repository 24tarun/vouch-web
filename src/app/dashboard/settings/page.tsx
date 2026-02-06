import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SettingsClient from "./settings-client";
import { getFriends } from "@/actions/friends";

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

    const friends = await getFriends();

    return <SettingsClient profile={profile} friends={friends} />;
}
