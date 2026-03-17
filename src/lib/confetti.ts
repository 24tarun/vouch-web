import confetti from "canvas-confetti";

const CONFETTI_COLORS = ["#a786ff", "#fd8bbc", "#eca184", "#f8deb1"];

export function fireCompletionConfetti() {
    const end = Date.now() + 0.5 * 1000;
    const shared = { particleCount: 2, spread: 55, startVelocity: 60, ticks: 30, decay: 0.85, colors: CONFETTI_COLORS };
    const frame = () => {
        if (Date.now() > end) return;
        confetti({ ...shared, angle: 60, origin: { x: 0, y: 0.5 } });
        confetti({ ...shared, angle: 120, origin: { x: 1, y: 0.5 } });
        requestAnimationFrame(frame);
    };
    frame();
}
