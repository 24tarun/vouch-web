import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/actions/auth";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { NavLinks } from "@/components/NavLinks";
import { RealtimeListener } from "@/components/RealtimeListener";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

    // @ts-ignore
    const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    // Fetch vouch requests count
    // @ts-ignore
    const { count: vouchCount } = await supabase
        .from("tasks")
        .select("*", { count: 'exact', head: true })
        .eq("voucher_id", user.id)
        .eq("status", "AWAITING_VOUCHER");

    const initials = (profile as any)?.username?.slice(0, 2).toUpperCase() || "??";

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200">
            <RealtimeListener userId={user.id} />
            {/* Navigation */}
            <nav className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 pt-safe">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col">
                        <div className="flex justify-between h-14 items-center">
                            {/* Logo */}
                            <Link href="/dashboard" className="flex items-center gap-2">
                                <div className="h-7 w-7 rounded bg-slate-200 flex items-center justify-center">
                                    <span className="text-[10px] font-bold text-slate-900 leading-none">TAS</span>
                                </div>
                                <span className="text-base font-bold tracking-tight text-white">TAS</span>
                            </Link>

                            {/* User Menu */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className="relative h-9 w-9 rounded-full hover:bg-slate-900 pr-0"
                                    >
                                        <Avatar className="h-7 w-7 border border-slate-800">
                                            <AvatarFallback className="bg-slate-800 text-slate-200 text-[10px]">
                                                {initials}
                                            </AvatarFallback>
                                        </Avatar>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    className="w-56 bg-slate-900 border-slate-800"
                                    align="end"
                                >
                                    <DropdownMenuLabel className="text-slate-200">
                                        <div className="flex flex-col space-y-1">
                                            <p className="text-sm font-medium">{(profile as any)?.username}</p>
                                            <p className="text-xs text-slate-500 font-mono">{user.email}</p>
                                        </div>
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator className="bg-slate-800" />
                                    <DropdownMenuItem asChild>
                                        <Link
                                            href="/dashboard/settings"
                                            className="text-slate-300 cursor-pointer text-xs uppercase tracking-wider h-10"
                                        >
                                            Settings
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-slate-800" />
                                    <DropdownMenuItem asChild>
                                        <form action={signOut} className="w-full">
                                            <button
                                                type="submit"
                                                className="w-full text-left text-red-500/80 hover:text-red-400 cursor-pointer text-xs uppercase tracking-wider h-10"
                                            >
                                                Sign out
                                            </button>
                                        </form>
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        {/* Navigation Links - Horizontal Scroll on Mobile */}
                        <NavLinks vouchCount={vouchCount} />
                    </div>
                </div>
            </nav>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pl-safe pr-safe pb-safe">
                {children}
            </main>
        </div>
    );
}
