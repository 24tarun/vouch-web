"use client";

import { useEffect, useState } from "react";
import type { ReputationScoreData } from "@/lib/reputation/types";

interface ReputationBarProps {
    data: ReputationScoreData;
    className?: string;
}

export function ReputationBar({ data, className }: ReputationBarProps) {
    const fillPercent = (data.score / 1000) * 100;
    const [fill, setFill] = useState(0);

    useEffect(() => {
        setFill(fillPercent);
    }, [fillPercent]);

    const velocityColor =
        data.velocityDelta !== null && data.velocityDelta >= 0
            ? "text-emerald-400"
            : "text-red-400";
    const velocityArrow = data.velocityDelta !== null && data.velocityDelta >= 0 ? "↑" : "↓";

    return (
        <div className={`w-full ${className ?? ""}`}>
            <div className="flex items-baseline justify-between mb-1 px-0.5">
                <span
                    className="font-mono text-white tabular-nums"
                    style={{ fontSize: "11px", textShadow: "0 0 6px rgba(249,115,22,0.7)" }}
                >
                    {data.score}
                </span>
                {data.velocityDelta !== null && (
                    <span className={`font-mono text-[10px] ${velocityColor}`}>
                        {velocityArrow} {Math.abs(data.velocityDelta)} this week
                    </span>
                )}
            </div>

            <div
                className="relative w-full rounded-full overflow-hidden"
                style={{
                    height: "9px",
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.06)",
                }}
                role="progressbar"
                aria-valuenow={data.score}
                aria-valuemin={0}
                aria-valuemax={1000}
            >
                <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
                    style={{
                        width: `${fill}%`,
                        background: "linear-gradient(90deg, rgb(249,115,22) 0%, rgb(249,115,22) 100%)",
                        boxShadow: "0 0 8px 1px rgba(249,115,22,0.5)",
                    }}
                />
            </div>
        </div>
    );
}
