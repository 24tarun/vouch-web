export interface StatMetricPreset {
    id: string;
    label: string;
    textClass: string;
    glow: string;
    accentName: string;
}

export const STAT_METRIC_PRESETS: StatMetricPreset[] = [
    { id: "active", label: "Active", textClass: "text-blue-400", glow: "0 0 8px rgba(96,165,250,0.6)", accentName: "Blue 400" },
    { id: "time-focused", label: "Time Focused", textClass: "text-cyan-400", glow: "0 0 8px rgba(34,211,238,0.6)", accentName: "Cyan 400" },
    { id: "pending-vouch", label: "Pending Vouch", textClass: "text-purple-400", glow: "0 0 8px rgba(192,132,252,0.6)", accentName: "Purple 400" },
    { id: "accepted", label: "Accepted", textClass: "text-lime-300", glow: "0 0 8px rgba(190,242,100,0.6)", accentName: "Lime 300" },
    { id: "failed", label: "Failed", textClass: "text-red-500", glow: "0 0 8px rgba(239,68,68,0.6)", accentName: "Red 500" },
    { id: "projected", label: "Projected", textClass: "text-pink-500", glow: "0 0 8px rgba(236,72,153,0.6)", accentName: "Pink 500" },
    { id: "rectify-passes", label: "Rectify Passes", textClass: "text-orange-400", glow: "0 0 8px rgba(251,146,60,0.6)", accentName: "Orange 400" },
    { id: "kept", label: "Kept", textClass: "text-green-400", glow: "0 0 8px rgba(74,222,128,0.6)", accentName: "Green 400" },
];
