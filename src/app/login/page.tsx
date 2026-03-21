"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
    completePasswordReset,
    requestPasswordReset,
    signIn,
    signUp,
} from "@/actions/auth";

type AuthMode = "signin" | "signup" | "forgot" | "reset";

function resolveMode(rawMode: string | null): AuthMode {
    if (rawMode === "signup") return "signup";
    if (rawMode === "forgot") return "forgot";
    if (rawMode === "reset") return "reset";
    return "signin";
}

function LoginContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialMode = resolveMode(searchParams.get("mode"));

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [mode, setMode] = useState<AuthMode>(initialMode);
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [exiting, setExiting] = useState(false);

    const touchStartX = useRef(0);
    const touchStartY = useRef(0);

    function navigateBack() {
        setExiting(true);
        setTimeout(() => router.push("/"), 320);
    }

    function onTouchStart(e: React.TouchEvent) {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
    }

    function onTouchEnd(e: React.TouchEvent) {
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        const dy = Math.abs(e.changedTouches[0].clientY - touchStartY.current);
        // swipe right: horizontal > 72px, more horizontal than vertical
        if (dx > 72 && dy < dx * 0.6) navigateBack();
    }

    const callbackErrorParam = searchParams.get("error");
    const callbackErrorMessage =
        callbackErrorParam === "exchange_failed"
            ? "Failed to complete authentication. The link may have expired. Please try again."
            : callbackErrorParam === "missing_code"
                ? "Invalid authentication link. Please request a new one."
                : callbackErrorParam
                    ? "Authentication failed. Please try again."
                    : null;
    const effectiveMessage = message ?? (callbackErrorMessage ? { type: "error" as const, text: callbackErrorMessage } : null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setIsLoading(true);
        setMessage(null);

        const formData = new FormData();
        if (mode !== "reset") formData.append("email", email);
        if (mode !== "forgot") formData.append("password", password);
        if (mode === "reset") formData.append("confirmPassword", confirmPassword);

        try {
            let result;
            if (mode === "signin") result = await signIn(formData);
            else if (mode === "signup") result = await signUp(formData);
            else if (mode === "forgot") result = await requestPasswordReset(formData);
            else result = await completePasswordReset(formData);

            if (result?.error) {
                setMessage({ type: "error", text: result.error });
            } else if (result && "success" in result && result.success) {
                setMessage({ type: "success", text: result.message || "Success!" });
                if (mode === "forgot") setEmail("");
                else if (mode === "reset") {
                    setPassword("");
                    setConfirmPassword("");
                    setMode("signin");
                }
            }
        } catch (err: unknown) {
            const digest =
                typeof err === "object" && err !== null && "digest" in err
                    ? (err as { digest?: unknown }).digest
                    : undefined;
            if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) throw err;
            console.error("Submission error:", err);
            setMessage({ type: "error", text: "An unexpected error occurred." });
        }

        setIsLoading(false);
    }

    const headlines: Record<AuthMode, { top: string; bottom: string }> = {
        signin:  { top: "Welcome",       bottom: "back."         },
        signup:  { top: "Start holding", bottom: "yourself accountable." },
        forgot:  { top: "Reset your",    bottom: "password."     },
        reset:   { top: "Choose a new",  bottom: "password."     },
    };

    const { top, bottom } = headlines[mode];

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
                    --bg:           #020617;
                    --surface:      #0f172a;
                    --card:         #1e293b;
                    --border:       #1e293b;
                    --border-hi:    #334155;
                    --fg:           #f8fafc;
                    --fg-dim:       #94a3b8;
                    --fg-muted:     #334155;
                    --cyan:         #00d9ff;
                    --cyan-glow:    rgba(0, 217, 255, 0.35);
                    --cyan-glow-hi: rgba(0, 217, 255, 0.6);
                }

                * { box-sizing: border-box; margin: 0; padding: 0; }

                .fc { font-family: 'Cormorant', Georgia, serif; }
                .fm { font-family: 'DM Mono', 'Courier New', monospace; }

                @keyframes riseUp {
                    from { opacity: 0; transform: translateY(24px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                .rise  { animation: riseUp 0.9s cubic-bezier(0.16,1,0.3,1) both; }
                .d1    { animation-delay: 0.1s; }
                .d2    { animation-delay: 0.2s; }
                .d3    { animation-delay: 0.3s; }

                .cyan-glow { filter: drop-shadow(0 0 10px var(--cyan-glow)); }

                .eyebrow {
                    font-family: 'DM Mono', monospace;
                    font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase;
                    color: var(--cyan);
                    display: flex; align-items: center; gap: 14px;
                }
                .eyebrow::before {
                    content: ''; display: inline-block;
                    width: 32px; height: 1px;
                    background: var(--cyan);
                    box-shadow: 0 0 6px var(--cyan-glow);
                    flex-shrink: 0;
                }

                /* Form inputs */
                .auth-label {
                    font-family: 'DM Mono', monospace;
                    font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
                    color: var(--fg-dim);
                    display: block; margin-bottom: 8px;
                }
                .auth-input {
                    width: 100%;
                    background: var(--bg);
                    border: 1px solid var(--border);
                    color: var(--fg);
                    font-family: 'DM Mono', monospace;
                    font-size: 13px;
                    padding: 12px 16px;
                    outline: none;
                    transition: border-color 0.2s;
                    border-radius: 0;
                    -webkit-appearance: none;
                }
                .auth-input::placeholder { color: var(--fg-muted); }
                .auth-input:focus { border-color: var(--cyan); }

                .auth-btn {
                    width: 100%;
                    background: var(--cyan);
                    color: #000;
                    font-family: 'DM Mono', monospace;
                    font-size: 12px; font-weight: 500;
                    letter-spacing: 0.15em; text-transform: uppercase;
                    padding: 16px;
                    border: none; cursor: pointer;
                    transition: box-shadow 0.2s, opacity 0.2s;
                    box-shadow: 0 0 18px var(--cyan-glow);
                }
                .auth-btn:hover:not(:disabled) { box-shadow: 0 0 28px var(--cyan-glow-hi); }
                .auth-btn:disabled { opacity: 0.5; cursor: not-allowed; }

                .auth-link {
                    background: none; border: none; cursor: pointer;
                    font-family: 'DM Mono', monospace;
                    font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
                    color: var(--cyan);
                    transition: opacity 0.2s;
                    text-decoration: none;
                }
                .auth-link:hover { opacity: 0.7; }

                .auth-link-dim {
                    background: none; border: none; cursor: pointer;
                    font-family: 'DM Mono', monospace;
                    font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
                    color: var(--fg-dim);
                    transition: color 0.2s;
                }
                .auth-link-dim:hover { color: var(--fg); }

                body::after {
                    content: '';
                    position: fixed; inset: 0;
                    pointer-events: none; z-index: 9999; opacity: 0.02;
                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
                    background-size: 200px 200px;
                }

                /* ── Kill body background so no white flash during slide ── */
                html, body { background: #020617 !important; }

                /* ── Page slide transitions ── */
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to   { transform: translateX(0);    opacity: 1; }
                }
                @keyframes slideOutRight {
                    from { transform: translateX(0);    opacity: 1; }
                    to   { transform: translateX(100%); opacity: 0; }
                }
                .page-enter {
                    animation: slideInRight 0.38s cubic-bezier(0.25, 1, 0.5, 1) both;
                }
                .page-exit {
                    animation: slideOutRight 0.32s cubic-bezier(0.5, 0, 0.75, 0) both;
                }

                /* ── Responsive layout ── */
                .auth-shell {
                    display: flex;
                    min-height: 100dvh;
                }
                .auth-left {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    padding: 80px 64px;
                    border-right: 1px solid var(--border);
                    position: relative;
                    overflow: hidden;
                }
                .auth-right {
                    width: 100%;
                    max-width: 480px;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    padding: 80px 48px;
                }

                @media (max-width: 768px) {
                    .auth-shell { flex-direction: column; }
                    .auth-left  { display: none; }
                    .auth-right {
                        max-width: 100%;
                        padding: 60px 28px 48px;
                        justify-content: flex-start;
                    }
                }
            `}</style>

            <div
                className={`auth-shell ${exiting ? "page-exit" : "page-enter"}`}
                style={{ background: "var(--bg)" }}
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
            >

                {/* ── Left panel — editorial headline ── */}
                <div className="auth-left">
                    {/* Radial glow */}
                    <div style={{
                        position: "absolute",
                        top: "-100px", left: "-100px",
                        width: "600px", height: "600px",
                        background: "radial-gradient(ellipse at center, rgba(0,217,255,0.05) 0%, transparent 70%)",
                        pointerEvents: "none",
                    }} />

                    <div className="rise eyebrow" style={{ marginBottom: "48px" }}>
                        Task Accountability System
                    </div>

                    <div className="rise d1 fc" style={{
                        fontSize: "clamp(52px, 6vw, 96px)",
                        fontWeight: 300,
                        lineHeight: 0.92,
                        letterSpacing: "-0.02em",
                        color: "var(--fg)",
                    }}>
                        {top}<br />
                        <em className="cyan-glow" style={{ fontStyle: "italic", color: "var(--cyan)", fontWeight: 400 }}>
                            {bottom}
                        </em>
                    </div>

                    {/* Bottom branding */}
                    <div className="rise d2 fm" style={{
                        position: "absolute", bottom: "40px", left: "64px",
                        fontSize: "10px", letterSpacing: "0.16em", textTransform: "uppercase",
                        color: "var(--fg-muted)",
                    }}>
                        TAS — by Tarun Hariharan
                    </div>
                </div>

                {/* ── Right panel — form ── */}
                <div className="auth-right">

                    {/* Back caret */}
                    <button
                        onClick={navigateBack}
                        style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            marginBottom: "40px",
                            padding: "0",
                            display: "inline-flex",
                            alignItems: "center",
                            color: "#60a5fa",
                            filter: "drop-shadow(0 0 8px rgba(96,165,250,0.6))",
                            transition: "filter 0.2s, transform 0.2s",
                        }}
                        onMouseOver={e => {
                            (e.currentTarget as HTMLButtonElement).style.filter = "drop-shadow(0 0 14px rgba(96,165,250,0.9))";
                            (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-3px)";
                        }}
                        onMouseOut={e => {
                            (e.currentTarget as HTMLButtonElement).style.filter = "drop-shadow(0 0 8px rgba(96,165,250,0.6))";
                            (e.currentTarget as HTMLButtonElement).style.transform = "translateX(0)";
                        }}
                        aria-label="Back to home"
                    >
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>

                    <div className="rise d1 fm" style={{
                        fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase",
                        color: "var(--fg-dim)", marginBottom: "40px",
                    }}>
                        {mode === "signin"  ? "Sign In"
                        : mode === "signup" ? "Create Account"
                        : mode === "forgot" ? "Reset Password"
                        :                    "Set New Password"}
                    </div>

                    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

                        {mode !== "reset" && (
                            <div>
                                <label className="auth-label" htmlFor="email">Email</label>
                                <input
                                    className="auth-input"
                                    id="email"
                                    type="email"
                                    placeholder="name@domain.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    autoComplete="email"
                                />
                            </div>
                        )}

                        {mode !== "forgot" && (
                            <div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                    <label className="auth-label" htmlFor="password" style={{ marginBottom: 0 }}>Password</label>
                                    {mode === "signin" && (
                                        <button type="button" className="auth-link-dim" onClick={() => { setMode("forgot"); setMessage(null); }}>
                                            Forgot?
                                        </button>
                                    )}
                                </div>
                                <input
                                    className="auth-input"
                                    id="password"
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                                />
                            </div>
                        )}

                        {mode === "reset" && (
                            <div>
                                <label className="auth-label" htmlFor="confirmPassword">Confirm Password</label>
                                <input
                                    className="auth-input"
                                    id="confirmPassword"
                                    type="password"
                                    placeholder="••••••••"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    autoComplete="new-password"
                                />
                            </div>
                        )}

                        {effectiveMessage && (
                            <div style={{
                                padding: "12px 16px",
                                fontSize: "11px",
                                fontFamily: "'DM Mono', monospace",
                                letterSpacing: "0.04em",
                                border: "1px solid",
                                borderColor: effectiveMessage.type === "success" ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)",
                                background: effectiveMessage.type === "success" ? "rgba(52,211,153,0.06)" : "rgba(248,113,113,0.06)",
                                color: effectiveMessage.type === "success" ? "#34d399" : "#f87171",
                            }}>
                                {effectiveMessage.text}
                            </div>
                        )}

                        <button type="submit" className="auth-btn" disabled={isLoading}>
                            {isLoading ? "Processing..."
                                : mode === "signin"  ? "Sign In"
                                : mode === "signup"  ? "Sign Up"
                                : mode === "forgot"  ? "Send Reset Link"
                                :                     "Update Password"}
                        </button>
                    </form>

                    {/* Mode switcher */}
                    <div className="fm" style={{ marginTop: "32px", fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--fg-muted)" }}>
                        {mode === "signin" ? (
                            <>
                                No account?{" "}
                                <button className="auth-link" onClick={() => { setMode("signup"); setMessage(null); }}>
                                    Sign Up
                                </button>
                            </>
                        ) : mode === "signup" ? (
                            <>
                                Have an account?{" "}
                                <button className="auth-link" onClick={() => { setMode("signin"); setMessage(null); }}>
                                    Sign In
                                </button>
                            </>
                        ) : (
                            <button className="auth-link" onClick={() => { setMode("signin"); setMessage(null); }}>
                                ← Back to Sign In
                            </button>
                        )}
                    </div>
                </div>

            </div>
        </>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div style={{ minHeight: "100dvh", background: "#020617", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono', monospace", fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#334155" }}>
                Loading...
            </div>
        }>
            <LoginContent />
        </Suspense>
    );
}
