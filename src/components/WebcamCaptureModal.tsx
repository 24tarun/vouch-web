"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Camera, FolderOpen, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface WebcamCaptureModalProps {
    open: boolean;
    onClose: () => void;
    onCapture: (file: File) => void;
    onFallbackToFilePicker: () => void;
}

/** Try getUserMedia with a given constraint, resolving to null on any error. */
async function tryGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream | null> {
    try {
        return await navigator.mediaDevices.getUserMedia(constraints);
    } catch {
        return null;
    }
}

export function WebcamCaptureModal({ open, onClose, onCapture, onFallbackToFilePicker }: WebcamCaptureModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const stopStream = useCallback(() => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
    }, []);

    useEffect(() => {
        if (!open) return;

        setReady(false);
        setError(null);

        let cancelled = false;

        (async () => {
            // On desktop, `facingMode: "environment"` (rear camera) is not available —
            // that constraint alone causes NotFoundError/OverconstrainedError even when the
            // browser has camera permission. Try progressively looser constraints:
            //   1. any camera (most permissive — works on all desktops)
            //   2. nothing (shouldn't happen, but guards against edge-cases)
            const stream =
                (await tryGetUserMedia({ video: true, audio: false }));

            if (cancelled) {
                stream?.getTracks().forEach((t) => t.stop());
                return;
            }

            if (!stream) {
                setError(
                    "Camera access was blocked. " +
                    "Please allow camera access in your browser's address-bar or site settings, " +
                    "and make sure your OS has granted the browser camera permission."
                );
                return;
            }

            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.onloadedmetadata = () => {
                    if (!cancelled) setReady(true);
                };
            }
        })();

        return () => {
            cancelled = true;
            stopStream();
        };
    }, [open, stopStream]);

    const handleCapture = () => {
        const video = videoRef.current;
        if (!video || !ready) return;

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")?.drawImage(video, 0, 0);

        canvas.toBlob(
            (blob) => {
                if (!blob) return;
                const file = new File([blob], `proof-${Date.now()}.jpg`, { type: "image/jpeg" });
                stopStream();
                onCapture(file);
                onClose();
            },
            "image/jpeg",
            0.92
        );
    };

    const handleClose = () => {
        stopStream();
        onClose();
    };

    const handleFallback = () => {
        stopStream();
        onClose();
        onFallbackToFilePicker();
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
            <DialogContent className="max-w-lg p-0 overflow-hidden bg-slate-900 border-slate-800 text-slate-200 [&>[data-slot='dialog-close']]:text-slate-400 [&>[data-slot='dialog-close']]:hover:text-slate-200">
                <div className="px-5 pt-5 pb-4 border-b border-slate-800">
                    <DialogTitle className="text-sm font-semibold text-slate-100">Take Photo</DialogTitle>
                </div>

                {error ? (
                    <div className="p-5 space-y-4">
                        <div className="flex gap-3 items-start rounded-lg bg-slate-800/60 border border-slate-700 p-3">
                            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                            <p className="text-sm text-slate-300 leading-relaxed">{error}</p>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleClose}
                                className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleFallback}
                                className="bg-slate-700 hover:bg-slate-600 text-slate-100"
                            >
                                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                                Choose from files instead
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div>
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full bg-black"
                            style={{ maxHeight: "60vh", objectFit: "contain" }}
                        />
                        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleFallback}
                                className="text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                            >
                                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                                Choose file
                            </Button>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleClose}
                                    className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleCapture}
                                    disabled={!ready}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40"
                                >
                                    <Camera className="mr-1.5 h-3.5 w-3.5" />
                                    {ready ? "Capture" : "Starting…"}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

export function isMobileDevice(): boolean {
    if (typeof window === "undefined") return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        || (navigator.maxTouchPoints > 1 && /Mobi|Android/i.test(navigator.userAgent));
}
