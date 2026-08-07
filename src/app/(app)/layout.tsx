import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NavLinks } from "@/components/NavLinks";
import { RealtimeListener } from "@/components/RealtimeListener";
import { PomodoroProvider } from "@/components/PomodoroProvider";
import { PushInitializer } from "@/components/PushInitializer";
import { resolveWebUserClientInstanceStatus } from "@/lib/user-client-instance";

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login");
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
        try {
            const payload = JSON.parse(
                Buffer.from(session.access_token.split(".")[1], "base64").toString()
            );
            const isRecovery = (payload.amr as { method: string }[] | undefined)
                ?.some((m) => m.method === "recovery");
            if (isRecovery) {
                await supabase.auth.signOut();
                redirect("/");
            }
        } catch {}
    }

    const [clientInstanceStatus, profileResult] = await Promise.all([
        resolveWebUserClientInstanceStatus(user.id),
        supabase
            .from("profiles")
            .select("username, avatar_path")
            .eq("id", user.id)
            .maybeSingle(),
    ]);
    const profile = profileResult.data as { username?: string | null; avatar_path?: string | null } | null;
    const avatarPath = profile?.avatar_path?.trim();
    const avatarUrl = avatarPath
        ? supabase.storage.from("avatars").getPublicUrl(avatarPath).data.publicUrl
        : null;

    return (
        <PomodoroProvider>
            <div className="min-h-screen bg-slate-950 text-slate-200">
                <RealtimeListener userId={user.id} />
                <PushInitializer autoPrompt={clientInstanceStatus.isNew} />
                {/* Navigation */}
                <nav aria-label="Primary" className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 pt-safe">
                    <div className="max-w-4xl mx-auto px-4 md:px-0">
                        <div className="h-14 flex items-center">
                            <div className="w-full">
                                <NavLinks
                                    userId={user.id}
                                    username={profile?.username ?? user.email?.split("@")[0] ?? "User"}
                                    avatarUrl={avatarUrl}
                                />
                            </div>
                        </div>
                    </div>
                </nav>

                {/* Main Content */}
                <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pl-safe pr-safe pb-safe">
                    {children}
                </main>
            </div>
        </PomodoroProvider>
    );
}
