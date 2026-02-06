"use client";

import { signOut } from "@/actions/auth";
import { usePomodoro } from "@/components/PomodoroProvider";
import type { FormEvent } from "react";

export function SignOutMenuForm() {
    const { session, suppressUnloadWarning } = usePomodoro();

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

        suppressUnloadWarning();
    };

    return (
        <form action={signOut} className="w-full" onSubmit={handleSubmit}>
            <button
                type="submit"
                className="w-full text-left text-red-500/80 hover:text-red-400 cursor-pointer text-xs uppercase tracking-wider h-10"
            >
                Sign out
            </button>
        </form>
    );
}
