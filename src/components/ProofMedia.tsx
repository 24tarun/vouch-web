"use client";

import type { ImgHTMLAttributes, VideoHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { normalizeProofTimestampText } from "@/lib/proof-timestamp";

type SharedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "className">;
type SharedVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src" | "className">;

interface ProofMediaProps {
    mediaKind: "image" | "video";
    src: string;
    alt: string;
    overlayTimestampText?: string | null;
    wrapperClassName?: string;
    imageClassName?: string;
    videoClassName?: string;
    imageProps?: SharedImageProps;
    videoProps?: SharedVideoProps;
}

export function ProofMedia({
    mediaKind,
    src,
    alt,
    overlayTimestampText,
    wrapperClassName,
    imageClassName,
    videoClassName,
    imageProps,
    videoProps,
}: ProofMediaProps) {
    const overlayText = normalizeProofTimestampText(overlayTimestampText);
    const overlayClassName = mediaKind === "video"
        ? "bottom-14 right-3 md:bottom-16"
        : "bottom-2.5 right-2.5 md:bottom-3 md:right-3";

    return (
        <div className={cn("relative inline-block overflow-hidden", wrapperClassName)}>
            {mediaKind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={src}
                    alt={alt}
                    className={imageClassName}
                    {...imageProps}
                />
            ) : (
                <video
                    src={src}
                    className={videoClassName}
                    {...videoProps}
                />
            )}

            <div
                className={cn(
                    "pointer-events-none absolute select-none font-mono text-[11px] font-semibold tracking-[0.12em] text-[#ffb347]",
                    "[text-shadow:0_0_2px_rgba(255,179,71,0.55),1px_1px_0_rgba(104,49,0,0.95)]",
                    overlayClassName
                )}
                aria-label={`Proof timestamp ${overlayText}`}
            >
                {overlayText}
            </div>
        </div>
    );
}
