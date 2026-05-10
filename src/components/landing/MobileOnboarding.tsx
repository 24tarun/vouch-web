"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "tas_onboarding_done";

const slides = [
  {
    eyebrow: "Task Accountability System",
    headTop: "The cost of",
    headEm: "failure",
    headBot: "is real",
    body: "Not a to-do app. A commitment engine with skin in the game — money on the line, a friend to verify, real consequences.",
    badge: null,
  },
  {
    eyebrow: "The loop",
    headTop: "Commit.",
    headEm: "Vouch.",
    headBot: "Complete.",
    body: "Create a task with a deadline and a failure cost. Pick a friend as your voucher. They confirm — or deny — your work.",
    badge: { label: "AWAITING VOUCHER", cls: "amber" },
  },
  {
    eyebrow: "Real consequences",
    headTop: "Miss it.",
    headEm: "Pay up.",
    headBot: null,
    body: "Failure costs are logged to your ledger. Month-end, outstanding balances go to charity. No resets, no excuses.",
    badge: { label: "DENIED", cls: "red" },
  },
  {
    eyebrow: "Ready?",
    headTop: "Start holding",
    headEm: "yourself",
    headBot: "accountable.",
    body: null,
    badge: null,
    isCta: true,
  },
] as const;

export function MobileOnboarding() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const dragStartX = useRef(0);
  const isDragIntent = useRef<boolean | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const done = localStorage.getItem(STORAGE_KEY);
      if (!done) setVisible(true);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  }

  function goTo(i: number) {
    if (i < 0 || i >= slides.length) return;
    setIndex(i);
    setDragX(0);
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    dragStartX.current = e.touches[0].clientX;
    isDragIntent.current = null;
    setDragging(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);

    // Determine intent once per gesture
    if (isDragIntent.current === null) {
      if (Math.abs(dx) > 6 || dy > 6) {
        isDragIntent.current = Math.abs(dx) > dy;
      }
      return;
    }

    if (!isDragIntent.current) return; // vertical scroll — don't intercept

    e.preventDefault();
    const raw = e.touches[0].clientX - dragStartX.current;
    // Resist at edges
    const atStart = index === 0 && raw > 0;
    const atEnd = index === slides.length - 1 && raw < 0;
    const resistance = atStart || atEnd ? 0.25 : 1;
    setDragX(raw * resistance);
  }

  function onTouchEnd(e: React.TouchEvent) {
    setDragging(false);
    if (!isDragIntent.current) { setDragX(0); return; }
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    setDragX(0);
    if (dx < -60 && index < slides.length - 1) goTo(index + 1);
    else if (dx > 60 && index > 0) goTo(index - 1);
  }

  if (!visible) return null;

  const slide = slides[index];
  const badgeColors: Record<string, { color: string; bg: string; border: string }> = {
    amber:   { color: "#fbbf24", bg: "rgba(251,191,36,0.08)",   border: "rgba(251,191,36,0.4)"   },
    emerald: { color: "#34d399", bg: "rgba(52,211,153,0.08)",   border: "rgba(52,211,153,0.4)"   },
    red:     { color: "#f87171", bg: "rgba(248,113,113,0.08)",  border: "rgba(248,113,113,0.4)"  },
    cyan:    { color: "#22d3ee", bg: "rgba(34,211,238,0.08)",   border: "rgba(34,211,238,0.4)"   },
  };

  return (
    <>
      <style>{`
        .ob-fc { font-family: 'Cormorant', Georgia, serif; }
        .ob-fm { font-family: 'DM Mono', 'Courier New', monospace; }

        @keyframes ob-rise {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ob-rise  { animation: ob-rise 0.75s cubic-bezier(0.16,1,0.3,1) both; }
        .ob-d1    { animation-delay: 0.05s; }
        .ob-d2    { animation-delay: 0.15s; }
        .ob-d3    { animation-delay: 0.26s; }
        .ob-d4    { animation-delay: 0.38s; }

        @keyframes ob-fadein {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .ob-fadein { animation: ob-fadein 0.3s ease both; }

        .ob-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #334155;
          transition: background 0.3s, width 0.3s;
          flex-shrink: 0;
        }
        .ob-dot-active {
          width: 20px; border-radius: 3px;
          background: #00d9ff;
          box-shadow: 0 0 8px rgba(0,217,255,0.5);
        }

        .ob-btn-primary {
          display: block; width: 100%;
          background: #00d9ff; color: #000;
          padding: 18px 24px;
          font-family: 'DM Mono', monospace;
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.18em; text-transform: uppercase;
          text-decoration: none; text-align: center;
          border: none; cursor: pointer;
          box-shadow: 0 0 24px rgba(0,217,255,0.35);
          transition: box-shadow 0.2s;
          -webkit-tap-highlight-color: transparent;
        }
        .ob-btn-secondary {
          display: block; width: 100%;
          background: transparent; color: #94a3b8;
          padding: 16px 24px;
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.14em; text-transform: uppercase;
          text-decoration: none; text-align: center;
          border: 1px solid #334155; cursor: pointer;
          transition: border-color 0.2s, color 0.2s;
          -webkit-tap-highlight-color: transparent;
        }

        .ob-eyebrow {
          font-family: 'DM Mono', monospace;
          font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase;
          color: #00d9ff;
          display: flex; align-items: center; gap: 10px;
        }
        .ob-eyebrow::before {
          content: ''; display: inline-block;
          width: 20px; height: 1px;
          background: #00d9ff;
          box-shadow: 0 0 6px rgba(0,217,255,0.35);
          flex-shrink: 0;
        }

        .ob-skip {
          background: none; border: none; cursor: pointer;
          font-family: 'DM Mono', monospace;
          font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase;
          color: #334155;
          padding: 8px 0;
          transition: color 0.2s;
          -webkit-tap-highlight-color: transparent;
        }
        .ob-skip:hover { color: #94a3b8; }
      `}</style>

      {/* Full-screen overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#020617",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          touchAction: "pan-y",
          userSelect: "none",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >

        {/* Radial glow — anchored to slide, not UI chrome */}
        <div style={{
          position: "absolute",
          top: "-60px", left: "50%", transform: "translateX(-50%)",
          width: "500px", height: "500px",
          background: "radial-gradient(ellipse at center, rgba(0,217,255,0.05) 0%, transparent 65%)",
          pointerEvents: "none",
        }} />

        {/* Noise grain */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10, opacity: 0.02,
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: "200px 200px",
        }} />

        {/* Top bar: logo + skip */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "56px 24px 0",
          position: "relative", zIndex: 20,
        }}>
          <span className="ob-fm" style={{ fontSize: "10px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#1e293b" }}>
            TAS
          </span>
          {"isCta" in slide && slide.isCta ? (
            <div style={{ width: 32 }} />
          ) : (
            <button className="ob-skip" onClick={dismiss}>Skip</button>
          )}
        </div>

        {/* Slide content — draggable */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 28px",
            position: "relative", zIndex: 20,
            transform: `translateX(${dragX}px)`,
            transition: dragging ? "none" : "transform 0.35s cubic-bezier(0.25,1,0.5,1)",
          }}
        >

          {/* Eyebrow */}
          <div key={`ey-${index}`} className="ob-rise ob-d1 ob-eyebrow" style={{ marginBottom: "32px" }}>
            {slide.eyebrow}
          </div>

          {/* Headline */}
          <div key={`hd-${index}`} className="ob-rise ob-d2 ob-fc" style={{
            fontSize: "clamp(52px, 18vw, 72px)",
            fontWeight: 300,
            lineHeight: 0.9,
            letterSpacing: "-0.02em",
            color: "#f8fafc",
            marginBottom: "28px",
          }}>
            {slide.headTop}
            {"headEm" in slide && slide.headEm && (
              <>
                <br />
                <em style={{ fontStyle: "italic", color: "#00d9ff", fontWeight: 400, filter: "drop-shadow(0 0 12px rgba(0,217,255,0.35))" }}>
                  {slide.headEm}
                </em>
              </>
            )}
            {"headBot" in slide && slide.headBot && (
              <><br />{slide.headBot}</>
            )}
          </div>

          {/* Status badge */}
          {"badge" in slide && slide.badge && (() => {
            const c = badgeColors[slide.badge.cls];
            return (
              <div key={`bd-${index}`} className="ob-rise ob-d3" style={{ marginBottom: "20px" }}>
                <span className="ob-fm" style={{
                  fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
                  padding: "4px 10px", borderRadius: "3px",
                  border: `1px solid ${c.border}`,
                  background: c.bg,
                  color: c.color,
                  display: "inline-block",
                }}>
                  {slide.badge.label}
                </span>
              </div>
            );
          })()}

          {/* Body */}
          {"body" in slide && slide.body && (
            <p key={`bo-${index}`} className="ob-rise ob-d3 ob-fm" style={{
              fontSize: "13px", color: "#94a3b8", lineHeight: 1.8, fontWeight: 300,
            }}>
              {slide.body}
            </p>
          )}

          {/* CTA slide buttons */}
          {"isCta" in slide && slide.isCta && (
            <div key={`cta-${index}`} className="ob-rise ob-d3" style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
              <button
                className="ob-btn-primary"
                onClick={() => { dismiss(); router.push("/login?mode=signup"); }}
              >
                Begin Now
              </button>
              <button
                className="ob-btn-secondary"
                onClick={() => { dismiss(); router.push("/login"); }}
              >
                I have an account
              </button>
            </div>
          )}
        </div>

        {/* Bottom: dots + next hint */}
        {"isCta" in slide && slide.isCta ? null : (
          <div style={{
            padding: "0 28px 52px",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            position: "relative", zIndex: 20,
          }}>
            {/* Dots */}
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {slides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  style={{
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    display: "flex", alignItems: "center",
                  }}
                  aria-label={`Go to slide ${i + 1}`}
                >
                  <div className={`ob-dot${i === index ? " ob-dot-active" : ""}`} />
                </button>
              ))}
            </div>

            {/* Next arrow */}
            <button
              onClick={() => goTo(index + 1)}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: "8px",
                color: "#00d9ff",
                filter: "drop-shadow(0 0 8px rgba(0,217,255,0.35))",
                display: "flex", alignItems: "center",
                transition: "filter 0.2s",
                WebkitTapHighlightColor: "transparent",
              }}
              aria-label="Next slide"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}

      </div>
    </>
  );
}
