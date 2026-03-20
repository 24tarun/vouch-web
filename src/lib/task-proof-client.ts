"use client";

import {
    MAX_TASK_PROOF_VIDEO_DURATION_MS,
    type TaskProofIntent,
    type TaskProofMediaKind,
} from "@/lib/task-proof-shared";
import { extractProofTimestampText, normalizeProofTimestampText } from "@/lib/proof-timestamp";

export interface PreparedTaskProof {
    file: File;
    mediaKind: TaskProofMediaKind;
    mimeType: string;
    sizeBytes: number;
    durationMs: number | null;
    overlayTimestampText: string;
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Could not load image"));
        img.src = url;
    });
}

async function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    reject(new Error("Image compression failed"));
                    return;
                }
                resolve(blob);
            },
            mimeType,
            quality
        );
    });
}

function replaceExtension(name: string, extension: string): string {
    const trimmed = name.replace(/\.[^.]+$/, "");
    return `${trimmed}.${extension}`;
}

export async function compressImageToMaxSize(file: File, maxBytes = Infinity): Promise<File> {
    const normalizedType = (file.type || "").toLowerCase();
    const canKeepOriginalMime = normalizedType === "image/jpeg" || normalizedType === "image/png" || normalizedType === "image/webp";
    const mustTranscodeToJpeg = !canKeepOriginalMime;

    if (file.size <= maxBytes && !mustTranscodeToJpeg) return file;

    const imageUrl = URL.createObjectURL(file);
    try {
        const image = await loadImage(imageUrl);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error("Canvas is not available");
        }

        let targetWidth = image.naturalWidth;
        let targetHeight = image.naturalHeight;
        let quality = 0.9;
        let attempt = 0;

        while (attempt < 12) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            ctx.clearRect(0, 0, targetWidth, targetHeight);
            ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

            const blob = await canvasToBlob(canvas, "image/jpeg", quality);
            if (blob.size <= maxBytes) {
                return new File([blob], replaceExtension(file.name, "jpg"), {
                    type: "image/jpeg",
                    lastModified: Date.now(),
                });
            }

            quality -= 0.1;
            if (quality < 0.45) {
                quality = 0.85;
                targetWidth = Math.max(320, Math.floor(targetWidth * 0.85));
                targetHeight = Math.max(240, Math.floor(targetHeight * 0.85));
            }
            attempt += 1;
        }
    } finally {
        URL.revokeObjectURL(imageUrl);
    }

    throw new Error("Image could not be transcoded.");
}

export async function getVideoDurationMs(file: File): Promise<number> {
    const videoUrl = URL.createObjectURL(file);
    try {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.src = videoUrl;

        await new Promise<void>((resolve, reject) => {
            video.onloadedmetadata = () => resolve();
            video.onerror = () => reject(new Error("Could not read video metadata"));
        });

        const durationMs = Math.round((video.duration || 0) * 1000);
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            throw new Error("Invalid video duration");
        }

        return durationMs;
    } finally {
        URL.revokeObjectURL(videoUrl);
    }
}

async function bestEffortCompressVideo(file: File, durationMs: number): Promise<File | null> {
    if (typeof window === "undefined") return null;
    if (!("MediaRecorder" in window)) return null;
    if (!HTMLCanvasElement.prototype.captureStream) return null;

    const preferredMimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : (MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "");
    if (!preferredMimeType) return null;

    const sourceUrl = URL.createObjectURL(file);
    const sourceVideo = document.createElement("video");
    sourceVideo.src = sourceUrl;
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideo.preload = "auto";

    try {
        await new Promise<void>((resolve, reject) => {
            sourceVideo.onloadedmetadata = () => resolve();
            sourceVideo.onerror = () => reject(new Error("Could not load video for compression"));
        });

        const maxWidth = 720;
        const scale = Math.min(1, maxWidth / Math.max(1, sourceVideo.videoWidth));
        const width = Math.max(320, Math.floor(sourceVideo.videoWidth * scale));
        const height = Math.max(240, Math.floor(sourceVideo.videoHeight * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        const stream = canvas.captureStream(24);
        const targetBitsPerSecond = Math.max(150_000, Math.min(900_000, Math.floor((50 * 1024 * 1024 * 8) / (durationMs / 1000))));
        const recorder = new MediaRecorder(stream, {
            mimeType: preferredMimeType,
            videoBitsPerSecond: targetBitsPerSecond,
        });

        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) chunks.push(event.data);
        };

        let drawHandle = 0;
        const drawFrame = () => {
            ctx.drawImage(sourceVideo, 0, 0, width, height);
            if (!sourceVideo.paused && !sourceVideo.ended) {
                drawHandle = window.requestAnimationFrame(drawFrame);
            }
        };

        const recordingDone = new Promise<File>((resolve, reject) => {
            recorder.onerror = () => reject(new Error("Video compression failed"));
            recorder.onstop = () => {
                const output = new Blob(chunks, { type: preferredMimeType.split(";")[0] || "video/webm" });
                resolve(
                    new File([output], replaceExtension(file.name, "webm"), {
                        type: output.type || "video/webm",
                        lastModified: Date.now(),
                    })
                );
            };
        });

        recorder.start(250);
        await sourceVideo.play();
        drawFrame();

        await new Promise<void>((resolve) => {
            sourceVideo.onended = () => resolve();
        });

        window.cancelAnimationFrame(drawHandle);
        if (recorder.state !== "inactive") recorder.stop();
        const compressed = await recordingDone;

        return compressed;
    } finally {
        sourceVideo.pause();
        URL.revokeObjectURL(sourceUrl);
    }
}

export function getProofIntentFromPreparedProof(proof: PreparedTaskProof): TaskProofIntent {
    return {
        mediaKind: proof.mediaKind,
        mimeType: proof.mimeType,
        sizeBytes: proof.sizeBytes,
        durationMs: proof.durationMs,
        overlayTimestampText: proof.overlayTimestampText,
    };
}

export async function prepareTaskProof(file: File): Promise<PreparedTaskProof> {
    const mimeType = (file.type || "").toLowerCase();
    const mediaKind: TaskProofMediaKind | null = mimeType.startsWith("image/")
        ? "image"
        : (mimeType.startsWith("video/") ? "video" : null);

    if (!mediaKind) {
        throw new Error("Only images and videos are supported.");
    }

    if (mediaKind === "image") {
        const overlayTimestampText = normalizeProofTimestampText(await extractProofTimestampText(file));
        const compressed = await compressImageToMaxSize(file);
        return {
            file: compressed,
            mediaKind,
            mimeType: compressed.type || "image/jpeg",
            sizeBytes: compressed.size,
            durationMs: null,
            overlayTimestampText,
        };
    }

    const overlayTimestampText = normalizeProofTimestampText(await extractProofTimestampText(file));
    const durationMs = await getVideoDurationMs(file);
    if (durationMs > MAX_TASK_PROOF_VIDEO_DURATION_MS) {
        throw new Error("Video proof must be 15 seconds or less.");
    }

    const compressedVideo = await bestEffortCompressVideo(file, durationMs);
    const finalVideo = compressedVideo || file;

    return {
        file: finalVideo,
        mediaKind,
        mimeType: finalVideo.type || "video/mp4",
        sizeBytes: finalVideo.size,
        durationMs,
        overlayTimestampText,
    };
}
