"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { signIn, signUp } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

function LoginContent() {
    const searchParams = useSearchParams();
    const initialMode = searchParams.get("mode") === "signup" ? "signup" : "signin";

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [mode, setMode] = useState<"signin" | "signup">(initialMode);
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{
        type: "success" | "error";
        text: string;
    } | null>(null);

    // Update mode if query param changes
    useEffect(() => {
        const queryMode = searchParams.get("mode");
        if (queryMode === "signup" || queryMode === "signin") {
            setMode(queryMode);
        }
    }, [searchParams]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setIsLoading(true);
        setMessage(null);

        const formData = new FormData();
        formData.append("email", email);
        formData.append("password", password);

        console.log("Submitting form:", { mode, email });

        try {
            let result;
            if (mode === "signin") {
                result = await signIn(formData);
            } else {
                result = await signUp(formData);
            }

            console.log("Auth result:", result);

            if (result?.error) {
                setMessage({ type: "error", text: result.error });
            } else if (result && "success" in result && result.success) {
                setMessage({ type: "success", text: result.message || "Success!" });
            }
        } catch (err: any) {
            // Next.js throws a NEXT_REDIRECT error for server-side redirects; ignore it so we don't flash an error
            if (err?.digest && typeof err.digest === "string" && err.digest.startsWith("NEXT_REDIRECT")) {
                throw err;
            }

            console.error("Submission error:", err);
            setMessage({ type: "error", text: "An unexpected error occurred." });
        }

        setIsLoading(false);
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
            <Card className="w-full max-w-md bg-slate-900 border-slate-800 shadow-2xl">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-6 h-12 w-12 rounded bg-slate-200 flex items-center justify-center">
                        <span className="text-xs font-bold text-slate-900 leading-none">TAS</span>
                    </div>
                    <CardTitle className="text-2xl font-bold text-white tracking-tight">
                        {mode === "signin" ? "Sign In" : "Create Account"}
                    </CardTitle>
                    <CardDescription className="text-slate-500 text-sm">
                        {mode === "signin"
                            ? "Access the Task Accountability System"
                            : "Join TAS and start committing to your goals"}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="email" className="text-xs font-mono uppercase tracking-widest text-slate-500">
                                Email
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="name@domain.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-700 focus:border-slate-500 focus:ring-0 transition-colors"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password" className="text-xs font-mono uppercase tracking-widest text-slate-500">
                                Password
                            </Label>
                            <Input
                                id="password"
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                minLength={6}
                                className="bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-700 focus:border-slate-500 focus:ring-0 transition-colors"
                            />
                        </div>

                        {message && (
                            <div
                                className={`p-3 rounded text-xs font-medium ${message.type === "success"
                                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                    : "bg-red-500/10 text-red-400 border border-red-500/20"
                                    }`}
                            >
                                {message.text}
                            </div>
                        )}

                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-slate-200 hover:bg-white text-slate-900 font-bold py-6 rounded transition-all"
                        >
                            {isLoading
                                ? "Processing..."
                                : mode === "signin" ? "Sign In" : "Sign Up"}
                        </Button>
                    </form>

                    <div className="mt-8 text-center text-xs font-mono uppercase tracking-widest text-slate-500">
                        {mode === "signin" ? (
                            <>
                                Need an account?{" "}
                                <button
                                    onClick={() => {
                                        setMode("signup");
                                        setMessage(null);
                                    }}
                                    className="text-slate-200 hover:text-white transition-colors"
                                >
                                    Sign Up
                                </button>
                            </>
                        ) : (
                            <>
                                Already have an account?{" "}
                                <button
                                    onClick={() => {
                                        setMode("signin");
                                        setMessage(null);
                                    }}
                                    className="text-slate-200 hover:text-white transition-colors"
                                >
                                    Sign In
                                </button>
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500 font-mono text-xs uppercase tracking-widest">Loading...</div>}>
            <LoginContent />
        </Suspense>
    );
}
