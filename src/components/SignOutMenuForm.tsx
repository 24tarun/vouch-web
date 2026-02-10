"use client";

import { signOut } from "@/actions/auth";
import { usePomodoro } from "@/components/PomodoroProvider";
import type { FormEvent } from "react";

interface SignOutMenuFormProps {
    variant?: "menu" | "nav";
    className?: string;
}

export function SignOutMenuForm({ variant = "menu", className = "" }: SignOutMenuFormProps) {
    const { session } = usePomodoro();

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        if (session?.status === "ACTIVE") {
            const proceed = window.confirm(
                "You have an active Pomodoro running. If you sign out, it will be ended and logged automatically. Continue?"
            );

            if (!proceed) {
                e.preventDefault();
                return;
            }
        }
    };

    if (variant === "nav") {
        return (
            <form action={signOut} className="shrink-0" onSubmit={handleSubmit}>
                <button
                    type="submit"
                    className={`text-[10px] sm:text-xs font-mono uppercase tracking-widest transition-colors shrink-0 flex items-center text-red-500/80 hover:text-red-400 cursor-pointer whitespace-nowrap ${className}`}
                >
                    Sign Out
                </button>
            </form>
        );
    }

    return (
        <form action={signOut} className="w-full" onSubmit={handleSubmit}>
            <button
                type="submit"
                className={`w-full text-left text-red-500/80 hover:text-red-400 cursor-pointer text-xs uppercase tracking-wider h-10 ${className}`}
            >
                Sign out
            </button>
        </form>
    );
}
