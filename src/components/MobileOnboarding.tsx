"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

const SLIDES = [
    {
        eyebrow: "task accountability",
        headline: ["The cost of", "failure"],
        italic: "is real",
        body: "Commit to a task. Set a deadline. Put real money on the line.",
        visual: null as null,
        isCTA: false,
    },
    {
        eyebrow: "real stakes",
        headline: ["Commit."],
        italic: "Pay if you don't.",
        body: "Set a failure cost in EUR, USD, or INR. Miss the deadline — it goes to charity.",
        visual: "cost" as const,
        isCTA: false,
    },
    {
        eyebrow: "accountability",
        headline: ["Someone keeps"],
        italic: "you honest.",
        body: "Assign a friend as your voucher. They verify your work — 48 hours to respond or it auto-accepts.",
        visual: "voucher" as const,
        isCTA: false,
    },
    {
        eyebrow: "reputation",
        headline: ["Scored 0–1000."],
        italic: "Every task counts.",
        body: "Deliver consistently. Use the Pomodoro timer. Upload proof. Your score builds trust over time.",
        visual: "rep" as const,
        isCTA: false,
    },
    {
        eyebrow: "begin",
        headline: ["Start holding", "yourself"],
        italic: "accountable.",
        body: "No credit card required. Put real stakes on your first task in under a minute.",
        visual: null as null,
        isCTA: true,
    },
];

function SlideVisual({ type }: { type: "cost" | "voucher" | "rep" | null }) {
    if (!type) return null;

    if (type === "cost") {
        return (
            <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                background: "rgba(248,113,113,0.08)",
                border: "1px solid rgba(248,113,113,0.25)",
                borderRadius: "4px",
                padding: "10px 16px",
                marginTop: "36px",
            }}>
                <span style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "13px",
                    letterSpacing: "0.08em",
                    color: "#f87171",
                    fontWeight: 400,
                }}>€ 5.00</span>
                <span style={{
                    width: "1px",
                    height: "14px",
                    background: "rgba(248,113,113,0.2)",
                    flexShrink: 0,
                }} />
                <span style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "9px",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase" as const,
                    color: "rgba(248,113,113,0.5)",
                }}>failure cost</span>
            </div>
        );
    }

    if (type === "voucher") {
        return (
            <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                background: "rgba(251,146,60,0.08)",
                border: "1px solid rgba(251,146,60,0.25)",
                borderRadius: "4px",
                padding: "10px 16px",
                marginTop: "36px",
            }}>
                <span style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "#fb923c",
                    boxShadow: "0 0 6px rgba(251,146,60,0.6)",
                    flexShrink: 0,
                }} />
                <span style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "9px",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase" as const,
                    color: "#fb923c",
                }}>Awaiting Voucher</span>
            </div>
        );
    }

    if (type === "rep") {
        return (
            <div style={{ marginTop: "36px", width: "100%", maxWidth: "260px" }}>
                <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "10px",
                }}>
                    <span style={{
                        fontFamily: "'DM Mono', monospace",
                        fontSize: "9px",
                        letterSpacing: "0.16em",
                        textTransform: "uppercase" as const,
                        color: "#334155",
                    }}>Reputation</span>
                    <span style={{
                        fontFamily: "'DM Mono', monospace",
                        fontSize: "10px",
                        letterSpacing: "0.08em",
                        color: "#00d9ff",
                        filter: "drop-shadow(0 0 6px rgba(0,217,255,0.35))",
                    }}>714 / 1000</span>
                </div>
                <div style={{
                    height: "2px",
                    background: "#1e293b",
                    borderRadius: "1px",
                    overflow: "hidden",
                }}>
                    <div style={{
                        height: "100%",
                        width: "71.4%",
                        background: "linear-gradient(90deg, rgba(0,217,255,0.4) 0%, #00d9ff 100%)",
                        boxShadow: "0 0 8px rgba(0,217,255,0.5)",
                        borderRadius: "1px",
                    }} />
                </div>
                <div style={{ marginTop: "10px" }}>
                    <span style={{
                        fontFamily: "'DM Mono', monospace",
                        fontSize: "8px",
                        letterSpacing: "0.12em",
                        textTransform: "uppercase" as const,
                        color: "#34d399",
                        background: "rgba(52,211,153,0.08)",
                        border: "1px solid rgba(52,211,153,0.2)",
                        borderRadius: "3px",
                        padding: "3px 8px",
                    }}>Trusted</span>
                </div>
            </div>
        );
    }

    return null;
}

