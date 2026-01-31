import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SettingsClient from "./settings-client";

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

    // Create a fallback profile object if one doesn't exist
    // This allows the page to load even if the trigger failed
    const safeProfile = profile || {
        id: user.id,
        username: user.email?.split("@")[0] || "user",
        email: user.email || "",
        created_at: new Date().toISOString(),
    };

    return <SettingsClient profile={safeProfile} />;
}
