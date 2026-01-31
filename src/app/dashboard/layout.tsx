import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/actions/auth";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

    const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    const initials = profile?.username?.slice(0, 2).toUpperCase() || "??";

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            {/* Navigation */}
            <nav className="border-b border-slate-700/50 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16 items-center">
                        {/* Logo */}
                        <Link href="/dashboard" className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                                <span className="text-sm font-bold text-white">V</span>
                            </div>
                            <span className="text-lg font-semibold text-white">Vouch</span>
                        </Link>

                        {/* Navigation Links */}
                        <div className="hidden md:flex items-center gap-6">
                            <Link
                                href="/dashboard"
                                className="text-slate-300 hover:text-white transition-colors"
                            >
                                Tasks
                            </Link>
                            <Link
                                href="/dashboard/voucher"
                                className="text-slate-300 hover:text-white transition-colors"
                            >
                                Vouch Requests
                            </Link>
                            <Link
                                href="/dashboard/friends"
                                className="text-slate-300 hover:text-white transition-colors"
                            >
                                Friends
                            </Link>
                            <Link
                                href="/dashboard/ledger"
                                className="text-slate-300 hover:text-white transition-colors"
                            >
                                Ledger
                            </Link>
                        </div>

                        {/* User Menu */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    className="relative h-10 w-10 rounded-full"
                                >
                                    <Avatar className="h-10 w-10 border-2 border-purple-500/50">
                                        <AvatarFallback className="bg-gradient-to-br from-purple-600 to-pink-600 text-white">
                                            {initials}
                                        </AvatarFallback>
                                    </Avatar>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                className="w-56 bg-slate-800 border-slate-700"
                                align="end"
                            >
                                <DropdownMenuLabel className="text-slate-200">
                                    <div className="flex flex-col space-y-1">
                                        <p className="text-sm font-medium">{profile?.username}</p>
                                        <p className="text-xs text-slate-400">{user.email}</p>
                                    </div>
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator className="bg-slate-700" />
                                <DropdownMenuItem asChild>
                                    <Link
                                        href="/dashboard/settings"
                                        className="text-slate-300 cursor-pointer"
                                    >
                                        Settings
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-slate-700" />
                                <DropdownMenuItem asChild>
                                    <form action={signOut}>
                                        <button
                                            type="submit"
                                            className="w-full text-left text-red-400 cursor-pointer"
                                        >
                                            Sign out
                                        </button>
                                    </form>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </nav>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {children}
            </main>
        </div>
    );
}
