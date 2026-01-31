"use client";

import { useState } from "react";
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

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [mode, setMode] = useState<"signin" | "signup">("signin");
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{
        type: "success" | "error";
        text: string;
    } | null>(null);

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
        } catch (err) {
            console.error("Submission error:", err);
            setMessage({ type: "error", text: "An unexpected error occurred." });
        }

        setIsLoading(false);
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
            <Card className="w-full max-w-md bg-slate-800/50 border-slate-700 backdrop-blur-sm">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                        <span className="text-2xl font-bold text-white">V</span>
                    </div>
                    <CardTitle className="text-2xl font-bold text-white">
                        {mode === "signin" ? "Welcome Back" : "Create Account"}
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                        {mode === "signin"
                            ? "Sign in to continue your accountability journey"
                            : "Join Vouch and start committing to your goals"}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email" className="text-slate-200">
                                Email
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-purple-500 focus:ring-purple-500"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password" className="text-slate-200">
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
                                className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-purple-500 focus:ring-purple-500"
                            />
                        </div>

                        {message && (
                            <div
                                className={`p-3 rounded-lg text-sm ${message.type === "success"
                                    ? "bg-green-500/20 text-green-300 border border-green-500/30"
                                    : "bg-red-500/20 text-red-300 border border-red-500/30"
                                    }`}
                            >
                                {message.text}
                            </div>
                        )}

                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-medium"
                        >
                            {isLoading
                                ? "Processing..."
                                : mode === "signin" ? "Sign In" : "Sign Up"}
                        </Button>
                    </form>

                    <div className="mt-6 text-center text-sm text-slate-400">
                        {mode === "signin" ? (
                            <>
                                Don't have an account?{" "}
                                <button
                                    onClick={() => {
                                        setMode("signup");
                                        setMessage(null);
                                    }}
                                    className="text-purple-400 hover:text-purple-300 font-semibold hover:underline"
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
                                    className="text-purple-400 hover:text-purple-300 font-semibold hover:underline"
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
