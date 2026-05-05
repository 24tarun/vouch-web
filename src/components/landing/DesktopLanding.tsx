import Link from "next/link";
import { BuildStamp } from "@/components/BuildStamp";
import { Linkedin, Mail, Globe } from "lucide-react";

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
        .eyebrow {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--cyan);
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .eyebrow::before {
          content: '';
          display: inline-block;
          width: 32px;
          height: 1px;
          background: var(--cyan);
          box-shadow: 0 0 6px var(--cyan-glow);
          flex-shrink: 0;
        }

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
      `}</style>

      <div style={{ background: "var(--bg)", color: "var(--fg)", minHeight: "100vh" }}>

        {/* ─── HERO ─── */}
        <section style={{ position: "relative", overflow: "hidden", minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 2.5rem", textAlign: "center" }}>
          <div className="hero-glow" />
          <div style={{ maxWidth: "1280px", margin: "0 auto", width: "100%", position: "relative" }}>

            <div className="rise eyebrow" style={{ marginBottom: "56px", justifyContent: "center" }}>
              Start holding yourself accountable
            </div>

            <h1 className="rise d1 fc" style={{
              fontSize: "clamp(72px, 13vw, 172px)",
              fontWeight: 300,
              lineHeight: 0.88,
              letterSpacing: "-0.02em",
              marginBottom: "72px",
              color: "var(--fg)",
            }}>
              The cost of<br />
              <em className="cyan-glow" style={{ fontStyle: "italic", color: "var(--cyan)", fontWeight: 400 }}>
                failure is real.
              </em>
            </h1>

            <div className="rise d2" style={{ display: "flex", justifyContent: "center" }}>
              <Link href="/login" className="btn-solid" style={{ fontSize: "13px", padding: "20px 120px", letterSpacing: "0.18em" }}>
                Begin Now
              </Link>
            </div>

          </div>
        </section>

        {/* ─── TASK LIFECYCLE ─── */}
        <section style={{ borderTop: "1px solid var(--border)", padding: "100px 2.5rem" }}>
          <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
            <div className="eyebrow" style={{ marginBottom: "24px" }}>Task Lifecycle</div>
            <h2 className="fc" style={{ fontSize: "clamp(36px, 5vw, 64px)", fontWeight: 300, color: "var(--fg)", marginBottom: "16px", letterSpacing: "-0.02em" }}>
              Every task has a state.<br />
              <em style={{ fontStyle: "italic", color: "var(--cyan)" }}>Every state has a consequence.</em>
            </h2>
            <p className="fm" style={{ fontSize: "13px", color: "var(--fg-dim)", maxWidth: "560px", lineHeight: 1.8, marginBottom: "64px", fontWeight: 300 }}>
              Tasks move through a strict lifecycle enforced server-side. Miss a deadline and the system fails you automatically — no manual intervention needed.
            </p>

            {/* Flow diagram */}
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "48px" }}>
              {[
                { label: "ACTIVE",           cls: "badge-blue"    },
                { arrow: true },
                { label: "POSTPONED",        cls: "badge-amber",  note: "once" },
                { arrow: true },
                { label: "AWAITING VOUCHER", cls: "badge-orange"  },
                { arrow: true },
                { label: "ACCEPTED",         cls: "badge-emerald" },
                { slash: true },
                { label: "DENIED",           cls: "badge-red"     },
                { arrow: true },
                { label: "RECTIFIED",        cls: "badge-purple",  note: "≤5/mo" },
              ].map((item, i) => {
                if ("arrow" in item) return <span key={i} className="fm" style={{ color: "var(--border-hi)", fontSize: "16px" }}>→</span>;
                if ("slash" in item) return <span key={i} className="fm" style={{ color: "var(--border-hi)", fontSize: "16px", margin: "0 4px" }}>/</span>;
                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                    <span className={`badge ${"cls" in item ? item.cls : ""}`} style={{ fontSize: "10px" }}>{item.label}</span>
                    {"note" in item && <span className="fm" style={{ fontSize: "9px", color: "var(--fg-muted)", letterSpacing: "0.08em" }}>{item.note}</span>}
                  </div>
                );
              })}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1px", background: "var(--border)" }}>
              {[
                { n: "01", title: "Commit",           badge: "ACTIVE",           cls: "badge-blue",    body: "Create a task with a title, deadline, failure cost (EUR/USD/INR), voucher, and optional subtasks, reminders, and pomodoro requirement. NLP tokens let you set all of this inline." },
                { n: "02", title: "Work",             badge: "ACTIVE",           cls: "badge-cyan",    body: "Use the built-in Pomodoro timer to log focus sessions. Set required pomo minutes on the task — completion is blocked until they're met." },
                { n: "03", title: "Submit",           badge: "AWAITING VOUCHER", cls: "badge-orange",  body: "Mark the task complete before the deadline. Optionally upload image or video proof. The task enters the voucher's review queue." },
                { n: "04", title: "Voucher Reviews",  badge: "PENDING REVIEW",   cls: "badge-amber",   body: "Your voucher has ~2 days to accept or deny. They can request proof at any time. If they don't respond, the system auto-accepts and charges them 30¢." },
                { n: "05", title: "Outcome",          badge: "ACCEPTED / DENIED", cls: "badge-emerald", body: "Accept → ACCEPTED, costs cleared. Deny → DENIED, failure cost logged to your monthly ledger. Voucher can rectify a failure within 7 days (max 5/month)." },
                { n: "06", title: "Settle",           badge: "SETTLED",          cls: "badge-purple",  body: "At month-end a settlement email summarises your ledger. Outstanding balances go to a charity of your choice — automated payment coming soon." },
              ].map(({ n, title, badge, cls, body }) => (
                <div key={n} className="step-card" style={{ background: "var(--bg)", padding: "40px 36px", border: "1px solid transparent" }}>
                  <div className="step-num fc" style={{ fontSize: "64px", fontWeight: 300, color: "var(--border)", lineHeight: 1, marginBottom: "20px" }}>{n}</div>
                  <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
                    <h3 className="fc" style={{ fontSize: "24px", fontWeight: 500, color: "var(--fg)" }}>{title}</h3>
                    <span className={`badge ${cls}`} style={{ fontSize: "9px" }}>{badge}</span>
                  </div>
                  <p className="fm" style={{ fontSize: "12px", lineHeight: 1.85, color: "var(--fg-dim)", fontWeight: 300 }}>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── VFD POMODORO ─── */}
        <section style={{ borderTop: "1px solid var(--border)", background: "var(--surface)", padding: "100px 2.5rem" }}>
          <div style={{ maxWidth: "1280px", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "80px", alignItems: "center" }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: "32px" }}>Focus System</div>
              <h2 className="fc" style={{ fontSize: "clamp(36px, 4vw, 56px)", fontWeight: 300, color: "var(--fg)", marginBottom: "24px", lineHeight: 1, letterSpacing: "-0.02em" }}>
                VFD Pomodoro<br />
                <em style={{ fontStyle: "italic", color: "var(--cyan)" }}>Timer</em>
              </h2>
              <p className="fm" style={{ fontSize: "13px", color: "var(--fg-dim)", lineHeight: 1.85, marginBottom: "32px", fontWeight: 300 }}>
                A vacuum fluorescent display-inspired seven-segment clock built into every task. Sessions are logged against the task. Set a required pomo count — the task won't let you submit until you've put in the time.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  { badge: "badge-cyan",    label: "Completed Sessions", desc: "Only completed timers are counted and logged to the task." },
                  { badge: "badge-emerald", label: "Session Logging",    desc: "Every completed session is logged to the task and contributes to your RP." },
                  { badge: "badge-amber",   label: "Required Minutes",   desc: "Set minimum pomo minutes per task via the `pomo N` token at creation." },
                  { badge: "badge-purple",  label: "Auto-end",           desc: "Background job ends abandoned sessions automatically." },
                ].map(({ badge, label, desc }) => (
                  <div key={label} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <span className={`badge ${badge}`} style={{ fontSize: "9px", flexShrink: 0, marginTop: "2px" }}>{label}</span>
                    <span className="fm" style={{ fontSize: "12px", color: "var(--fg-dim)", lineHeight: 1.7, fontWeight: 300 }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Screenshot placeholder */}
            <div style={{ border: "1px dashed rgba(0,217,255,0.25)", background: "rgba(0,217,255,0.02)", aspectRatio: "4/3", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px" }}>
              <div style={{ width: "36px", height: "36px", border: "1px dashed rgba(0,217,255,0.3)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "rgba(0,217,255,0.4)", fontSize: "20px", lineHeight: 1 }}>+</span>
              </div>
              <span className="fm" style={{ fontSize: "10px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,217,255,0.3)" }}>Pomodoro timer screenshot</span>
            </div>
          </div>
        </section>

        {/* ─── PROOF SUBMISSION ─── */}
        <section style={{ borderTop: "1px solid var(--border)", padding: "100px 2.5rem" }}>
          <div style={{ maxWidth: "1280px", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "80px", alignItems: "center" }}>
            {/* Screenshot placeholder */}
            <div style={{ border: "1px dashed rgba(0,217,255,0.25)", background: "rgba(0,217,255,0.02)", aspectRatio: "4/3", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px" }}>
              <div style={{ width: "36px", height: "36px", border: "1px dashed rgba(0,217,255,0.3)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "rgba(0,217,255,0.4)", fontSize: "20px", lineHeight: 1 }}>+</span>
              </div>
              <span className="fm" style={{ fontSize: "10px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,217,255,0.3)" }}>Proof submission screenshot</span>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: "32px" }}>Evidence</div>
              <h2 className="fc" style={{ fontSize: "clamp(36px, 4vw, 56px)", fontWeight: 300, color: "var(--fg)", marginBottom: "24px", lineHeight: 1, letterSpacing: "-0.02em" }}>
                Proof of<br />
                <em style={{ fontStyle: "italic", color: "var(--cyan)" }}>completion.</em>
              </h2>
              <p className="fm" style={{ fontSize: "13px", color: "var(--fg-dim)", lineHeight: 1.85, marginBottom: "32px", fontWeight: 300 }}>
                When you mark a task complete, you can upload image or video proof directly in the app. Your voucher sees it in their review queue. Proofs are private, stored securely, and cleaned up automatically after the task resolves.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  { badge: "badge-cyan",    label: "Image + Video",     desc: "Upload photos or screen recordings as evidence of your work." },
                  { badge: "badge-amber",   label: "Voucher Request",   desc: "Your voucher can request proof at any point during their review window." },
                  { badge: "badge-red",     label: "Required Proof",    desc: "Tag a task with `-proof` at creation to make evidence mandatory." },
                  { badge: "badge-emerald", label: "Private Storage",   desc: "Proofs are served via signed URLs — only visible to owner and voucher." },
                ].map(({ badge, label, desc }) => (
                  <div key={label} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <span className={`badge ${badge}`} style={{ fontSize: "9px", flexShrink: 0, marginTop: "2px" }}>{label}</span>
                    <span className="fm" style={{ fontSize: "12px", color: "var(--fg-dim)", lineHeight: 1.7, fontWeight: 300 }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── AI VOUCHER ─── */}
        <section style={{ borderTop: "1px solid var(--border)", background: "var(--surface)", padding: "100px 2.5rem" }}>
          <div style={{ maxWidth: "1280px", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "80px", alignItems: "center" }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: "32px" }}>AI Voucher</div>
              <h2 className="fc" style={{ fontSize: "clamp(36px, 4vw, 56px)", fontWeight: 300, color: "var(--fg)", marginBottom: "24px", lineHeight: 1, letterSpacing: "-0.02em" }}>
                Vouched by<br />
                <em style={{ fontStyle: "italic", color: "var(--cyan)" }}>AI when needed.</em>
              </h2>
              <p className="fm" style={{ fontSize: "13px", color: "var(--fg-dim)", lineHeight: 1.85, marginBottom: "32px", fontWeight: 300 }}>
                Don&apos;t have a friend available? Assign an AI voucher. It reviews your submitted proof and makes a verdict. If it denies you, you can resubmit — but only three times. On the third denial, you fail and pay. Or escalate to a human at any stage.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  { badge: "badge-cyan",    label: "AI Review",          desc: "Proof is analysed and accepted or denied with a reason." },
                  { badge: "badge-amber",   label: "3 Resubmits",        desc: "Each denial lets you resubmit improved proof up to three times." },
                  { badge: "badge-red",     label: "Final Denial → FAILED", desc: "Third denial is final. Failure cost is charged to your ledger." },
                  { badge: "badge-purple",  label: "Escalate to Human",  desc: "At any resubmit stage, switch to a human voucher instead." },
                  { badge: "badge-orange",  label: "Denial History",     desc: "All AI denial reasons are stored and visible for context on resubmit." },
                ].map(({ badge, label, desc }) => (
                  <div key={label} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <span className={`badge ${badge}`} style={{ fontSize: "9px", flexShrink: 0, marginTop: "2px" }}>{label}</span>
                    <span className="fm" style={{ fontSize: "12px", color: "var(--fg-dim)", lineHeight: 1.7, fontWeight: 300 }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Screenshot placeholder */}
            <div style={{ border: "1px dashed rgba(0,217,255,0.25)", background: "rgba(0,217,255,0.02)", aspectRatio: "4/3", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px" }}>
              <div style={{ width: "36px", height: "36px", border: "1px dashed rgba(0,217,255,0.3)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "rgba(0,217,255,0.4)", fontSize: "20px", lineHeight: 1 }}>+</span>
              </div>
              <span className="fm" style={{ fontSize: "10px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,217,255,0.3)" }}>AI voucher screenshot</span>
            </div>
          </div>
        </section>

        {/* ─── FRIEND SYSTEM ─── */}
        <section style={{ borderTop: "1px solid var(--border)", padding: "100px 2.5rem" }}>
          <div style={{ maxWidth: "1280px", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "80px", alignItems: "center" }}>
            {/* Screenshot placeholder */}
            <div style={{ border: "1px dashed rgba(0,217,255,0.25)", background: "rgba(0,217,255,0.02)", aspectRatio: "4/3", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px" }}>
              <div style={{ width: "36px", height: "36px", border: "1px dashed rgba(0,217,255,0.3)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "rgba(0,217,255,0.4)", fontSize: "20px", lineHeight: 1 }}>+</span>
              </div>
              <span className="fm" style={{ fontSize: "10px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,217,255,0.3)" }}>Friends & voucher queue screenshot</span>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: "32px" }}>Social Graph</div>
              <h2 className="fc" style={{ fontSize: "clamp(36px, 4vw, 56px)", fontWeight: 300, color: "var(--fg)", marginBottom: "24px", lineHeight: 1, letterSpacing: "-0.02em" }}>
                Friends who<br />
                <em style={{ fontStyle: "italic", color: "var(--cyan)" }}>hold you accountable.</em>
              </h2>
              <p className="fm" style={{ fontSize: "13px", color: "var(--fg-dim)", lineHeight: 1.85, marginBottom: "32px", fontWeight: 300 }}>
                Build a network of people who trust each other enough to verify work. Symmetric friendships mean both sides opt in. Your voucher queue shows every task waiting on your review — and the clock is ticking.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  { badge: "badge-cyan",    label: "Symmetric Friendships", desc: "Both users must confirm before appearing as a selectable voucher." },
                  { badge: "badge-blue",    label: "Friend Activity Feed",  desc: "See your friends' task completions and failures in real time." },
                  { badge: "badge-amber",   label: "Voucher Queue",         desc: "A dedicated page shows every task you've been assigned to review." },
                  { badge: "badge-purple",  label: "Visibility Controls",   desc: "Toggle whether your voucher can view your active tasks before completion." },
                  { badge: "badge-orange",  label: "Voucher Penalty",       desc: "Vouchers who ignore reviews are auto-charged 30¢ when the timeout fires." },
                ].map(({ badge, label, desc }) => (
                  <div key={label} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <span className={`badge ${badge}`} style={{ fontSize: "9px", flexShrink: 0, marginTop: "2px" }}>{label}</span>
                    <span className="fm" style={{ fontSize: "12px", color: "var(--fg-dim)", lineHeight: 1.7, fontWeight: 300 }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── COMMITMENTS ─── */}
        <section style={{ borderTop: "1px solid var(--border)", background: "var(--surface)", padding: "100px 2.5rem" }}>
          <div style={{ maxWidth: "1280px", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "80px", alignItems: "center" }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: "32px" }}>Commitments</div>
              <h2 className="fc" style={{ fontSize: "clamp(36px, 4vw, 56px)", fontWeight: 300, color: "var(--fg)", marginBottom: "24px", lineHeight: 1, letterSpacing: "-0.02em" }}>
                Campaigns, not<br />
                <em style={{ fontStyle: "italic", color: "var(--cyan)" }}>just tasks.</em>
              </h2>
              <p className="fm" style={{ fontSize: "13px", color: "var(--fg-dim)", lineHeight: 1.85, marginBottom: "32px", fontWeight: 300 }}>
                Group tasks into commitment windows — a 30-day exercise streak, a weekly writing habit, a project deadline. Link individual tasks or recurring rules. The commitment tracks overall pass/fail across all linked tasks.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "24px" }}>
                {[
                  { label: "DRAFT",     cls: "badge-amber"   },
                  { label: "ACTIVE",    cls: "badge-cyan"    },
                  { label: "COMPLETED", cls: "badge-emerald" },
                  { label: "FAILED",    cls: "badge-red"     },
                ].map(({ label, cls }) => <span key={label} className={`badge ${cls}`}>{label}</span>)}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  { badge: "badge-blue",    label: "Commitment Windows",   desc: "Set a start and end date. Any tasks that fall inside count toward it." },
                  { badge: "badge-purple",  label: "Link Recurrences",     desc: "Attach a recurring task rule — every generated instance is tracked." },
                  { badge: "badge-emerald", label: "Day-Status Grid",      desc: "Visual calendar grid shows pass/fail/pending for every day in the window." },
                  { badge: "badge-orange",  label: "Revival on Rectify",   desc: "If a voucher rectifies a failed linked task, a FAILED commitment can revive." },
                ].map(({ badge, label, desc }) => (
                  <div key={label} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <span className={`badge ${badge}`} style={{ fontSize: "9px", flexShrink: 0, marginTop: "2px" }}>{label}</span>
                    <span className="fm" style={{ fontSize: "12px", color: "var(--fg-dim)", lineHeight: 1.7, fontWeight: 300 }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Screenshot placeholder */}
            <div style={{ border: "1px dashed rgba(0,217,255,0.25)", background: "rgba(0,217,255,0.02)", aspectRatio: "4/3", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px" }}>
              <div style={{ width: "36px", height: "36px", border: "1px dashed rgba(0,217,255,0.3)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "rgba(0,217,255,0.4)", fontSize: "20px", lineHeight: 1 }}>+</span>
              </div>
              <span className="fm" style={{ fontSize: "10px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,217,255,0.3)" }}>Commitments screenshot</span>
            </div>
          </div>
        </section>

        {/* ─── REPUTATION ─── */}
        <section style={{ borderTop: "1px solid var(--border)", padding: "100px 2.5rem" }}>
          <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
            <div className="eyebrow" style={{ marginBottom: "32px" }}>Reputation</div>
            <h2 className="fc" style={{ fontSize: "clamp(36px, 5vw, 64px)", fontWeight: 300, color: "var(--fg)", marginBottom: "16px", letterSpacing: "-0.02em" }}>
              Your track record,<br />
              <em style={{ fontStyle: "italic", color: "var(--cyan)" }}>scored 0–1000.</em>
            </h2>
            <p className="fm" style={{ fontSize: "13px", color: "var(--fg-dim)", maxWidth: "560px", lineHeight: 1.8, marginBottom: "64px", fontWeight: 300 }}>
              Every task, session, and vouching interaction feeds into a live reputation score. It moves with velocity — improving as you deliver, dropping when you fail, rising when you help others.
            </p>

            {/* Tier strip */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "32px" }}>
              <div className="fm" style={{ fontSize: "10px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--fg-muted)", marginBottom: "16px" }}>Tiers</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {[
                  { label: "Legendary",  score: "900+", cls: "badge-cyan"    },
                  { label: "Elite",      score: "800+", cls: "badge-purple"  },
                  { label: "Trusted",    score: "700+", cls: "badge-emerald" },
                  { label: "Solid",      score: "600+", cls: "badge-blue"    },
                  { label: "Rising",     score: "500+", cls: "badge-amber"   },
                  { label: "New Here",   score: "400+", cls: "badge-orange"  },
                  { label: "Shaky",      score: "300+", cls: "badge-red"     },
                  { label: "Struggling", score: "200+", cls: "badge-red"     },
                  { label: "Unreliable", score: "0+",   cls: "badge-red"     },
                ].map(({ label, score, cls }) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span className={`badge ${cls}`} style={{ fontSize: "9px" }}>{label}</span>
                    <span className="fm" style={{ fontSize: "10px", color: "var(--fg-muted)" }}>{score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── LEDGER ─── */}
        <section style={{ borderTop: "1px solid var(--border)", background: "var(--surface)", padding: "100px 2.5rem" }}>
          <div style={{ maxWidth: "1280px", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "80px", alignItems: "center" }}>
            {/* Screenshot placeholder */}
            <div style={{ border: "1px dashed rgba(0,217,255,0.25)", background: "rgba(0,217,255,0.02)", aspectRatio: "4/3", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px" }}>
              <div style={{ width: "36px", height: "36px", border: "1px dashed rgba(0,217,255,0.3)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "rgba(0,217,255,0.4)", fontSize: "20px", lineHeight: 1 }}>+</span>
              </div>
              <span className="fm" style={{ fontSize: "10px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,217,255,0.3)" }}>Monthly ledger screenshot</span>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: "32px" }}>Financial Ledger</div>
              <h2 className="fc" style={{ fontSize: "clamp(36px, 4vw, 56px)", fontWeight: 300, color: "var(--fg)", marginBottom: "24px", lineHeight: 1, letterSpacing: "-0.02em" }}>
                Every failure<br />
                <em style={{ fontStyle: "italic", color: "var(--cyan)" }}>costs something.</em>
              </h2>
              <p className="fm" style={{ fontSize: "13px", color: "var(--fg-dim)", lineHeight: 1.85, marginBottom: "32px", fontWeight: 300 }}>
                Every failure, rectification, and voucher timeout is written to a permanent ledger. At month-end you receive a settlement summary. What you owe is real — and goes to charity.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  { badge: "badge-red",     label: "Failure",          desc: "Task missed or denied → failure cost added to your monthly ledger." },
                  { badge: "badge-emerald", label: "Rectified",        desc: "Voucher-authorized reversal. Negative entry cancels a prior failure." },
                  { badge: "badge-orange",  label: "Voucher Penalty",  desc: "Voucher ignores review window → 30¢ charged to them, not you." },
                  { badge: "badge-purple",  label: "Override",         desc: "One emergency waiver per month — use it for genuine circumstances." },
                  { badge: "badge-cyan",    label: "Settlement Email", desc: "Month-end summary sent automatically. Charity payment coming soon." },
                ].map(({ badge, label, desc }) => (
                  <div key={label} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <span className={`badge ${badge}`} style={{ fontSize: "9px", flexShrink: 0, marginTop: "2px" }}>{label}</span>
                    <span className="fm" style={{ fontSize: "12px", color: "var(--fg-dim)", lineHeight: 1.7, fontWeight: 300 }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── MORE FEATURES ─── */}
        <section style={{ borderTop: "1px solid var(--border)", padding: "100px 2.5rem" }}>
          <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
            <div className="eyebrow" style={{ marginBottom: "32px" }}>Everything Else</div>
            <h2 className="fc" style={{ fontSize: "clamp(32px, 4vw, 52px)", fontWeight: 300, color: "var(--fg)", marginBottom: "64px", letterSpacing: "-0.02em" }}>
              Built for the long haul.
            </h2>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1px", background: "var(--border)" }}>
              {[
                {
                  badge: "badge-purple",  title: "Recurring Tasks",
                  body: "Daily, weekly, or monthly recurrence rules. A background job generates each instance on schedule, carrying over reminder offsets and event fields.",
                  placeholder: "Recurring tasks screenshot",
                },
                {
                  badge: "badge-cyan",    title: "NLP Task Parser",
                  body: "Type `finish report -end tmrw pomo 2 vouch @dan -proof` and the system extracts deadline, required pomodoros, voucher, and proof requirement inline. Ghost-text autocomplete with Tab to accept.",
                  placeholder: "Task input parser screenshot",
                },
                {
                  badge: "badge-emerald", title: "Google Calendar",
                  body: "Bidirectional OAuth sync. Tasks marked as events appear on your calendar. Incoming calendar events import as tasks. Independent directional controls per user.",
                  placeholder: "Google Calendar sync screenshot",
                },
                {
                  badge: "badge-amber",   title: "Reminders",
                  body: "Per-task reminders delivered via push notification and email. Set any offset — 1h before, 5m before, or custom. Deadline warnings are seeded automatically.",
                  placeholder: "Reminders screenshot",
                },
                {
                  badge: "badge-orange",  title: "Subtasks",
                  body: "Break a task into sub-items. All subtasks must be marked complete before you can submit the parent task for voucher review.",
                  placeholder: "Subtasks screenshot",
                },
                {
                  badge: "badge-blue",    title: "Realtime Sync",
                  body: "Supabase Realtime subscriptions on tasks, friendships, pomo sessions, and commitments. State changes appear on all your devices within seconds — no refresh needed.",
                  placeholder: "Realtime dashboard screenshot",
                },
              ].map(({ badge, title, body, placeholder }) => (
                <div key={title} style={{ background: "var(--bg)", padding: "36px 32px", display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <h3 className="fc" style={{ fontSize: "22px", fontWeight: 500, color: "var(--fg)" }}>{title}</h3>
                    <span className={`badge ${badge}`} style={{ fontSize: "9px" }}>feature</span>
                  </div>
                  <p className="fm" style={{ fontSize: "12px", color: "var(--fg-dim)", lineHeight: 1.8, fontWeight: 300 }}>{body}</p>
                  {/* Screenshot placeholder */}
                  <div style={{ border: "1px dashed rgba(0,217,255,0.2)", background: "rgba(0,217,255,0.02)", aspectRatio: "16/9", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px", marginTop: "8px" }}>
                    <span style={{ color: "rgba(0,217,255,0.3)", fontSize: "18px" }}>+</span>
                    <span className="fm" style={{ fontSize: "9px", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(0,217,255,0.25)" }}>{placeholder}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── FOOTER ─── */}
        <footer style={{ borderTop: "1px solid var(--border)", padding: "28px 2.5rem" }}>
          <div style={{ maxWidth: "1280px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "18px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "20px" }}>
              <span className="fm" style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--fg-dim)" }}>
                Task Accountability System by{" "}
                <span style={{ color: "var(--fg)", fontWeight: 500 }}>Tarun Hariharan</span>
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
                <a href="mailto:tarun2k01@gmail.com" aria-label="Email" className="icon-link">
                  <Mail size={20} />
                </a>
                <a href="https://www.linkedin.com/in/tarun2k01" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="icon-link">
                  <Linkedin size={20} />
                </a>
                <a href="https://tarunh.com" target="_blank" rel="noopener noreferrer" aria-label="Personal Website" className="icon-link">
                  <Globe size={20} />
                </a>
              </div>
            </div>
            <BuildStamp />
          </div>
        </footer>

      </div>
    </>
  );
}