export function MobileOnboarding() {
    const router = useRouter();
    const [current, setCurrent] = useState(0);
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);

    useEffect(() => {
        try {
            if (localStorage.getItem("onboarding_seen")) {
                router.replace("/login");
            }
        } catch {}
    }, [router]);

    function complete() {
        try { localStorage.setItem("onboarding_seen", "1"); } catch {}
        router.push("/login");
    }

    function goNext() {
        if (current < SLIDES.length - 1) setCurrent(c => c + 1);
        else complete();
    }

    function goPrev() {
        if (current > 0) setCurrent(c => c - 1);
    }

    function onTouchStart(e: React.TouchEvent) {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
    }

    function onTouchEnd(e: React.TouchEvent) {
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        const dy = Math.abs(e.changedTouches[0].clientY - touchStartY.current);
        if (Math.abs(dx) > 60 && dy < Math.abs(dx) * 0.7) {
            if (dx < 0) goNext();
            else goPrev();
        }
    }

    const isLast = current === SLIDES.length - 1;

    return (
        <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            <link
                href="https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500;1,600&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&display=swap"
                rel="stylesheet"
            />

            <style>{`
                * { box-sizing: border-box; margin: 0; padding: 0; }
                html, body { background: #020617 !important; }

                .ob-fc { font-family: 'Cormorant', Georgia, serif; }
                .ob-fm { font-family: 'DM Mono', 'Courier New', monospace; }

                .ob-eyebrow {
                    font-family: 'DM Mono', monospace;
                    font-size: 9px;
                    letter-spacing: 0.22em;
                    text-transform: uppercase;
                    color: #00d9ff;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .ob-eyebrow::before {
                    content: '';
                    display: inline-block;
                    width: 20px;
                    height: 1px;
                    background: #00d9ff;
                    box-shadow: 0 0 6px rgba(0,217,255,0.35);
                    flex-shrink: 0;
                }

                .ob-btn {
                    display: block;
                    width: 100%;
                    background: #00d9ff;
                    color: #000;
                    padding: 18px 24px;
                    font-family: 'DM Mono', monospace;
                    font-size: 11px;
                    font-weight: 500;
                    letter-spacing: 0.18em;
                    text-transform: uppercase;
                    text-align: center;
                    border: none;
                    cursor: pointer;
                    box-shadow: 0 0 24px rgba(0,217,255,0.35);
                    transition: box-shadow 0.2s;
                    -webkit-tap-highlight-color: transparent;
                }
                .ob-btn:active {
                    box-shadow: 0 0 36px rgba(0,217,255,0.6);
                }

                .ob-skip {
                    position: absolute;
                    background: none;
                    border: none;
                    cursor: pointer;
                    font-family: 'DM Mono', monospace;
                    font-size: 10px;
                    letter-spacing: 0.18em;
                    text-transform: uppercase;
                    color: #334155;
                    padding: 8px;
                    z-index: 10;
                    transition: color 0.2s;
                    -webkit-tap-highlight-color: transparent;
                }
                .ob-skip:active { color: #94a3b8; }

                .ob-dot {
                    height: 6px;
                    border-radius: 3px;
                    border: none;
                    cursor: pointer;
                    padding: 0;
                    transition: width 0.3s cubic-bezier(0.25, 1, 0.5, 1), background 0.3s;
                    -webkit-tap-highlight-color: transparent;
                }

                body::after {
                    content: '';
                    position: fixed; inset: 0;
                    pointer-events: none; z-index: 9999; opacity: 0.02;
                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
                    background-size: 200px 200px;
                }
            `}</style>

            <div
                style={{
                    position: "fixed",
                    inset: 0,
                    overflow: "hidden",
                    background: "#020617",
                    color: "#f8fafc",
                }}
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
            >
                {/* Ambient radial glow */}
                <div style={{
                    position: "absolute",
                    top: "-120px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "500px",
                    height: "500px",
                    background: "radial-gradient(ellipse at center, rgba(0,217,255,0.06) 0%, transparent 70%)",
                    pointerEvents: "none",
                    zIndex: 0,
                }} />

                {/* Skip button */}
                {!isLast && (
                    <button
                        onClick={complete}
                        className="ob-skip"
                        style={{
                            top: "max(20px, env(safe-area-inset-top, 0px) + 16px)",
                            right: "20px",
                        }}
                    >
                        Skip
                    </button>
                )}

                {/* Slides track */}
                <div
                    style={{
                        display: "flex",
                        height: "100%",
                        transform: `translateX(-${current * 100}%)`,
                        transition: "transform 0.38s cubic-bezier(0.25, 1, 0.5, 1)",
                        willChange: "transform",
                    }}
                >
                    {SLIDES.map((slide, i) => (
                        <div
                            key={i}
                            style={{
                                flex: "0 0 100%",
                                height: "100%",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "center",
                                padding: "0 28px 148px",
                                paddingTop: "max(80px, env(safe-area-inset-top, 0px) + 60px)",
                                position: "relative",
                                overflowY: "auto",
                            }}
                        >
                            {/* Decorative slide number watermark */}
                            <div className="ob-fc" style={{
                                position: "absolute",
                                bottom: "140px",
                                right: "-10px",
                                fontSize: "180px",
                                fontWeight: 300,
                                color: "#0f172a",
                                lineHeight: 1,
                                letterSpacing: "-0.04em",
                                userSelect: "none",
                                pointerEvents: "none",
                                zIndex: 0,
                            }}>
                                {String(i + 1).padStart(2, "0")}
                            </div>

                            {/* Slide content */}
                            <div style={{ position: "relative", zIndex: 1 }}>
                                <div className="ob-eyebrow" style={{ marginBottom: "32px" }}>
                                    {slide.eyebrow}
                                </div>

                                <h2 className="ob-fc" style={{
                                    fontSize: "clamp(52px, 16vw, 72px)",
                                    fontWeight: 300,
                                    lineHeight: 0.92,
                                    letterSpacing: "-0.02em",
                                    color: "#f8fafc",
                                    marginBottom: "20px",
                                }}>
                                    {slide.headline.map((line, j) => (
                                        <span key={j}>{line}<br /></span>
                                    ))}
                                    <em style={{
                                        fontStyle: "italic",
                                        color: "#00d9ff",
                                        filter: "drop-shadow(0 0 10px rgba(0,217,255,0.35))",
                                        fontWeight: 400,
                                    }}>
                                        {slide.italic}
                                    </em>
                                </h2>

                                <p className="ob-fm" style={{
                                    fontSize: "13px",
                                    color: "#94a3b8",
                                    lineHeight: 1.8,
                                    fontWeight: 300,
                                    maxWidth: "320px",
                                }}>
                                    {slide.body}
                                </p>

                                <SlideVisual type={slide.visual} />
                            </div>
                        </div>
                    ))}
                </div>

                {/* Bottom bar — dots + button */}
                <div style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: `20px 28px`,
                    paddingBottom: "max(28px, env(safe-area-inset-bottom, 0px) + 20px)",
                    background: "linear-gradient(to top, rgba(2,6,23,1) 0%, rgba(2,6,23,0.95) 50%, transparent 100%)",
                    zIndex: 5,
                }}>
                    {/* Progress dots */}
                    <div style={{
                        display: "flex",
                        justifyContent: "center",
                        gap: "6px",
                        marginBottom: "20px",
                    }}>
                        {SLIDES.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => setCurrent(i)}
                                className="ob-dot"
                                style={{
                                    width: i === current ? "20px" : "6px",
                                    background: i === current ? "#00d9ff" : "#1e293b",
                                    boxShadow: i === current ? "0 0 8px rgba(0,217,255,0.5)" : "none",
                                }}
                                aria-label={`Go to slide ${i + 1}`}
                            />
                        ))}
                    </div>

                    {/* CTA button */}
                    <button onClick={goNext} className="ob-btn">
                        {isLast ? "Get Started" : "Next →"}
                    </button>
                </div>
            </div>
        </>
    );
}
