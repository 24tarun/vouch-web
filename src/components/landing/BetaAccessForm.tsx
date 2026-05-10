"use client";

import { type FormEvent, useState } from "react";
import { Button3D } from "@/components/ui/Button3D";

function AppleMark({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08ZM12.03 7.25C11.88 5.02 13.69 3.18 15.77 3c.29 2.58-2.34 4.15-3.74 4.25Z" />
    </svg>
  );
}

function AndroidMark({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.6 9.48 19.44 6.3a.62.62 0 0 0-.26-.85.6.6 0 0 0-.83.22l-1.88 3.24a10.52 10.52 0 0 0-8.94 0L5.65 5.67a.61.61 0 0 0-.87-.2.6.6 0 0 0-.22.83L6.4 9.48A10.6 10.6 0 0 0 1 18h22a10.6 10.6 0 0 0-5.4-8.52ZM7 15.25A1.25 1.25 0 1 1 7 12.75a1.25 1.25 0 0 1 0 2.5Zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" />
    </svg>
  );
}

const STYLES = `
  .beta-form-root {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    max-width: 1120px;
    margin: 34px auto 0;
  }

  .beta-heading {
    font-family: 'Cormorant', Georgia, serif;
    font-size: clamp(28px, 3vw, 44px);
    font-weight: 400;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--fg, #f8fafc);
    margin: 0 0 10px;
    text-align: center;
  }

  .beta-copy {
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.04em;
    font-weight: 300;
    line-height: 1.8;
    color: var(--fg-dim, #94a3b8);
    margin: 0 0 18px;
    text-align: center;
  }

  .beta-controls {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: nowrap;
    justify-content: center;
    width: 100%;
  }

  .beta-radio {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    color: var(--fg-dim, #94a3b8);
    cursor: pointer;
  }

  .beta-radio-icon {
    width: 24px;
    height: 24px;
    color: currentColor;
  }

  .beta-radio-icon-android { color: #3ddc84; }

  .beta-radio input {
    accent-color: var(--cyan, #00d9ff);
    width: 14px;
    height: 14px;
  }

  .beta-email {
    width: 100%;
    min-width: 300px;
    max-width: 560px;
    height: 40px;
    border: none;
    border-bottom: 1px solid var(--border-hi, #334155);
    background: transparent;
    color: var(--fg, #f8fafc);
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    letter-spacing: 0.02em;
    outline: none;
    padding: 0 2px;
  }

  .beta-email:focus {
    border-bottom-color: var(--cyan, #00d9ff);
    box-shadow: 0 1px 0 var(--cyan, #00d9ff);
  }

  .beta-email::placeholder { color: var(--fg-muted, #334155); }

  .beta-email-error {
    border-bottom-color: #f87171;
    box-shadow: 0 1px 0 #f87171;
  }

`;

export function BetaAccessForm() {
  const [betaDevice, setBetaDevice] = useState<"ios" | "android">("ios");
  const [betaEmail, setBetaEmail] = useState("");
  const [betaStatus, setBetaStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [betaEmailError, setBetaEmailError] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const email = betaEmail.trim();
    if (!email || !email.includes("@")) {
      setBetaEmailError(true);
      setBetaStatus("error");
      return;
    }

    setBetaStatus("loading");
    setBetaEmailError(false);

    try {
      const response = await fetch("/api/beta-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: betaDevice, email }),
      });

      if (!response.ok) throw new Error("beta_access_failed");

      setBetaStatus("success");
      setBetaEmail("");
    } catch {
      setBetaStatus("error");
      setBetaEmailError(true);
    }
  };

  return (
    <>
      <style>{STYLES}</style>
      <form className="beta-form-root" onSubmit={handleSubmit} noValidate>
        <h2 className="beta-heading">iOS and Android apps are in testing phase</h2>
        <p className="beta-copy">Choose your platform and send me your email for access</p>

        <div className="beta-controls">
          <label className="beta-radio">
            <input
              type="radio"
              name="beta-device"
              value="ios"
              aria-label="iOS"
              checked={betaDevice === "ios"}
              onChange={() => setBetaDevice("ios")}
            />
            <span className="beta-radio-icon">
              <AppleMark size={24} />
            </span>
          </label>

          <label className="beta-radio">
            <input
              type="radio"
              name="beta-device"
              value="android"
              aria-label="Android"
              checked={betaDevice === "android"}
              onChange={() => setBetaDevice("android")}
            />
            <span className="beta-radio-icon beta-radio-icon-android">
              <AndroidMark size={24} />
            </span>
          </label>

          <input
            className={`beta-email${betaEmailError ? " beta-email-error" : ""}`}
            type="email"
            value={betaEmail}
            placeholder="your@email.com"
            aria-label="Beta access email"
            onChange={(e) => {
              setBetaEmail(e.target.value);
              setBetaEmailError(false);
              if (betaStatus !== "loading") {
                setBetaStatus("idle");
              }
            }}
          />

          <Button3D
            type="submit"
            variant="cyan"
            disabled={betaStatus === "loading"}
            height={40}
            width="auto"
            style={{ minWidth: "190px", padding: "0 18px" }}
          >
            {betaStatus === "loading" ? "Sending" : "Request access"}
          </Button3D>
        </div>
      </form>
    </>
  );
}
