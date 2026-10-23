import { Fragment } from "react";
import { splitTitleLinks } from "@/lib/task-title-parser";
import { cn } from "@/lib/utils";

/** Renders text with any URLs shown in full as clickable links. */
export function LinkifiedText({ text, linkClassName }: { text: string; linkClassName?: string }) {
    const segments = splitTitleLinks(text);
    if (!segments.some((segment) => segment.type === "link")) return <>{text}</>;
    return (
        <>
            {segments.map((segment, index) =>
                segment.type === "link" ? (
                    <a
                        key={index}
                        href={segment.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        className={cn("text-sky-400 underline decoration-sky-400/40 underline-offset-2 hover:decoration-sky-400", linkClassName)}
                    >
                        {segment.value}
                    </a>
                ) : (
                    <Fragment key={index}>{segment.value}</Fragment>
                )
            )}
        </>
    );
}
