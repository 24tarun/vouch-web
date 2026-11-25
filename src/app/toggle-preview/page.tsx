"use client";

import { useState } from "react";
import { motion } from "framer-motion";

function ToggleIOS({ label }: { label: string }) {
    const [on, setOn] = useState(false);
    return (
        <Row label={label} desc="Standard iOS. Gray → green, white knob, spring slide.">
            <button
                onClick={() => setOn(v => !v)}
                style={{
                    width: 51,
                    height: 31,
                    borderRadius: 999,
                    background: on ? "#34c759" : "#e5e5ea",
                    border: "none",
                    cursor: "pointer",
                    padding: 2,
                    display: "flex",
                    alignItems: "center",
                    transition: "background 0.2s",
                    flexShrink: 0,
                }}
                aria-checked={on}
                role="switch"
            >
                <motion.div
                    animate={{ x: on ? 20 : 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    style={{
                        width: 27,
                        height: 27,
                        borderRadius: 999,
                        background: "#fff",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
                    }}
                />
            </button>
        </Row>
    );
}

function ToggleCyan({ label }: { label: string }) {
    const [on, setOn] = useState(false);
    return (
        <Row label={label} desc="App-native. Dark → cyan glow, slate knob.">
            <button
                onClick={() => setOn(v => !v)}
                style={{
                    width: 52,
                    height: 30,
                    borderRadius: 999,
                    background: on ? "#00d9ff" : "#1e293b",
                    border: `1px solid ${on ? "#00d9ff" : "#334155"}`,
                    cursor: "pointer",
                    padding: 3,
                    display: "flex",
                    alignItems: "center",
                    transition: "background 0.22s, border-color 0.22s",
                    boxShadow: on ? "0 0 14px rgba(0,217,255,0.45)" : "none",
                    flexShrink: 0,
                }}
                aria-checked={on}
                role="switch"
            >
                <motion.div
                    animate={{ x: on ? 22 : 0 }}
                    transition={{ type: "spring", stiffness: 480, damping: 28 }}
                    style={{
                        width: 22,
                        height: 22,
                        borderRadius: 999,
                        background: on ? "#020617" : "#475569",
                        boxShadow: on ? "0 0 6px rgba(0,217,255,0.3)" : "none",
                        transition: "background 0.2s",
                    }}
                />
            </button>
        </Row>
    );
}

function ToggleGlass({ label }: { label: string }) {
    const [on, setOn] = useState(false);
    return (
        <Row label={label} desc="Frosted glass track, translucent backdrop-blur knob.">
            <button
                onClick={() => setOn(v => !v)}
                style={{
                    width: 54,
                    height: 30,
                    borderRadius: 999,
                    background: on
                        ? "rgba(0,217,255,0.18)"
                        : "rgba(255,255,255,0.06)",
                    border: `1px solid ${on ? "rgba(0,217,255,0.45)" : "rgba(255,255,255,0.1)"}`,
                    backdropFilter: "blur(8px)",
                    WebkitBackdropFilter: "blur(8px)",
                    cursor: "pointer",
                    padding: 4,
                    display: "flex",
                    alignItems: "center",
                    transition: "background 0.25s, border-color 0.25s",
                    boxShadow: on
                        ? "inset 0 1px 0 rgba(255,255,255,0.15), 0 0 18px rgba(0,217,255,0.25)"
                        : "inset 0 1px 0 rgba(255,255,255,0.08)",
                    flexShrink: 0,
                }}
                aria-checked={on}
                role="switch"
            >
                <motion.div
                    animate={{ x: on ? 24 : 0 }}
                    transition={{ type: "spring", stiffness: 440, damping: 30 }}
                    style={{
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        background: on
                            ? "rgba(0,217,255,0.9)"
                            : "rgba(255,255,255,0.35)",
                        backdropFilter: "blur(4px)",
                        WebkitBackdropFilter: "blur(4px)",
                        border: "1px solid rgba(255,255,255,0.3)",
                        boxShadow: on
                            ? "0 0 10px rgba(0,217,255,0.6), 0 2px 4px rgba(0,0,0,0.3)"
                            : "0 2px 4px rgba(0,0,0,0.3)",
                        transition: "background 0.2s, box-shadow 0.2s",
                    }}
                />
            </button>
        </Row>
    );
}

function ToggleOutline({ label }: { label: string }) {
    const [on, setOn] = useState(false);
    return (
        <Row label={label} desc="Minimal outline fills on activation. Flat, no knob glow.">
            <button
                onClick={() => setOn(v => !v)}
                style={{
                    width: 48,
                    height: 26,
                    borderRadius: 4,
                    background: "transparent",
                    border: `1.5px solid ${on ? "#00d9ff" : "#334155"}`,
                    cursor: "pointer",
                    padding: 3,
                    display: "flex",
                    alignItems: "center",
                    position: "relative",
                    overflow: "hidden",
                    transition: "border-color 0.2s",
                    flexShrink: 0,
                }}
                aria-checked={on}
                role="switch"
            >
                <motion.div
                    animate={{ scaleX: on ? 1 : 0 }}
                    initial={false}
                    transition={{ type: "spring", stiffness: 360, damping: 30 }}
                    style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(0,217,255,0.1)",
                        originX: 0,
                    }}
                />
                <motion.div
                    animate={{ x: on ? 22 : 0 }}
                    transition={{ type: "spring", stiffness: 480, damping: 30 }}
                    style={{
                        width: 18,
                        height: 18,
                        borderRadius: 2,
                        background: on ? "#00d9ff" : "#334155",
                        zIndex: 1,
                        transition: "background 0.2s",
                        flexShrink: 0,
                    }}
                />
            </button>
        </Row>
    );
}

