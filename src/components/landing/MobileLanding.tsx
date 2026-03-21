import Link from "next/link";
import { BuildStamp } from "@/components/BuildStamp";
import { Linkedin, Mail, Globe } from "lucide-react";

export function MobileLanding() {
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
          --border:       #1e293b;
          --border-hi:    #334155;
          --fg:           #f8fafc;
          --fg-dim:       #94a3b8;
          --fg-muted:     #334155;
          --cyan:         #00d9ff;
          --cyan-glow:    rgba(0, 217, 255, 0.35);
          --cyan-glow-hi: rgba(0, 217, 255, 0.6);
          --s-amber:      #fbbf24;
          --s-emerald:    #34d399;
          --s-red:        #f87171;
          --s-cyan:       #22d3ee;
          --s-orange:     #fb923c;
          --s-purple:     #c084fc;
          --s-blue:       #93c5fd;
        }

        .m-fc { font-family: 'Cormorant', Georgia, serif; }
        .m-fm { font-family: 'DM Mono', 'Courier New', monospace; }

        .m-badge {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 3px 7px;
          border-radius: 3px;
          border: 1px solid;
          display: inline-block;
          flex-shrink: 0;
        }
        .m-badge-amber   { color: var(--s-amber);   border-color: var(--s-amber);   background: rgba(251,191,36,0.08);  }
        .m-badge-emerald { color: var(--s-emerald); border-color: var(--s-emerald); background: rgba(52,211,153,0.08);  }
        .m-badge-red     { color: var(--s-red);     border-color: var(--s-red);     background: rgba(248,113,113,0.08); }
        .m-badge-cyan    { color: var(--s-cyan);    border-color: var(--s-cyan);    background: rgba(34,211,238,0.08);  }
        .m-badge-orange  { color: var(--s-orange);  border-color: var(--s-orange);  background: rgba(251,146,60,0.08);  }
        .m-badge-purple  { color: var(--s-purple);  border-color: var(--s-purple);  background: rgba(192,132,252,0.08); }
        .m-badge-blue    { color: var(--s-blue);    border-color: var(--s-blue);    background: rgba(147,197,253,0.08); }

        .m-eyebrow {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--cyan);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .m-eyebrow::before {
          content: '';
          display: inline-block;
          width: 20px;
          height: 1px;
          background: var(--cyan);
          box-shadow: 0 0 6px var(--cyan-glow);
          flex-shrink: 0;
        }

        .m-btn {
          display: block;
          width: 100%;
          background: var(--cyan);
          color: #000;
          padding: 18px 24px;
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          text-decoration: none;
          text-align: center;
          border: none;
          cursor: pointer;
          box-shadow: 0 0 24px var(--cyan-glow);
        }

        .m-feature-row {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          padding: 16px 0;
          border-bottom: 1px solid var(--border);
        }
        .m-feature-row:last-child { border-bottom: none; }

        body::after {
          content: '';
          position: fixed; inset: 0;
          pointer-events: none; z-index: 9999; opacity: 0.02;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          background-size: 200px 200px;
        }
      `}</style>

      <div style={{ background: "var(--bg)", color: "var(--fg)", minHeight: "100dvh" }}>

        {/* ─── HERO ─── */}
        <section style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "80px 24px 48px" }}>
          <div style={{ marginBottom: "32px" }}>
            <div className="m-eyebrow" style={{ marginBottom: "28px" }}>
              Task accountability
            </div>
            <h1 className="m-fc" style={{
              fontSize: "clamp(56px, 18vw, 80px)",
              fontWeight: 300,
              lineHeight: 0.9,
              letterSpacing: "-0.02em",
              color: "var(--fg)",
              marginBottom: "16px",
            }}>
              The cost<br />of{" "}
              <em style={{ fontStyle: "italic", color: "var(--cyan)", filter: "drop-shadow(0 0 12px var(--cyan-glow))" }}>
                failure
              </em>
              <br />is real.
            </h1>
          </div>

          <p className="m-fm" style={{ fontSize: "13px", color: "var(--fg-dim)", lineHeight: 1.8, marginBottom: "40px", fontWeight: 300 }}>
            Commit to tasks. Put money on the line. Let a friend verify. Miss it — pay up.
          </p>

          <Link href="/login" className="m-btn">
            Begin Now
          </Link>
        </section>

        {/* ─── HOW IT WORKS ─── */}
        <section style={{ borderTop: "1px solid var(--border)", padding: "56px 24px" }}>
          <div className="m-eyebrow" style={{ marginBottom: "20px" }}>How it works</div>
          <h2 className="m-fc" style={{ fontSize: "36px", fontWeight: 300, color: "var(--fg)", marginBottom: "32px", lineHeight: 1, letterSpacing: "-0.02em" }}>
            Six steps.<br />
            <em style={{ fontStyle: "italic", color: "var(--cyan)" }}>Real stakes.</em>
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
            {[
              { n: "01", title: "Commit",          badge: "CREATED",           cls: "m-badge-blue",    body: "Create a task with a deadline, failure cost, and a voucher to verify your work." },
              { n: "02", title: "Work",            badge: "ACTIVE",            cls: "m-badge-cyan",    body: "Use the built-in Pomodoro timer. Required focus sessions block submission until met." },
              { n: "03", title: "Submit",          badge: "AWAITING VOUCHER",  cls: "m-badge-orange",  body: "Mark complete before the deadline. Optionally upload proof. Enters your voucher's queue." },
              { n: "04", title: "Review",          badge: "PENDING REVIEW",    cls: "m-badge-amber",   body: "Voucher has ~2 days to accept or deny. No response → auto-accepted, 30¢ penalty on them." },
              { n: "05", title: "Outcome",         badge: "COMPLETED / FAILED", cls: "m-badge-emerald", body: "Accept → cleared. Deny → failure cost logged to your ledger. Rectify within 7 days." },
              { n: "06", title: "Settle",          badge: "SETTLED",           cls: "m-badge-purple",  body: "Month-end summary email. Outstanding balances go to a charity of your choice." },
            ].map(({ n, title, badge, cls, body }) => (
              <div key={n} style={{ padding: "20px 0", borderBottom: "1px solid var(--border)", display: "flex", gap: "16px", alignItems: "flex-start" }}>
                <span className="m-fc" style={{ fontSize: "28px", fontWeight: 300, color: "var(--border-hi)", lineHeight: 1, flexShrink: 0, width: "36px" }}>{n}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span className="m-fc" style={{ fontSize: "18px", fontWeight: 500, color: "var(--fg)" }}>{title}</span>
                    <span className={`m-badge ${cls}`} style={{ fontSize: "8px" }}>{badge}</span>
                  </div>
                  <p className="m-fm" style={{ fontSize: "11px", color: "var(--fg-dim)", lineHeight: 1.7, fontWeight: 300 }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── FEATURES ─── */}
        <section style={{ borderTop: "1px solid var(--border)", background: "var(--surface)", padding: "56px 24px" }}>
          <div className="m-eyebrow" style={{ marginBottom: "20px" }}>Features</div>
          <h2 className="m-fc" style={{ fontSize: "36px", fontWeight: 300, color: "var(--fg)", marginBottom: "32px", lineHeight: 1, letterSpacing: "-0.02em" }}>
            Everything you<br />
            <em style={{ fontStyle: "italic", color: "var(--cyan)" }}>need to commit.</em>
          </h2>

          <div>
            {[
              { badge: "m-badge-cyan",    label: "AI Voucher",       desc: "No friend available? AI reviews your proof. Three strikes and you're out." },
              { badge: "m-badge-purple",  label: "Recurring Tasks",  desc: "Daily, weekly, monthly recurrence. Background job generates each instance on schedule." },
              { badge: "m-badge-amber",   label: "Pomodoro Timer",   desc: "VFD-style seven-segment timer. Set required focus minutes — can't submit until you've put in the time." },
              { badge: "m-badge-emerald", label: "Commitments",      desc: "Group tasks into campaign windows. Track streak pass/fail on a day-status grid." },
              { badge: "m-badge-blue",    label: "Reputation",       desc: "Every task, session, and review feeds a live 0–1000 score. Builds trust over time." },
              { badge: "m-badge-red",     label: "Financial Ledger", desc: "Every failure is permanent. Month-end settlement goes to charity. Real consequences." },
              { badge: "m-badge-orange",  label: "Proof Upload",     desc: "Photo or video evidence. Voucher can request it. Private signed URLs, auto-cleaned up." },
              { badge: "m-badge-purple",  label: "Google Calendar",  desc: "Bidirectional OAuth sync. Tasks as events, calendar events as tasks." },
              { badge: "m-badge-cyan",    label: "Realtime Sync",    desc: "Supabase Realtime — state changes appear on all your devices within seconds." },
            ].map(({ badge, label, desc }) => (
              <div key={label} className="m-feature-row">
                <span className={`m-badge ${badge}`} style={{ marginTop: "2px" }}>{label}</span>
                <span className="m-fm" style={{ fontSize: "11px", color: "var(--fg-dim)", lineHeight: 1.6, fontWeight: 300 }}>{desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ─── REPUTATION TIERS ─── */}
        <section style={{ borderTop: "1px solid var(--border)", padding: "56px 24px" }}>
          <div className="m-eyebrow" style={{ marginBottom: "20px" }}>Reputation</div>
          <h2 className="m-fc" style={{ fontSize: "36px", fontWeight: 300, color: "var(--fg)", marginBottom: "12px", lineHeight: 1, letterSpacing: "-0.02em" }}>
            Scored 0–1000.
          </h2>
          <p className="m-fm" style={{ fontSize: "11px", color: "var(--fg-dim)", lineHeight: 1.7, marginBottom: "28px", fontWeight: 300 }}>
            Deliver consistently, your score climbs. Miss tasks, it drops. Vouching for others earns you points too.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {[
              { label: "Legendary",  score: "900+", cls: "m-badge-cyan"    },
              { label: "Elite",      score: "800+", cls: "m-badge-purple"  },
              { label: "Trusted",    score: "700+", cls: "m-badge-emerald" },
              { label: "Solid",      score: "600+", cls: "m-badge-blue"    },
              { label: "Rising",     score: "500+", cls: "m-badge-amber"   },
              { label: "New Here",   score: "400+", cls: "m-badge-orange"  },
              { label: "Shaky",      score: "300+", cls: "m-badge-red"     },
              { label: "Struggling", score: "200+", cls: "m-badge-red"     },
              { label: "Unreliable", score: "0+",   cls: "m-badge-red"     },
            ].map(({ label, score, cls }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span className={`m-badge ${cls}`}>{label}</span>
                <span className="m-fm" style={{ fontSize: "9px", color: "var(--fg-muted)" }}>{score}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ─── BOTTOM CTA ─── */}
        <section style={{ borderTop: "1px solid var(--border)", background: "var(--surface)", padding: "56px 24px" }}>
          <h2 className="m-fc" style={{ fontSize: "40px", fontWeight: 300, color: "var(--fg)", marginBottom: "16px", lineHeight: 1, letterSpacing: "-0.02em" }}>
            Ready to<br />
            <em style={{ fontStyle: "italic", color: "var(--cyan)" }}>start?</em>
          </h2>
          <p className="m-fm" style={{ fontSize: "11px", color: "var(--fg-dim)", lineHeight: 1.7, marginBottom: "28px", fontWeight: 300 }}>
            No credit card required to start. Put real stakes on your first task in under a minute.
          </p>
          <Link href="/login" className="m-btn">
            Begin Now
          </Link>
        </section>

        {/* ─── FOOTER ─── */}
        <footer style={{ borderTop: "1px solid var(--border)", padding: "28px 24px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <span className="m-fm" style={{ fontSize: "10px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--fg-dim)" }}>
              Task Accountability System by{" "}
              <span style={{ color: "var(--fg)", fontWeight: 500 }}>Tarun Hariharan</span>
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
              <a href="mailto:tarun2k01@gmail.com" aria-label="Email" style={{ color: "var(--fg-muted)", display: "inline-flex" }}>
                <Mail size={20} />
              </a>
              <a href="https://www.linkedin.com/in/tarun2k01" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" style={{ color: "var(--fg-muted)", display: "inline-flex" }}>
                <Linkedin size={20} />
              </a>
              <a href="https://tarunh.com" target="_blank" rel="noopener noreferrer" aria-label="Personal Website" style={{ color: "var(--fg-muted)", display: "inline-flex" }}>
                <Globe size={20} />
              </a>
            </div>
            <BuildStamp />
          </div>
        </footer>

      </div>
    </>
  );
}
