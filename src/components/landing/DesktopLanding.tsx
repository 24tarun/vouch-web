import { BetaAccessForm } from "@/components/landing/BetaAccessForm";
import { Button3DLink } from "@/components/ui/Button3D";
import { ContactInfo } from "@/components/landing/ContactInfo";
import { TrafficLight } from "@/components/landing/TrafficLight";
import { Camera, Bot, Timer, ReceiptText } from "lucide-react";

export function DesktopLanding() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500;1,600&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&display=swap"
        rel="stylesheet"
      />

      <style>{`
        /* ── App palette (slate-950/900/800 — matches dashboard) */
        :root {
          --bg:           #020617;   /* slate-950 */
          --surface:      #0f172a;   /* slate-900 */
          --card:         #1e293b;   /* slate-800 */
          --border:       #1e293b;   /* slate-800 */
          --border-hi:    #334155;   /* slate-700 */
          --fg:           #f8fafc;   /* slate-50  */
          --fg-dim:       #94a3b8;   /* slate-400 */
          --fg-muted:     #334155;   /* slate-700 */

          /* App's cyan accent (seven-seg display / pomodoro) */
          --cyan:         #00d9ff;
          --cyan-glow:    rgba(0, 217, 255, 0.35);
          --cyan-glow-hi: rgba(0, 217, 255, 0.6);

          /* Solarized status palette (from TaskRow / CommitmentCard) */
          --s-amber:      #fbbf24;
          --s-emerald:    #34d399;
          --s-red:        #f87171;
          --s-cyan:       #22d3ee;
          --s-orange:     #fb923c;
          --s-purple:     #c084fc;
          --s-blue:       #93c5fd;
        }

        .fc  { font-family: 'Cormorant', Georgia, serif; }
        .fm  { font-family: 'DM Mono', 'Courier New', monospace; }

        @keyframes riseUp {
          from { opacity: 0; transform: translateY(28px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .rise { animation: riseUp 0.9s cubic-bezier(0.16,1,0.3,1) both; }
        .d1   { animation-delay: 0.12s; }
        .d2   { animation-delay: 0.24s; }
        .d3   { animation-delay: 0.36s; }
        .d4   { animation-delay: 0.50s; }
        .d5   { animation-delay: 0.64s; }

        /* ── Glow helpers ──────────────────────────────── */
        .cyan-glow  { filter: drop-shadow(0 0 10px var(--cyan-glow)); }
        .text-cyan  { color: var(--cyan); }

        /* ── Buttons ───────────────────────────────────── */
        .btn-solid {
          display: inline-block;
          background: var(--cyan);
          color: #000;
          padding: 13px 32px;
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          text-decoration: none;
          border: none;
          cursor: pointer;
          transition: box-shadow 0.2s, transform 0.2s;
          box-shadow: 0 0 18px var(--cyan-glow);
        }
        .btn-solid:hover {
          box-shadow: 0 0 28px var(--cyan-glow-hi);
          transform: translateY(-2px);
        }
        .btn-outline {
          display: inline-block;
          background: transparent;
          color: var(--fg-dim);
          padding: 13px 28px;
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          font-weight: 400;
          letter-spacing: 0.08em;
          text-decoration: none;
          border: 1px solid var(--border-hi);
          cursor: pointer;
          transition: color 0.2s, border-color 0.2s;
        }
        .btn-outline:hover {
          color: var(--fg);
          border-color: var(--cyan);
        }

        /* ── Eyebrow label ─────────────────────────────── */

        /* ── Status badges ─────────────────────────────── */
        .badge {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          padding: 3px 8px;
          border-radius: 3px;
          border: 1px solid;
          display: inline-block;
        }
        .badge-amber   { color: var(--s-amber);   border-color: var(--s-amber);   background: rgba(251,191,36,0.08);  }
        .badge-emerald { color: var(--s-emerald); border-color: var(--s-emerald); background: rgba(52,211,153,0.08);  }
        .badge-red     { color: var(--s-red);     border-color: var(--s-red);     background: rgba(248,113,113,0.08); }
        .badge-cyan    { color: var(--s-cyan);    border-color: var(--s-cyan);    background: rgba(34,211,238,0.08);  }
        .badge-orange  { color: var(--s-orange);  border-color: var(--s-orange);  background: rgba(251,146,60,0.08);  }
        .badge-purple  { color: var(--s-purple);  border-color: var(--s-purple);  background: rgba(192,132,252,0.08); }

        /* ── Cards ─────────────────────────────────────── */
        .step-card { transition: background 0.3s, border-color 0.3s; }
        .step-card:hover { background: #0f172a !important; border-color: var(--border-hi) !important; }
        .step-card:hover .step-num { color: var(--cyan) !important; filter: drop-shadow(0 0 8px var(--cyan-glow)); }
        .step-num { transition: color 0.3s, filter 0.3s; }

        .feat-item { transition: border-color 0.3s; }
        .feat-item:hover { border-color: var(--cyan) !important; }
        .feat-item:hover .feat-title { color: var(--fg) !important; }

        /* ── Stack table ───────────────────────────────── */
        .stack-row { transition: background 0.2s; }
        .stack-row:hover { background: #0f172a !important; }

        /* ── Footer icons ──────────────────────────────── */
        .icon-link { color: var(--fg-muted); transition: color 0.2s, filter 0.2s; display: inline-flex; }
        .icon-link:hover { color: var(--cyan); filter: drop-shadow(0 0 6px var(--cyan-glow)); }

        /* ── Noise grain overlay ───────────────────────── */
        body::after {
          content: '';
          position: fixed; inset: 0;
          pointer-events: none; z-index: 9999; opacity: 0.02;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          background-size: 200px 200px;
        }

        /* ── Subtle radial hero glow ───────────────────── */
        .hero-glow {
          position: absolute;
          top: -200px; left: 50%;
          transform: translateX(-50%);
          width: 900px; height: 600px;
          background: radial-gradient(ellipse at center, rgba(0,217,255,0.06) 0%, transparent 70%);
          pointer-events: none;
        }

        .feature-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 54px 72px;
        }

        .feature-item {
          border-top: 1px solid var(--border);
          padding-top: 20px;
        }

        .feature-title {
          font-family: 'DM Mono', monospace;
          font-size: clamp(24px, 2vw, 40px);
          letter-spacing: 0.08em;
          line-height: 1.05;
          color: var(--fg);
          margin: 0 0 12px;
          text-transform: uppercase;
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .feature-copy {
          font-family: 'DM Mono', monospace;
          font-size: clamp(16px, 1.1vw, 22px);
          font-weight: 300;
          line-height: 1.5;
          color: var(--fg-dim);
          margin: 0;
        }

        @media (max-width: 980px) {
          .feature-grid { grid-template-columns: 1fr; gap: 34px; }
        }
      `}</style>

      <div style={{ background: "var(--bg)", color: "var(--fg)", minHeight: "100vh" }}>

        {/* ─── HERO ─── */}
        <section style={{ position: "relative", overflow: "hidden", minHeight: "100dvh", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "56px 2.5rem 80px", textAlign: "center" }}>
          <div className="hero-glow" />
          <div style={{ maxWidth: "1280px", margin: "0 auto", width: "100%", position: "relative", paddingTop: "42px" }}>
            <div
              className="rise"
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                paddingRight: "clamp(8px, 1.2vw, 20px)",
              }}
            >
              <TrafficLight />
            </div>

            <h1 className="rise d1 fc" style={{
              fontSize: "clamp(40px, 7vw, 86px)",
              fontWeight: 300,
              lineHeight: 0.88,
              letterSpacing: "-0.02em",
              marginBottom: "36px",
              color: "var(--fg)",
            }}>
              Vouch is a social<br />
              <em className="cyan-glow" style={{ fontStyle: "italic", color: "var(--cyan)", fontWeight: 400 }}>
                to-do list experiment
              </em>
            </h1>

            <div className="rise d2" style={{ display: "flex", justifyContent: "center" }}>
              <Button3DLink
                href="/login"
                variant="cyan"
                height={48}
                width="auto"
                style={{ minWidth: "240px", padding: "0 26px", fontSize: "11px", letterSpacing: "0.14em" }}
              >
                Begin Now
              </Button3DLink>
            </div>

            <p className="rise d3 fm" style={{ marginTop: "16px", fontSize: "12px", letterSpacing: "0.04em", color: "var(--fg-dim)" }}>
              The website works....functionally but cosmetically its a long way
            </p>
          </div>
        </section>
        <section
          style={{
            padding: "120px 2.5rem 140px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <div style={{ width: "100%", maxWidth: "1280px", margin: "0 auto" }}>
            <div className="feature-grid">
              <div className="feature-item rise d1">
                <h3 className="feature-title">
                  <Camera size={30} color="#f472b6" />
                  Social Verification + Proof
                </h3>
                <p className="feature-copy">Ask a friend to verify the task, with photo or video proof when needed</p>
              </div>
              <div className="feature-item rise d2">
                <h3 className="feature-title">
                  <Bot size={30} color="#a78bfa" />
                  AI Voucher
                </h3>
                <p className="feature-copy">For the awkward tasks like “clean toilet” 😂</p>
              </div>
              <div className="feature-item rise d3">
                <h3 className="feature-title">
                  <Timer size={30} color="#22d3ee" />
                  Pomodoro Timer
                </h3>
                <p className="feature-copy">Stay locked in with simple focus sessions</p>
              </div>
              <div className="feature-item rise d4">
                <h3 className="feature-title">
                  <ReceiptText size={30} color="#f87171" />
                  Failure-Cost Ledger
                </h3>
                <p className="feature-copy">Missed tasks are tracked with the cost you agreed to</p>
              </div>
            </div>
          </div>
        </section>
        <section
          style={{
            minHeight: "100dvh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "80px 2.5rem",
            borderTop: "1px solid var(--border)",
          }}
        >
          <div className="rise d3" style={{ width: "100%", maxWidth: "1280px", margin: "0 auto" }}>
            <BetaAccessForm />
          </div>
        </section>
        <section
          style={{
            padding: "18px 2.5rem 110px",
          }}
        >
          <div style={{ width: "100%", maxWidth: "1280px", margin: "0 auto" }}>
            <ContactInfo />
          </div>
        </section>

      </div>
    </>
  );
}
