"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Camera, FolderOpen } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface WebcamCaptureModalProps {
    open: boolean;
    onClose: () => void;
    onCapture: (file: File) => void;
    onFallbackToFilePicker: () => void;
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

        navigator.mediaDevices
            .getUserMedia({ video: { facingMode: "environment" }, audio: false })
            .then((stream) => {
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.onloadedmetadata = () => setReady(true);
                }
            })
            .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : "Camera access denied";
                setError(msg);
            });

        return () => stopStream();
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
            <DialogContent className="max-w-lg p-0 overflow-hidden">
                <div className="p-4 border-b">
                    <DialogTitle className="text-sm font-medium">Take Photo</DialogTitle>
                </div>

                {error ? (
                    <div className="p-6 space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Could not access camera: {error}
                        </p>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={handleClose}>
                                Cancel
                            </Button>
                            <Button size="sm" onClick={handleFallback}>
                                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                                Choose from files
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-0">
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full bg-black"
                            style={{ maxHeight: "60vh", objectFit: "contain" }}
                        />
                        <div className="flex gap-2 justify-between p-3 border-t">
                            <Button variant="ghost" size="sm" onClick={handleFallback}>
                                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                                Choose file
                            </Button>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={handleClose}>
                                    Cancel
                                </Button>
                                <Button size="sm" onClick={handleCapture} disabled={!ready}>
                                    <Camera className="mr-1.5 h-3.5 w-3.5" />
                                    Capture
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
