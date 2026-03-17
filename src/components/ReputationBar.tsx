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

    const velocitySign = data.velocityDelta !== null && data.velocityDelta >= 0 ? "+" : "";
    const velocityColor =
        data.velocityDelta !== null && data.velocityDelta >= 0
            ? "text-emerald-400"
            : "text-red-400";
    const velocityArrow = data.velocityDelta !== null && data.velocityDelta >= 0 ? "↑" : "↓";

    return (
        <div className={`w-full ${className ?? ""}`}>
            {/* Labels row above the bar */}
            <div className="flex items-baseline justify-between mb-1 px-0.5">
                <span
                    className="font-mono text-white tabular-nums"
                    style={{ fontSize: "11px", textShadow: "0 0 6px rgba(251,146,60,0.7)" }}
                >
                    {data.score}
                </span>
                {data.velocityDelta !== null && (
                    <span className={`font-mono text-[10px] ${velocityColor}`}>
                        {velocityArrow} {velocitySign}{data.velocityDelta} this week
                    </span>
                )}
            </div>

            {/* Bar — 1/3 of original h-7 (~9px) */}
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
                        background: "linear-gradient(90deg, rgb(234,88,12) 0%, rgb(251,146,60) 100%)",
                        boxShadow: "0 0 8px 1px rgba(251,146,60,0.5)",
                    }}
                />
            </div>
        </div>
    );
}
