"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface GlassToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    id?: string;
}

export function GlassToggle({ checked, onChange, disabled = false, id }: GlassToggleProps) {
    const [pressed, setPressed] = useState(false);

    return (
        <button
            id={id}
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => !disabled && onChange(!checked)}
            onPointerDown={() => setPressed(true)}
            onPointerUp={() => setPressed(false)}
            onPointerLeave={() => setPressed(false)}
            style={{
                width: 54,
                height: 30,
                borderRadius: 999,
                background: checked
                    ? "rgba(0,217,255,0.18)"
                    : "#1e293b",
                border: `1px solid ${checked ? "rgba(0,217,255,0.45)" : "#334155"}`,
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                cursor: disabled ? "not-allowed" : "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                transition: "background 0.25s, border-color 0.25s, opacity 0.2s",
                boxShadow: checked
                    ? "inset 0 1px 0 rgba(255,255,255,0.15), 0 0 18px rgba(0,217,255,0.25)"
                    : "none",
                opacity: disabled ? 0.4 : 1,
                flexShrink: 0,
                alignSelf: "center",
            }}
        >
            <motion.div
                animate={{
                    x: checked ? 24 : 0,
                    scale: pressed ? 0.88 : 1,
                }}
                transition={{ type: "spring", stiffness: 440, damping: 30 }}
                style={{
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    background: checked
                        ? "rgba(0,217,255,0.9)"
                        : "#64748b",
                    backdropFilter: "blur(4px)",
                    WebkitBackdropFilter: "blur(4px)",
                    border: "1px solid rgba(255,255,255,0.3)",
                    boxShadow: checked
                        ? "0 0 10px rgba(0,217,255,0.6), 0 2px 4px rgba(0,0,0,0.3)"
                        : "0 2px 4px rgba(0,0,0,0.3)",
                    transition: "background 0.2s, box-shadow 0.2s",
                    flexShrink: 0,
                }}
            />
        </button>
    );
}
