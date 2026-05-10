"use client";

import * as React from "react";
import Link from "next/link";

const STYLES = `
  .btn3d {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
    border: none;
    border-radius: 10px;
    position: relative;
    background: linear-gradient(180deg, #f8fafc 0%, #dde3ee 100%);
    color: #020617;
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.9),
      0 4px 0 #8899bb,
      0 6px 16px rgba(2,6,23,0.5);
    transform: translateY(0);
    transition: transform 0.1s ease, box-shadow 0.1s ease, opacity 0.15s ease;
  }

  .btn3d:hover {
    transform: translateY(2px);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.9),
      0 2px 0 #8899bb,
      0 4px 10px rgba(2,6,23,0.4);
  }

  .btn3d:active {
    transform: translateY(4px);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.9),
      0 0 0 #8899bb,
      0 2px 6px rgba(2,6,23,0.3);
  }

  .btn3d:disabled {
    opacity: 0.5;
    cursor: default;
    pointer-events: none;
  }

  .btn3d-ghost { opacity: 0.7; }
  .btn3d-ghost:hover { opacity: 1; }

  .btn3d-cyan {
    background: linear-gradient(180deg, #7ef0ff 0%, #00d9ff 55%, #00b8da 100%);
    color: #001018;
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.55),
      0 4px 0 #0b7690,
      0 0 16px rgba(0,217,255,0.35),
      0 8px 18px rgba(2,6,23,0.45);
  }

  .btn3d-cyan:hover {
    transform: translateY(2px);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.55),
      0 2px 0 #0b7690,
      0 0 20px rgba(0,217,255,0.5),
      0 5px 12px rgba(2,6,23,0.4);
  }

  .btn3d-cyan:active {
    transform: translateY(4px);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.55),
      0 0 0 #0b7690,
      0 0 10px rgba(0,217,255,0.4),
      0 2px 6px rgba(2,6,23,0.3);
  }

  .btn3d-group:has(.btn3d-ghost:hover) .btn3d-primary {
    opacity: 0.7;
    transform: translateY(0);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.9),
      0 4px 0 #8899bb,
      0 6px 16px rgba(2,6,23,0.5);
  }
`;

interface Button3DProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "cyan";
  height?: number | string;
  width?: string;
}

export function Button3D({
  variant = "primary",
  height = 40,
  width = "auto",
  className = "",
  style,
  children,
  ...props
}: Button3DProps) {
  return (
    <>
      <style>{STYLES}</style>
      <button className={`btn3d btn3d-${variant} ${className}`} style={{ height, width, ...style }} {...props}>
        {children}
      </button>
    </>
  );
}

interface Button3DLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: "primary" | "ghost" | "cyan";
  height?: number | string;
  width?: string;
}

export function Button3DLink({
  href,
  variant = "primary",
  height = 40,
  width = "auto",
  className = "",
  style,
  children,
  ...props
}: Button3DLinkProps) {
  return (
    <>
      <style>{STYLES}</style>
      <Link
        href={href}
        className={`btn3d btn3d-${variant} ${className}`}
        style={{ height, width, ...style }}
        {...props}
      >
        {children}
      </Link>
    </>
  );
}

interface Button3DGroupProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Button3DGroup({ children, className = "", style }: Button3DGroupProps) {
  return (
    <div className={`btn3d-group ${className}`} style={{ display: "flex", flexDirection: "column", gap: "11px", ...style }}>
      {children}
    </div>
  );
}
