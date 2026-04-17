"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Camera, FolderOpen, AlertTriangle, RefreshCw, Video, Square } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface WebcamCaptureModalProps {
    open: boolean;
    onClose: () => void;
    onCapture: (file: File) => void;
    onFallbackToFilePicker: () => void;
}

type CaptureMode = "photo" | "video";
const MAX_VIDEO_RECORDING_SECONDS = 15;

function detectBrave(): boolean {
    // navigator.brave is a Brave-specific property
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof (navigator as any).brave !== "undefined";
}

function getSupportedVideoRecordingMimeType(): string | null {
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;

    const candidates = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
        "video/mp4",
    ];

    for (const candidate of candidates) {
        if (MediaRecorder.isTypeSupported(candidate)) {
            return candidate;
        }
    }

    return null;
}

export function WebcamCaptureModal({ open, onClose, onCapture, onFallbackToFilePicker }: WebcamCaptureModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const discardRecordingRef = useRef(false);
    const autoStopTimeoutRef = useRef<number | null>(null);
    const recordingTickRef = useRef<number | null>(null);

    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const [captureMode, setCaptureMode] = useState<CaptureMode>("photo");
    const [isRecording, setIsRecording] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const isBrave = useMemo(() => detectBrave(), []);

    const clearRecordingTimers = useCallback(() => {
        if (autoStopTimeoutRef.current != null) {
            window.clearTimeout(autoStopTimeoutRef.current);
            autoStopTimeoutRef.current = null;
        }
        if (recordingTickRef.current != null) {
            window.clearInterval(recordingTickRef.current);
            recordingTickRef.current = null;
        }
    }, []);

    const stopRecording = useCallback((saveRecording: boolean) => {
        const recorder = recorderRef.current;
        if (!recorder) return;

        discardRecordingRef.current = !saveRecording;
        clearRecordingTimers();
        setIsRecording(false);
        setRecordingSeconds(0);

        if (recorder.state !== "inactive") {
            recorder.stop();
        } else {
            recorderRef.current = null;
        }
    }, [clearRecordingTimers]);

    const stopStream = useCallback(() => {
        stopRecording(false);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        setReady(false);
    }, [stopRecording]);

    const startVideoRecording = useCallback(() => {
        if (!ready || !streamRef.current) return;

        const supportedMimeType = getSupportedVideoRecordingMimeType();
        if (!supportedMimeType || typeof MediaRecorder === "undefined") {
            setError("video_unsupported");
            return;
        }

        setError(null);
        discardRecordingRef.current = false;
        recordedChunksRef.current = [];

        const recorder = new MediaRecorder(streamRef.current, { mimeType: supportedMimeType });
        recorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunksRef.current.push(event.data);
            }
        };

        recorder.onerror = () => {
            setError("video_unsupported");
            recorderRef.current = null;
            recordedChunksRef.current = [];
            clearRecordingTimers();
            setIsRecording(false);
            setRecordingSeconds(0);
        };

        recorder.onstop = () => {
            const shouldDiscard = discardRecordingRef.current;
            const chunks = recordedChunksRef.current;

            recorderRef.current = null;
            recordedChunksRef.current = [];
            clearRecordingTimers();
            setIsRecording(false);
            setRecordingSeconds(0);

            if (shouldDiscard || chunks.length === 0) return;

            const finalType = recorder.mimeType?.split(";")[0] || supportedMimeType.split(";")[0] || "video/webm";
            const extension = finalType.includes("mp4") ? "mp4" : "webm";
            const blob = new Blob(chunks, { type: finalType });
            if (blob.size <= 0) return;

            const file = new File([blob], `proof-${Date.now()}.${extension}`, { type: finalType });
            stopStream();
            onCapture(file);
            onClose();
        };

        const startedAt = Date.now();
        recorder.start(250);
        setIsRecording(true);
        setRecordingSeconds(0);

        recordingTickRef.current = window.setInterval(() => {
            const elapsed = Math.min(
                MAX_VIDEO_RECORDING_SECONDS,
                Math.floor((Date.now() - startedAt) / 1000)
            );
            setRecordingSeconds(elapsed);
        }, 200);

        autoStopTimeoutRef.current = window.setTimeout(() => {
            stopRecording(true);
        }, MAX_VIDEO_RECORDING_SECONDS * 1000);
    }, [clearRecordingTimers, onCapture, onClose, ready, stopRecording, stopStream]);

    const toggleVideoRecording = useCallback(() => {
        if (isRecording) {
            stopRecording(true);
            return;
        }
        startVideoRecording();
    }, [isRecording, startVideoRecording, stopRecording]);

    useEffect(() => {
        return () => {
            clearRecordingTimers();
        };
    }, [clearRecordingTimers]);

    const handlePhotoCapture = () => {
        if (isRecording) return;
        setError((prev) => (prev === "video_unsupported" ? null : prev));

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

    const handleSelectPhotoMode = () => {
        if (isRecording) return;
        setCaptureMode("photo");
        setError((prev) => (prev === "video_unsupported" ? null : prev));
    };

    const handleSelectVideoMode = () => {
        if (isRecording) return;
        setCaptureMode("video");
    };

    const handleClose = () => {
        stopStream();
        setError(null);
        setCaptureMode("photo");
        setRecordingSeconds(0);
        onClose();
    };

    const handleFallback = () => {
        stopStream();
        setError(null);
        setCaptureMode("photo");
        setRecordingSeconds(0);
        onClose();
        onFallbackToFilePicker();
    };

    const handleRetry = () => {
        stopStream();
        setReady(false);
        setError(null);
        setCaptureMode("photo");
        setRetryKey((k) => k + 1);
    };

    useEffect(() => {
        if (!open) return;

        let cancelled = false;

        (async () => {
            let stream: MediaStream | null = null;
            try {
                // Use plain `video: true` — no facingMode constraint.
                // `facingMode: "environment"` (rear camera) does not exist on desktop
                // webcams and causes OverconstrainedError/NotFoundError even when
                // the browser has camera permission.
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            } catch {
                stream = null;
            }

            if (cancelled) {
                stream?.getTracks().forEach((t) => t.stop());
                return;
            }

            if (!stream) {
                setError("blocked");
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
    }, [open, retryKey, stopStream]);

    const remainingRecordingSeconds = Math.max(0, MAX_VIDEO_RECORDING_SECONDS - recordingSeconds);

    return (
        <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
            <DialogContent className="max-w-lg p-0 overflow-hidden bg-slate-900 border-slate-800 text-slate-200 [&>[data-slot='dialog-close']]:text-slate-400 [&>[data-slot='dialog-close']]:hover:text-slate-200">
                <div className="px-5 pt-5 pb-4 border-b border-slate-800">
                    <DialogTitle className="text-sm font-semibold text-slate-100">Capture Proof</DialogTitle>
                </div>

                {error === "blocked" ? (
                    <div className="p-5 space-y-4">
                        <div className="flex gap-3 items-start rounded-lg bg-slate-800/60 border border-slate-700 p-3">
                            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                            <div className="space-y-2">
                                <p className="text-sm text-slate-200 font-medium">Camera access blocked</p>
                                {isBrave ? (
                                    <ol className="text-xs text-slate-400 leading-relaxed space-y-1 list-decimal list-inside">
                                        <li>Click the <strong className="text-slate-300">lock icon</strong> in the address bar → Site settings</li>
                                        <li>Set <strong className="text-slate-300">Camera</strong> to <strong className="text-slate-300">Ask</strong>, then back to <strong className="text-slate-300">Allow</strong></li>
                                        <li>Hard-refresh the page <span className="text-slate-500">(⌘⇧R / Ctrl+Shift+R)</span></li>
                                        <li>Click the camera button again and <strong className="text-slate-300">Allow</strong> the prompt</li>
                                    </ol>
                                ) : (
                                    <ol className="text-xs text-slate-400 leading-relaxed space-y-1 list-decimal list-inside">
                                        <li>Click the <strong className="text-slate-300">lock icon</strong> in the address bar</li>
                                        <li>Set <strong className="text-slate-300">Camera</strong> to <strong className="text-slate-300">Allow</strong></li>
                                        <li>Click <strong className="text-slate-300">Try again</strong> below</li>
                                    </ol>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                size="sm"
                                onClick={handleRetry}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white"
                            >
                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                Try again
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleFallback}
                                className="bg-slate-700 hover:bg-slate-600 text-slate-100"
                            >
                                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                                Choose from files instead
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleClose}
                                className="text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div>
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full bg-black"
                            style={{ maxHeight: "60vh", objectFit: "contain" }}
                        />
                        {captureMode === "video" && (
                            <div className="px-4 pt-2 text-xs text-slate-400">
                                {isRecording
                                    ? `Recording… ${recordingSeconds}s / ${MAX_VIDEO_RECORDING_SECONDS}s`
                                    : `Video proof max ${MAX_VIDEO_RECORDING_SECONDS} seconds.`}
                            </div>
                        )}
                        {error === "video_unsupported" && (
                            <div className="px-4 pt-2 text-xs text-amber-300">
                                Video recording is not supported in this browser. You can still upload a video file.
                            </div>
                        )}
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
                            <div className="flex items-center gap-2">
                                <Button
                                    variant={captureMode === "photo" ? "default" : "outline"}
                                    size="sm"
                                    onClick={handleSelectPhotoMode}
                                    disabled={isRecording}
                                    className={captureMode === "photo"
                                        ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                                        : "border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100"}
                                >
                                    <Camera className="mr-1.5 h-3.5 w-3.5" />
                                    Photo
                                </Button>
                                <Button
                                    variant={captureMode === "video" ? "default" : "outline"}
                                    size="sm"
                                    onClick={handleSelectVideoMode}
                                    disabled={isRecording}
                                    className={captureMode === "video"
                                        ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                                        : "border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100"}
                                >
                                    <Video className="mr-1.5 h-3.5 w-3.5" />
                                    Video
                                </Button>
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
                                    onClick={captureMode === "photo" ? handlePhotoCapture : toggleVideoRecording}
                                    disabled={!ready}
                                    className={captureMode === "video" && isRecording
                                        ? "bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40"
                                        : "bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40"}
                                >
                                    {captureMode === "photo" ? (
                                        <>
                                            <Camera className="mr-1.5 h-3.5 w-3.5" />
                                            {ready ? "Capture photo" : "Starting…"}
                                        </>
                                    ) : isRecording ? (
                                        <>
                                            <Square className="mr-1.5 h-3.5 w-3.5" />
                                            {`Stop (${remainingRecordingSeconds}s)`}
                                        </>
                                    ) : (
                                        <>
                                            <Video className="mr-1.5 h-3.5 w-3.5" />
                                            {ready ? "Capture video" : "Starting…"}
                                        </>
                                    )}
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