function ToggleSquish({ label }: { label: string }) {
    const [on, setOn] = useState(false);
    const [pressed, setPressed] = useState(false);
    return (
        <Row label={label} desc="Knob squishes on press — feels tactile. Cyan track.">
            <button
                onClick={() => setOn(v => !v)}
                onPointerDown={() => setPressed(true)}
                onPointerUp={() => setPressed(false)}
                onPointerLeave={() => setPressed(false)}
                style={{
                    width: 52,
                    height: 30,
                    borderRadius: 999,
                    background: on ? "rgba(0,217,255,0.2)" : "#0f172a",
                    border: `1px solid ${on ? "rgba(0,217,255,0.6)" : "#1e293b"}`,
                    cursor: "pointer",
                    padding: 4,
                    display: "flex",
                    alignItems: "center",
                    transition: "background 0.2s, border-color 0.2s",
                    flexShrink: 0,
                }}
                aria-checked={on}
                role="switch"
            >
                <motion.div
                    animate={{
                        x: on ? 22 : 0,
                        scaleX: pressed ? 1.35 : 1,
                        scaleY: pressed ? 0.75 : 1,
                    }}
                    transition={{ type: "spring", stiffness: 500, damping: 25 }}
                    style={{
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        background: on ? "#00d9ff" : "#475569",
                        transition: "background 0.2s",
                        transformOrigin: on ? "right center" : "left center",
                    }}
                />
            </button>
        </Row>
    );
}

function Row({
    label,
    desc,
    children,
}: {
    label: string;
    desc: string;
    children: React.ReactNode;
}) {
    return (
        <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            padding: "18px 0",
            borderBottom: "1px solid #1e293b",
        }}>
            <div>
                <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#f8fafc", marginBottom: 4 }}>
                    {label}
                </p>
                <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#475569", letterSpacing: "0.04em" }}>
                    {desc}
                </p>
            </div>
            {children}
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 40 }}>
            <p style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 9,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: "#00d9ff",
                marginBottom: 4,
                display: "flex",
                alignItems: "center",
                gap: 10,
            }}>
                <span style={{ display: "inline-block", width: 20, height: 1, background: "#00d9ff", boxShadow: "0 0 6px rgba(0,217,255,0.4)" }} />
                {title}
            </p>
            <div style={{ border: "1px solid #1e293b", borderTop: "none" }}>
                <div style={{ padding: "0 16px" }}>
                    {children}
                </div>
            </div>
        </div>
    );
}

export default function TogglePreview() {
    return (
        <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            <link
                href="https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,300;1,400&family=DM+Mono:ital,wght@0,300;0,400;0,500&display=swap"
                rel="stylesheet"
            />
            <div style={{
                minHeight: "100dvh",
                background: "#020617",
                color: "#f8fafc",
                padding: "48px 24px",
                maxWidth: 480,
                margin: "0 auto",
            }}>
                <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "#00d9ff", marginBottom: 8 }}>
                    toggle preview
                </p>
                <h1 style={{ fontFamily: "'Cormorant', Georgia, serif", fontSize: 40, fontWeight: 300, lineHeight: 1, marginBottom: 40, color: "#f8fafc" }}>
                    5 variants.<br />
                    <em style={{ fontStyle: "italic", color: "#00d9ff" }}>Pick one.</em>
                </h1>

                <Section title="Variant 1 — iOS Classic">
                    <ToggleIOS label="Deadline reminders" />
                    <ToggleIOS label="Voucher notifications" />
                </Section>

                <Section title="Variant 2 — TAS Cyan">
                    <ToggleCyan label="Deadline reminders" />
                    <ToggleCyan label="Voucher notifications" />
                </Section>

                <Section title="Variant 3 — Glassmorphic">
                    <ToggleGlass label="Deadline reminders" />
                    <ToggleGlass label="Voucher notifications" />
                </Section>

                <Section title="Variant 4 — Pill Outline">
                    <ToggleOutline label="Deadline reminders" />
                    <ToggleOutline label="Voucher notifications" />
                </Section>

                <Section title="Variant 5 — Squish">
                    <ToggleSquish label="Deadline reminders" />
                    <ToggleSquish label="Voucher notifications" />
                </Section>

                <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#334155", marginTop: 32 }}>
                    /toggle-preview — delete this route once you've decided
                </p>
            </div>
        </>
    );
}
