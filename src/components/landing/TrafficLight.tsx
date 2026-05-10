"use client";

import { useState, useEffect } from "react";

type TrafficPhase = "red" | "red-blink" | "yellow" | "yellow-blink" | "green" | "green-blink";

const SEQUENCE: [TrafficPhase, number][] = [
  ["red",          5000],
  ["red-blink",    2400],
  ["yellow",       3000],
  ["yellow-blink", 2400],
  ["green",        5000],
  ["green-blink",  2400],
];

export function TrafficLight() {
  const [phase, setPhase] = useState<TrafficPhase>("red");

  useEffect(() => {
    let idx = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      idx = (idx + 1) % SEQUENCE.length;
      setPhase(SEQUENCE[idx][0]);
      timer = setTimeout(next, SEQUENCE[idx][1]);
    };
    timer = setTimeout(next, SEQUENCE[0][1]);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <style>{`
        @keyframes trafficBlink {
          0%   { opacity: 1; }
          14%  { opacity: 0.1; }
          28%  { opacity: 1; }
          50%  { opacity: 0.1; }
          72%  { opacity: 1; }
          86%  { opacity: 0.1; }
          100% { opacity: 0.1; }
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{
          width: 24, height: 24, borderRadius: 12,
          backgroundColor: "#EF4444",
          opacity: phase === "red" ? 0.92 : 0.22,
          animation: phase === "red-blink" ? "trafficBlink 2.4s ease forwards" : "none",
          boxShadow: phase === "red" ? "0 0 10px 3px rgba(239,68,68,0.45)" : "none",
          transition: "opacity 0.15s, box-shadow 0.15s",
        }} />
        <div style={{
          width: 24, height: 24, borderRadius: 12,
          backgroundColor: "#F59E0B",
          opacity: phase === "yellow" ? 0.92 : 0.22,
          animation: phase === "yellow-blink" ? "trafficBlink 2.4s ease forwards" : "none",
          boxShadow: phase === "yellow" ? "0 0 10px 3px rgba(245,158,11,0.45)" : "none",
          transition: "opacity 0.15s, box-shadow 0.15s",
        }} />
        <div style={{
          width: 24, height: 24, borderRadius: 12,
          backgroundColor: "#22C55E",
          opacity: phase === "green" ? 0.92 : 0.22,
          animation: phase === "green-blink" ? "trafficBlink 2.4s ease forwards" : "none",
          boxShadow: phase === "green" ? "0 0 10px 3px rgba(34,197,94,0.4)" : "none",
          transition: "opacity 0.15s, box-shadow 0.15s",
        }} />
      </div>
    </>
  );
}
