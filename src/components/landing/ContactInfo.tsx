"use client";

import { useState } from "react";
import { Mail, Linkedin, Github } from "lucide-react";

const EMAIL = "tarun2k01@gmail.com";
const LINKEDIN_URL = "https://www.linkedin.com/in/tarun2k01";
const GITHUB_URL = "https://github.com/tarun2k01";

const STYLES = `
  .contact-root {
    width: 100%;
    margin-top: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }

  .contact-name {
    font-family: 'Cormorant', Georgia, serif;
    font-size: clamp(28px, 2.2vw, 40px);
    letter-spacing: 0.01em;
    color: var(--fg, #f8fafc);
    line-height: 1;
  }

  .contact-name strong {
    font-weight: 500;
  }

  .contact-actions {
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .contact-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-dim, #94a3b8);
    background: transparent;
    border: none;
    width: 28px;
    height: 28px;
    text-decoration: none;
    transition: color 0.2s, filter 0.2s, transform 0.2s;
  }

  .contact-action-btn {
    cursor: pointer;
    padding: 0;
  }

  .contact-action:hover {
    color: var(--cyan, #00d9ff);
    filter: drop-shadow(0 0 6px rgba(0, 217, 255, 0.35));
    transform: translateY(-1px);
  }

  .contact-copied {
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.05em;
    color: var(--cyan, #00d9ff);
  }
`;

export function ContactInfo() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <style>{STYLES}</style>
      <div className="contact-root">
        <span className="contact-name">
          By <strong>Tarun Hariharan</strong>
        </span>

        <div className="contact-actions">
          <button
            type="button"
            className="contact-action contact-action-btn"
            onClick={handleCopy}
            aria-label="Copy email to clipboard"
            title="Copy email"
          >
            <Mail size={20} />
          </button>

          <a
            href={LINKEDIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="contact-action"
            aria-label="Open LinkedIn profile"
            title="LinkedIn"
          >
            <Linkedin size={20} />
          </a>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="contact-action"
            aria-label="Open GitHub profile"
            title="GitHub"
          >
            <Github size={20} />
          </a>

          {copied && <span className="contact-copied">Copied</span>}
        </div>
      </div>
    </>
  );
}
