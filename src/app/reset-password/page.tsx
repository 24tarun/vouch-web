"use client";

import { useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { completePasswordReset } from "@/actions/auth";

function ResetPasswordContent() {
    const router = useRouter();
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setIsLoading(true);
        setMessage(null);

        const formData = new FormData();
        formData.append("password", password);
        formData.append("confirmPassword", confirmPassword);

        const result = await completePasswordReset(formData);

        if (result?.error) {
            setMessage({ type: "error", text: result.error });
            setIsLoading(false);
        } else if (result?.success) {
            setMessage({ type: "success", text: result.message || "Password updated!" });
            setTimeout(() => router.push("/login"), 1500);
        }
    }

    return (
        <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            <link
                href="https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500;1,600&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&display=swap"
                rel="stylesheet"
            />
            <style>{`
                :root {
                    --bg: #020617; --surface: #0f172a; --border: #1e293b;
                    --border-hi: #334155; --fg: #f8fafc; --fg-dim: #94a3b8;
                    --fg-muted: #334155; --cyan: #00d9ff;
                    --cyan-glow: rgba(0,217,255,0.35);
                    --cyan-glow-hi: rgba(0,217,255,0.6);
                }
                * { box-sizing: border-box; margin: 0; padding: 0; }
                html, body { background: #020617 !important; }
                .fm { font-family: 'DM Mono','Courier New',monospace; }
                .fc { font-family: 'Cormorant',Georgia,serif; }
                .auth-label {
                    font-family: 'DM Mono',monospace; font-size: 10px;
                    letter-spacing: 0.18em; text-transform: uppercase;
                    color: var(--fg-dim); display: block; margin-bottom: 8px;
                }
                .auth-input {
                    width: 100%; background: var(--bg); border: 1px solid var(--border);
                    color: var(--fg); font-family: 'DM Mono',monospace; font-size: 13px;
                    padding: 12px 16px; outline: none; transition: border-color 0.2s;
                    border-radius: 0; -webkit-appearance: none;
                }
                .auth-input::placeholder { color: var(--fg-muted); }
                .auth-input:focus { border-color: var(--cyan); }
                .auth-btn {
                    width: 100%; background: var(--cyan); color: #000;
                    font-family: 'DM Mono',monospace; font-size: 12px; font-weight: 500;
                    letter-spacing: 0.15em; text-transform: uppercase; padding: 16px;
                    border: none; cursor: pointer; transition: box-shadow 0.2s, opacity 0.2s;
                    box-shadow: 0 0 18px var(--cyan-glow);
                }
                .auth-btn:hover:not(:disabled) { box-shadow: 0 0 28px var(--cyan-glow-hi); }
                .auth-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            `}</style>

            <div style={{
                minHeight: "100dvh", background: "var(--bg)",
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "40px 24px",
            }}>
                <div style={{ width: "100%", maxWidth: "400px" }}>
                    <div className="fm" style={{
                        fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase",
                        color: "var(--fg-dim)", marginBottom: "40px",
                    }}>
                        Set New Password
                    </div>

                    <div className="fc" style={{
                        fontSize: "clamp(36px,6vw,56px)", fontWeight: 300,
                        lineHeight: 0.92, letterSpacing: "-0.02em",
                        color: "var(--fg)", marginBottom: "40px",
                    }}>
                        Choose a new<br />
                        <em style={{ fontStyle: "italic", color: "var(--cyan)", fontWeight: 400,
                            filter: "drop-shadow(0 0 10px rgba(0,217,255,0.35))" }}>
                            password.
                        </em>
                    </div>

                    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                        <div>
                            <label className="auth-label" htmlFor="password">New Password</label>
                            <input
                                className="auth-input"
                                id="password"
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                minLength={8}
                                autoComplete="new-password"
                            />
                        </div>
                        <div>
                            <label className="auth-label" htmlFor="confirmPassword">Confirm Password</label>
                            <input
                                className="auth-input"
                                id="confirmPassword"
                                type="password"
                                placeholder="••••••••"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                required
                                minLength={8}
                                autoComplete="new-password"
                            />
                        </div>

                        {message && (
                            <div style={{
                                padding: "12px 16px", fontSize: "11px",
                                fontFamily: "'DM Mono',monospace", letterSpacing: "0.04em",
                                border: "1px solid",
                                borderColor: message.type === "success" ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)",
                                background: message.type === "success" ? "rgba(52,211,153,0.06)" : "rgba(248,113,113,0.06)",
                                color: message.type === "success" ? "#34d399" : "#f87171",
                            }}>
                                {message.text}
                            </div>
                        )}

                        <button type="submit" className="auth-btn" disabled={isLoading}>
                            {isLoading ? "Updating..." : "Update Password"}
                        </button>
                    </form>
                </div>
            </div>
        </>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={
            <div style={{ minHeight: "100dvh", background: "#020617", display: "flex",
                alignItems: "center", justifyContent: "center",
                fontFamily: "'DM Mono',monospace", fontSize: "11px",
                letterSpacing: "0.2em", textTransform: "uppercase", color: "#334155" }}>
                Loading...
            </div>
        }>
            <ResetPasswordContent />
        </Suspense>
    );
}
