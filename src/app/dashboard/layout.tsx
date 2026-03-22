import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedPendingVouchCountForVoucher } from "@/actions/voucher";
import { NavLinks } from "@/components/NavLinks";
import { RealtimeListener } from "@/components/RealtimeListener";
import { PomodoroProvider } from "@/components/PomodoroProvider";

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

    const [vouchCount, proofRequestCountResult] = await Promise.all([
        getCachedPendingVouchCountForVoucher(user.id),
        supabase
            .from("tasks")
            .select("*", { count: "exact", head: true })
            .eq("user_id", user.id)
            .eq("proof_request_open", true)
            .in("status", ["AWAITING_VOUCHER", "MARKED_COMPLETED"]),
    ]);
    const statsBadgeCount = proofRequestCountResult.count || 0;

    return (
        <PomodoroProvider>
            <div className="min-h-screen bg-slate-950 text-slate-200">
                <RealtimeListener userId={user.id} />
                {/* Navigation */}
                <nav className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 pt-safe">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="h-14 flex items-center">
                            <div className="mx-auto w-full max-w-3xl px-4 md:px-0">
                                <NavLinks vouchCount={vouchCount} statsBadgeCount={statsBadgeCount} />
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
