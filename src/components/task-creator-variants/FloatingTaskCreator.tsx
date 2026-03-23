"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bell, Camera, Calendar, Check, ChevronDown, Loader2, Plus, Repeat, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";
import { GlassToggle } from "@/components/GlassToggle";
import { createTask } from "@/actions/tasks";
import { toast } from "sonner";
import {
    applyParserKeywordCompletion,
    buildTaskTitleOverlayModel,
    stripRepeatTokens,
    WEEKDAY_TOKEN_REGEX,
} from "@/lib/task-title-parser";
import type { ParserKeywordCompletion } from "@/lib/task-title-parser";
import { stripEventColorTokens } from "@/lib/task-title-event-color";
import {
    defaultDeadline, defaultEnd, defaultStart,
    DEFAULT_REMINDER_MINUTES, EVENT_COLORS, REMINDER_PRESETS,
} from "./shared";

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon → Sun
const WEEKDAY_SHORT: Record<number, string> = { 0: "Su", 1: "Mo", 2: "Tu", 3: "We", 4: "Th", 5: "Fr", 6: "Sa" };

// Font metric classes for pixel-perfect overlay alignment
const TITLE_METRICS = "text-xl font-semibold leading-snug [font-kerning:none] [font-variant-ligatures:none] [font-feature-settings:'liga'_0,'clig'_0]";

type RecurrenceType = "" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    friends?: Profile[];
    selfUserId?: string;
    defaultFailureCost?: number;
}

export interface FloatingTaskCreatorHandle {
    focusTitle: () => void;
}

export const FloatingTaskCreator = forwardRef<FloatingTaskCreatorHandle, Props>(
function FloatingTaskCreator({ isOpen, onClose, friends = [], selfUserId = "", defaultFailureCost = 1 }: Props, ref) {
    const [title, setTitle] = useState("");
    const [titleCaretIndex, setTitleCaretIndex] = useState(0);
    const [isTitleFocused, setIsTitleFocused] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // Subtasks
    const [subtasks, setSubtasks] = useState<string[]>([]);
    const [subtaskDraft, setSubtaskDraft] = useState("");
    const [subtasksOpen, setSubtasksOpen] = useState(false);
    const subtaskInputRef = useRef<HTMLInputElement>(null);

    // Schedule
    const [deadline, setDeadline] = useState(defaultDeadline);
    const [isEvent, setIsEvent] = useState(false);
    const [eventStart, setEventStart] = useState(defaultStart);
    const [eventEnd, setEventEnd] = useState(defaultEnd);
    const [eventColor, setEventColor] = useState<string | null>(null);

    // Stakes
    const [failureCost, setFailureCost] = useState(defaultFailureCost);
    const [costEditing, setCostEditing] = useState(false);
    const [costDraft, setCostDraft] = useState("");
    const costInputRef = useRef<HTMLInputElement>(null);
    const [selectedVoucherId, setSelectedVoucherId] = useState<string>(() => selfUserId);
    const [voucherOpen, setVoucherOpen] = useState(false);
    const voucherRef = useRef<HTMLDivElement>(null);

    // Repeat
    const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("");
    const [customDays, setCustomDays] = useState<number[]>([]);
    const [showCustomDays, setShowCustomDays] = useState(false);

    // Options
    const [requiresProof, setRequiresProof] = useState(false);
    const [activeReminders, setActiveReminders] = useState<Set<number>>(new Set(DEFAULT_REMINDER_MINUTES));
    const [remindersOpen, setRemindersOpen] = useState(false);
    const [repeatOpen, setRepeatOpen] = useState(false);

    // Refs
    const titleRef = useRef<HTMLInputElement>(null);
    const titleHighlightRef = useRef<HTMLDivElement>(null);
    const completionTapInProgressRef = useRef(false);
    const pendingCaretPositionRef = useRef<number | null>(null);
    const pendingTapCompletionRef = useRef<ParserKeywordCompletion | null>(null);
    const isComposingRef = useRef(false);
    const swipeTouchStartY = useRef<number | null>(null);
    const scrollBodyRef = useRef<HTMLDivElement>(null);

    const focusTitleInput = useCallback(() => {
        const input = titleRef.current;
        if (!input) return;
        try {
            input.focus({ preventScroll: true });
        } catch {
            input.focus();
        }
    }, []);

    useImperativeHandle(ref, () => ({
        focusTitle: focusTitleInput,
    }), [focusTitleInput]);

    // ── Overlay model ──────────────────────────────────────────────────────────
    const { titleHighlightSegments, inlineKeywordCompletion, showTitleOverlay } = useMemo(
        () => buildTaskTitleOverlayModel(title, titleCaretIndex, isTitleFocused, false, friends),
        [friends, isTitleFocused, title, titleCaretIndex]
    );

    const syncTitleHighlightScroll = useCallback(() => {
        if (!titleRef.current || !titleHighlightRef.current) return;
        titleHighlightRef.current.scrollLeft = titleRef.current.scrollLeft;
    }, []);

    const syncTitleCaretFromElement = useCallback((input: HTMLInputElement | null) => {
        if (!input) return;
        setTitleCaretIndex(input.selectionStart ?? input.value.length);
    }, []);

    const syncTitleCaretFromInput = useCallback(() => {
        syncTitleCaretFromElement(titleRef.current);
    }, [syncTitleCaretFromElement]);

    const keepTitleTypingInView = useCallback((input: HTMLInputElement | null) => {
        if (!input) return;
        window.requestAnimationFrame(() => {
            syncTitleHighlightScroll();
        });
    }, [syncTitleHighlightScroll]);

    const commitTitleAndCaret = useCallback((nextTitle: string, nextCaretIndex: number) => {
        setTitle(nextTitle);
        setTitleCaretIndex(nextCaretIndex);
        pendingCaretPositionRef.current = nextCaretIndex;
    }, []);

    // Apply pending caret synchronously after DOM update
    useLayoutEffect(() => {
        const pos = pendingCaretPositionRef.current;
        if (pos === null) return;
        pendingCaretPositionRef.current = null;
        const input = titleRef.current;
        if (!input) return;
        focusTitleInput();
        input.setSelectionRange(pos, pos);
        syncTitleCaretFromElement(input);
        syncTitleHighlightScroll();
    }, [focusTitleInput, syncTitleCaretFromElement, syncTitleHighlightScroll, title, titleCaretIndex]);

    useLayoutEffect(() => {
        syncTitleHighlightScroll();
    }, [showTitleOverlay, syncTitleHighlightScroll, title, titleCaretIndex]);

    const applyInlineKeywordCompletion = useCallback(() => {
        if (!inlineKeywordCompletion) return;
        const { nextTitle, nextCaretIndex } = applyParserKeywordCompletion(title, inlineKeywordCompletion);
        commitTitleAndCaret(nextTitle, nextCaretIndex);
    }, [commitTitleAndCaret, inlineKeywordCompletion, title]);

    const handleInlineCompletionPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
        pendingTapCompletionRef.current = inlineKeywordCompletion;
        completionTapInProgressRef.current = true;
        event.preventDefault();
    }, [inlineKeywordCompletion]);

    const handleInlineCompletionTap = useCallback((event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        completionTapInProgressRef.current = false;
        const completion = pendingTapCompletionRef.current ?? inlineKeywordCompletion;
        pendingTapCompletionRef.current = null;
        if (!completion) return;
        const { nextTitle, nextCaretIndex } = applyParserKeywordCompletion(title, completion);
        commitTitleAndCaret(nextTitle, nextCaretIndex);
    }, [commitTitleAndCaret, inlineKeywordCompletion, title]);

    const titleOverlayRuns = useMemo(() => {
        const runs: React.ReactNode[] = [];
        const completionFragmentStart = inlineKeywordCompletion?.fragmentStart ?? -1;
        const completionFragmentEnd =
            inlineKeywordCompletion && inlineKeywordCompletion.fragment.length > 0
                ? completionFragmentStart + inlineKeywordCompletion.fragment.length
                : -1;
        let absoluteIndex = 0;
        let cursorInserted = false;

        const insertCursor = () => { cursorInserted = true; };

        for (const [index, segment] of titleHighlightSegments.entries()) {
            const segmentStart = absoluteIndex;
            const segmentEnd = segmentStart + segment.text.length;
            absoluteIndex = segmentEnd;
            const overlayClassName = segment.style?.color ? undefined : segment.className;

            const splitPoints = [segmentStart, segmentEnd];
            if (completionFragmentStart > segmentStart && completionFragmentStart < segmentEnd) {
                splitPoints.push(completionFragmentStart);
            }
            if (completionFragmentEnd > segmentStart && completionFragmentEnd < segmentEnd) {
                splitPoints.push(completionFragmentEnd);
            }
            if (isTitleFocused && titleCaretIndex > segmentStart && titleCaretIndex < segmentEnd) {
                splitPoints.push(titleCaretIndex);
            }
            splitPoints.sort((a, b) => a - b);

            if (isTitleFocused && !cursorInserted && titleCaretIndex === segmentStart) {
                insertCursor();
            }

            for (let splitIndex = 0; splitIndex < splitPoints.length - 1; splitIndex++) {
                const partStart = splitPoints[splitIndex];
                const partEnd = splitPoints[splitIndex + 1];
                if (partEnd <= partStart) continue;

                const partText = segment.text.slice(partStart - segmentStart, partEnd - segmentStart);
                runs.push(
                    <span key={`${index}-${partStart}`} className={overlayClassName} style={segment.style}>
                        {partText}
                    </span>
                );

                if (isTitleFocused && !cursorInserted && titleCaretIndex === partEnd) {
                    insertCursor();
                }
            }
        }

        if (inlineKeywordCompletion?.suffix) {
            runs.push(
                <span
                    key="inline-keyword-suffix"
                    className="text-slate-500/75 align-baseline pointer-events-auto cursor-pointer"
                    onPointerDown={handleInlineCompletionPointerDown}
                    onClick={handleInlineCompletionTap}
                >
                    {inlineKeywordCompletion.suffix}
                </span>
            );
        }

        if (isTitleFocused && !cursorInserted) {
            insertCursor();
        }

        return runs;
    }, [
        handleInlineCompletionPointerDown,
        handleInlineCompletionTap,
        inlineKeywordCompletion,
        isTitleFocused,
        titleCaretIndex,
        titleHighlightSegments,
    ]);

    // ── Effects ───────────────────────────────────────────────────────────────
    useEffect(() => {
        if (isOpen) {
            setDeadline(defaultDeadline());
            setEventStart(defaultStart());
            setEventEnd(defaultEnd());
            setSelectedVoucherId(selfUserId);
            setActiveReminders(new Set(DEFAULT_REMINDER_MINUTES));
            window.requestAnimationFrame(() => {
                scrollBodyRef.current?.scrollTo({ top: 0, behavior: "auto" });
            });
            const t = setTimeout(() => {
                focusTitleInput();
            }, 260);
            return () => clearTimeout(t);
        }
    }, [focusTitleInput, isOpen, selfUserId]);

    useEffect(() => {
        if (!isOpen) return;

        const body = document.body;
        const html = document.documentElement;
        const scrollY = window.scrollY;
        const previousBodyPosition = body.style.position;
        const previousBodyTop = body.style.top;
        const previousBodyLeft = body.style.left;
        const previousBodyRight = body.style.right;
        const previousBodyWidth = body.style.width;
        const previousBodyOverflow = body.style.overflow;
        const previousHtmlOverflow = html.style.overflow;

        body.style.position = "fixed";
        body.style.top = `-${scrollY}px`;
        body.style.left = "0";
        body.style.right = "0";
        body.style.width = "100%";
        body.style.overflow = "hidden";
        html.style.overflow = "hidden";

        return () => {
            body.style.position = previousBodyPosition;
            body.style.top = previousBodyTop;
            body.style.left = previousBodyLeft;
            body.style.right = previousBodyRight;
            body.style.width = previousBodyWidth;
            body.style.overflow = previousBodyOverflow;
            html.style.overflow = previousHtmlOverflow;
            window.scrollTo(0, scrollY);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!voucherOpen) return;
        const handler = (e: MouseEvent) => {
            if (voucherRef.current && !voucherRef.current.contains(e.target as Node)) {
                setVoucherOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [voucherOpen]);

    // ── Helpers ───────────────────────────────────────────────────────────────
    const addSubtask = () => {
        const t = subtaskDraft.trim();
        if (!t) return;
        setSubtasks((p) => [...p, t]);
        setSubtaskDraft("");
        subtaskInputRef.current?.focus();
    };

    const toggleReminder = (minutes: number) =>
        setActiveReminders((prev) => {
            const next = new Set(prev);
            if (next.has(minutes)) {
                next.delete(minutes);
            } else {
                next.add(minutes);
            }
            return next;
        });

    const handleSubtasksToggle = () => {
        setSubtasksOpen((p) => {
            if (!p) setTimeout(() => subtaskInputRef.current?.focus(), 200);
            return !p;
        });
    };

    const toggleCustomDay = (day: number) => {
        setCustomDays((prev) => {
            const next = prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day];
            return next.length > 0 ? next : [day];
        });
    };

    // Strip parser keyword tokens from title to get clean task name
    const stripMetadata = (text: string) => {
        const withoutStandardTokens = text
            .replace(/(^|\s)@(?:\d{1,2}:\d{2}|\d{3,4}|\d{1,2})\b/g, "$1")
            .replace(/(?:^|\s)-start\s*(?:\d{1,2}:\d{2}|\d{1,4})\b/gi, " ")
            .replace(/(?:^|\s)-end\s*(?:\d{1,2}:\d{2}|\d{1,4})\b/gi, " ")
            .replace(/\b([12]?\d|3[01])(?:st|nd|rd|th)\b/gi, "")
            .replace(/\b(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])(?:\/\d{4})?\b/g, "")
            .replace(/(^|\s)remind@(?:\d{1,2}:\d{2}|\d{1,4})\b/gi, "$1")
            .replace(/\b(?:tmrw|tomorrow)\b/gi, "")
            .replace(new RegExp(WEEKDAY_TOKEN_REGEX.source, "gi"), "")
            .replace(/(?:\bvouch|\.v)\s+[^\s/]+/gi, "")
            .replace(/(?:^|\s)-proof(?=\s|$)/gi, " ")
            .replace(/\bpomo\s+\d+\b/gi, "")
            .replace(/\btimer\s+\d+\b/gi, "")
            .replace(/\s+/g, " ")
            .trim();
        return stripRepeatTokens(stripEventColorTokens(withoutStandardTokens));
    };

    // Parse a datetime-local string ("YYYY-MM-DDTHH:mm") as local time
    const parseDateTimeLocal = (s: string): Date => {
        const [datePart, timePart] = s.split("T");
        const [year, month, day] = datePart.split("-").map(Number);
        const [hours, minutes] = timePart.split(":").map(Number);
        return new Date(year, month - 1, day, hours, minutes, 0, 0);
    };

    const reset = () => {
        setTitle(""); setTitleCaretIndex(0); setIsTitleFocused(false);
        setSubtasks([]); setSubtaskDraft(""); setSubtasksOpen(false);
        setIsEvent(false); setEventColor(null); setRequiresProof(false);
        setRecurrenceType(""); setCustomDays([]); setShowCustomDays(false);
        setFailureCost(defaultFailureCost);
        setActiveReminders(new Set(DEFAULT_REMINDER_MINUTES));
        setSelectedVoucherId(selfUserId); setVoucherOpen(false);
        setRemindersOpen(false); setRepeatOpen(false);
        setCostEditing(false);
    };

    const handleClose = () => { reset(); onClose(); };

    const handleSubmit = async () => {
        const cleanTitle = stripMetadata(title).trim();
        if (!cleanTitle || isLoading) { titleRef.current?.focus(); return; }

        const deadlineDate = parseDateTimeLocal(deadline);
        const now = Date.now();

        // Build reminder ISO strings (minutes before deadline)
        const reminderIsos: string[] = [];
        for (const minutes of activeReminders) {
            const reminderTime = new Date(deadlineDate.getTime() - minutes * 60 * 1000);
            if (reminderTime.getTime() > now) {
                reminderIsos.push(reminderTime.toISOString());
            }
        }

        setIsLoading(true);
        try {
            const formData = new FormData();
            formData.append("title", cleanTitle);
            formData.append("rawTitle", title);
            formData.append("deadline", deadlineDate.toISOString());

            if (isEvent) {
                formData.append("eventStartIso", parseDateTimeLocal(eventStart).toISOString());
                formData.append("eventEndIso", parseDateTimeLocal(eventEnd).toISOString());
            }

            formData.append("voucherId", selectedVoucherId);
            formData.append("failureCost", failureCost.toFixed(2));

            if (subtasks.length > 0) {
                formData.append("subtasks", JSON.stringify(subtasks));
            }

            formData.append("requiresProof", requiresProof ? "true" : "false");

            if (reminderIsos.length > 0) {
                formData.append("reminders", JSON.stringify(reminderIsos));
            }

            if (recurrenceType) {
                formData.append("recurrenceType", recurrenceType);
                formData.append("userTimezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
                formData.append("recurrenceInterval", "1");
                if (recurrenceType === "WEEKLY" && customDays.length > 0) {
                    formData.append("recurrenceDays", JSON.stringify(customDays));
                }
            }

            const result = await createTask(formData);
            if (result?.error) {
                toast.error("Failed to create task");
                console.error("Failed to create task", result.error);
            } else {
                toast.success("Task created");
                handleClose();
            }
        } catch (error) {
            toast.error("Failed to create task");
            console.error("Failed to create task", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        syncTitleCaretFromInput();

        const isComposing = isComposingRef.current || e.nativeEvent.isComposing;
        if (isComposing && (e.key === "Enter" || e.key === "Tab")) {
            return;
        }

        if (e.key === "Tab" && inlineKeywordCompletion) {
            e.preventDefault();
            applyInlineKeywordCompletion();
            return;
        }

        if (e.key !== "Enter") return;
        e.preventDefault();
        handleSubmit();
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className={cn(
                    "fixed inset-0 z-40 transition-opacity duration-300 bg-black/70",
                    isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={handleClose}
            />

            {/* Sheet */}
            <div
                className={cn(
                    "fixed bottom-0 left-0 right-0 z-50 flex flex-col",
                    "rounded-t-2xl max-h-[88dvh] backdrop-blur-xl",
                    "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    isOpen ? "translate-y-0" : "translate-y-[calc(100%+8px)]",
                )}
                onTouchStart={(e) => { swipeTouchStartY.current = e.touches[0].clientY; }}
                onTouchEnd={(e) => {
                    if (swipeTouchStartY.current === null) return;
                    const delta = e.changedTouches[0].clientY - swipeTouchStartY.current;
                    swipeTouchStartY.current = null;
                    if (delta > 60) handleClose();
                }}
                style={{
                    background: "rgba(2, 6, 23, 0.50)",
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    boxShadow: "0 -8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
            >
                {/* Drag handle — tap to close */}
                <div className="flex justify-center pt-3 pb-1 shrink-0 cursor-pointer" onClick={handleClose}>
                    <div className="w-10 h-[3px] rounded-full bg-slate-700" />
                </div>

                {/* Scrollable body */}
                <div ref={scrollBodyRef} className="overflow-y-auto flex-1 px-5 pb-6">

                    {/* ── Title + Subtasks ── */}
                    <div
                        className="py-5 space-y-3"
                        onClick={(e) => {
                            if ((e.target as HTMLElement).closest("input,button")) return;
                            handleSubtasksToggle();
                        }}
                    >
                        {/* Title input with overlay */}
                        <div className="relative">
                            {showTitleOverlay && (
                                <div
                                    ref={titleHighlightRef}
                                    aria-hidden="true"
                                    className={cn(
                                        "pointer-events-none absolute inset-0 overflow-hidden text-white flex items-center",
                                        TITLE_METRICS
                                    )}
                                >
                                    <span className="whitespace-pre">{titleOverlayRuns}</span>
                                </div>
                            )}
                            <input
                                ref={titleRef}
                                type="text"
                                value={title}
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                onChange={(e) => {
                                    setTitle(e.currentTarget.value);
                                    syncTitleCaretFromElement(e.currentTarget);
                                    keepTitleTypingInView(e.currentTarget);
                                }}
                                onKeyDown={handleTitleKeyDown}
                                onSelect={() => {
                                    syncTitleCaretFromInput();
                                    keepTitleTypingInView(titleRef.current);
                                }}
                                onClick={() => {
                                    syncTitleCaretFromInput();
                                    keepTitleTypingInView(titleRef.current);
                                }}
                                onFocus={() => {
                                    completionTapInProgressRef.current = false;
                                    setIsTitleFocused(true);
                                    syncTitleCaretFromInput();
                                    keepTitleTypingInView(titleRef.current);
                                }}
                                onBlur={() => {
                                    if (completionTapInProgressRef.current) return;
                                    setIsTitleFocused(false);
                                }}
                                onCompositionStart={() => {
                                    isComposingRef.current = true;
                                }}
                                onCompositionEnd={(e) => {
                                    isComposingRef.current = false;
                                    syncTitleCaretFromElement(e.currentTarget);
                                    keepTitleTypingInView(e.currentTarget);
                                }}
                                onScroll={syncTitleHighlightScroll}
                                placeholder="What needs to get done?"
                                enterKeyHint="done"
                                className={cn(
                                    "w-full bg-transparent placeholder:text-slate-700 focus:outline-none",
                                    TITLE_METRICS,
                                    showTitleOverlay ? "text-transparent caret-white" : "text-slate-50 caret-white",
                                )}
                            />
                        </div>

                        {/* Subtasks toggle */}
                        <button
                            onClick={handleSubtasksToggle}
                            className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-slate-600 hover:text-slate-400 transition-colors"
                        >
                            <Plus className={cn("h-3 w-3 transition-transform duration-200", subtasksOpen && "rotate-45")} />
                            {subtasks.length > 0 ? `${subtasks.length} subtask${subtasks.length > 1 ? "s" : ""}` : "Add subtasks"}
                        </button>

                        {/* Subtasks expansion */}
                        <div className={cn(
                            "overflow-hidden transition-[max-height] duration-300 ease-in-out",
                            subtasksOpen ? "max-h-[300px]" : "max-h-0",
                        )}>
                            <div className="pt-1 space-y-2 pl-1">
                                {subtasks.map((s, i) => (
                                    <div key={i} className="flex items-center gap-2.5">
                                        <div className="h-[14px] w-[14px] rounded-full border border-slate-700 shrink-0" />
                                        <span className="flex-1 text-sm text-slate-400 font-mono">{s}</span>
                                        <button
                                            onClick={() => setSubtasks((p) => p.filter((_, j) => j !== i))}
                                            className="text-slate-700 hover:text-red-400 transition-colors"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ))}
                                <div className="flex items-center gap-2.5">
                                    <div className="h-[14px] w-[14px] rounded-full border border-dashed border-slate-800 shrink-0" />
                                    <input
                                        ref={subtaskInputRef}
                                        value={subtaskDraft}
                                        onChange={(e) => setSubtaskDraft(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubtask(); } }}
                                        placeholder="New subtask…"
                                        className="flex-1 bg-transparent text-sm font-mono text-slate-400 placeholder:text-slate-800 focus:outline-none"
                                    />
                                    {subtaskDraft.trim() && (
                                        <button onClick={addSubtask} className="text-[#00d9ff] hover:opacity-80 transition-opacity">
                                            <Plus className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Deadline ── */}
                    <Divider>
                        <Row
                            label="Deadline"
                            icon={<Calendar className="h-4 w-4 text-amber-400" />}
                        >
                            <input
                                type="datetime-local"
                                value={deadline}
                                onChange={(e) => setDeadline(e.target.value)}
                                className="bg-transparent text-amber-400 text-sm focus:outline-none font-mono deadline-input"
                            />
                        </Row>
                    </Divider>

                    {/* ── Reminders + Repeat (2-col) ── */}
                    <Divider>
                        {/* Header row */}
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setRemindersOpen((p) => !p)}
                                className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-left",
                                    remindersOpen
                                        ? "bg-amber-400/10 border border-amber-400/20"
                                        : "bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800"
                                )}
                            >
                                <Bell className={cn("h-3.5 w-3.5 shrink-0", remindersOpen ? "text-amber-400" : "text-slate-500")} />
                                <span className={cn("text-xs font-mono", remindersOpen ? "text-amber-400" : "text-slate-500")}>
                                    Reminders{activeReminders.size > 0 && ` · ${activeReminders.size}`}
                                </span>
                            </button>
                            <button
                                onClick={() => setRepeatOpen((p) => !p)}
                                className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-left",
                                    repeatOpen
                                        ? "bg-purple-400/10 border border-purple-400/20"
                                        : "bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800"
                                )}
                            >
                                <Repeat className={cn("h-3.5 w-3.5 shrink-0", repeatOpen ? "text-purple-400" : "text-slate-500")} />
                                <span className={cn("text-xs font-mono", repeatOpen ? "text-purple-400" : "text-slate-500")}>
                                    {recurrenceType && !showCustomDays
                                        ? recurrenceType.charAt(0) + recurrenceType.slice(1).toLowerCase()
                                        : showCustomDays ? "Custom" : "Repeat"}
                                </span>
                            </button>
                        </div>

                        {/* Reminder options */}
                        <div
                            className={cn(
                                "overflow-hidden transition-[max-height] duration-300 ease-in-out",
                                remindersOpen ? "max-h-[60px]" : "max-h-0"
                            )}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex flex-wrap gap-1.5 pt-2">
                                {REMINDER_PRESETS.map((r) => (
                                    <button
                                        key={r.minutes}
                                        onClick={() => toggleReminder(r.minutes)}
                                        className={cn(
                                            "px-2.5 py-1 text-xs font-mono uppercase tracking-[0.08em] rounded-md border transition-all",
                                            activeReminders.has(r.minutes)
                                                ? "bg-amber-400/10 border-amber-400/25 text-amber-400"
                                                : "bg-slate-800/60 border-slate-700/50 text-slate-600 hover:text-slate-400"
                                        )}
                                    >
                                        {r.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Repeat options */}
                        <div
                            className={cn(
                                "overflow-hidden transition-[max-height] duration-300 ease-in-out",
                                repeatOpen ? "max-h-[120px]" : "max-h-0"
                            )}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="space-y-2 pt-2">
                                <div className="flex flex-wrap gap-1.5">
                                    {(["", "DAILY", "WEEKLY", "MONTHLY"] as RecurrenceType[]).map((type) => {
                                        const label = type === "" ? "None" : type === "DAILY" ? "Daily" : type === "WEEKLY" ? "Weekly" : "Monthly";
                                        const isActive = recurrenceType === type && !showCustomDays;
                                        return (
                                            <button
                                                key={type}
                                                onClick={() => { setRecurrenceType(type); setShowCustomDays(false); }}
                                                className={cn(
                                                    "px-2.5 py-1 text-xs font-mono uppercase tracking-[0.08em] rounded-md border transition-all",
                                                    isActive
                                                        ? "bg-purple-400/10 border-purple-400/25 text-purple-400"
                                                        : "bg-slate-800/60 border-slate-700/50 text-slate-600 hover:text-slate-400"
                                                )}
                                            >
                                                {label}
                                            </button>
                                        );
                                    })}
                                    <button
                                        onClick={() => {
                                            setRecurrenceType("WEEKLY");
                                            setShowCustomDays((p) => !p);
                                            if (customDays.length === 0) setCustomDays([new Date().getDay()]);
                                        }}
                                        className={cn(
                                            "flex items-center gap-1 px-2.5 py-1 text-xs font-mono uppercase tracking-[0.08em] rounded-md border transition-all",
                                            showCustomDays
                                                ? "bg-purple-400/10 border-purple-400/25 text-purple-400"
                                                : "bg-slate-800/60 border-slate-700/50 text-slate-600 hover:text-slate-400"
                                        )}
                                    >
                                        <Repeat className="h-3 w-3" />
                                        Custom
                                    </button>
                                </div>
                                <div className={cn(
                                    "overflow-hidden transition-[max-height] duration-200 ease-in-out",
                                    showCustomDays ? "max-h-[48px]" : "max-h-0"
                                )}>
                                    <div className="flex gap-1.5 pt-1">
                                        {WEEKDAY_ORDER.map((day) => {
                                            const isSelected = customDays.includes(day);
                                            return (
                                                <button
                                                    key={day}
                                                    onClick={() => toggleCustomDay(day)}
                                                    className={cn(
                                                        "h-7 w-7 rounded-lg text-[10px] font-mono font-semibold transition-colors",
                                                        isSelected
                                                            ? "bg-purple-500/20 border border-purple-400/40 text-purple-300"
                                                            : "bg-slate-800 border border-slate-700 text-slate-500 hover:text-slate-300"
                                                    )}
                                                >
                                                    {WEEKDAY_SHORT[day]}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Divider>

                    {/* ── Stakes ── */}
                    <Divider>
                        <Row
                            label="Voucher"
                            icon={<span className="text-blue-300 text-sm leading-none">◎</span>}
                        >
                            <div ref={voucherRef} className="relative">
                                <button
                                    onClick={() => setVoucherOpen((p) => !p)}
                                    className="flex items-center gap-1.5 text-slate-300 text-sm font-mono transition-colors hover:text-slate-100"
                                >
                                    <span className="truncate max-w-[120px]">
                                        {selectedVoucherId === selfUserId
                                            ? "Myself"
                                            : (friends.find((f) => f.id === selectedVoucherId)?.username ||
                                               friends.find((f) => f.id === selectedVoucherId)?.email ||
                                               "Myself")}
                                    </span>
                                    <ChevronDown
                                        className={cn("h-[18px] w-[18px] shrink-0 transition-transform text-blue-300", voucherOpen && "rotate-180")}
                                        style={{ filter: "drop-shadow(0 0 5px rgba(147, 197, 253, 0.8))" }}
                                    />
                                </button>

                                {voucherOpen && (
                                    <div className="absolute right-0 bottom-full mb-1.5 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-xl overflow-hidden z-10">
                                        <button
                                            onClick={() => { setSelectedVoucherId(selfUserId); setVoucherOpen(false); }}
                                            className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-mono text-slate-300 hover:bg-slate-800 transition-colors"
                                        >
                                            Myself
                                            {selectedVoucherId === selfUserId && <Check className="h-3 w-3 text-blue-300" />}
                                        </button>
                                        {friends.length > 0 && (
                                            <div className="border-t border-slate-800">
                                                {friends.map((f) => (
                                                    <button
                                                        key={f.id}
                                                        onClick={() => { setSelectedVoucherId(f.id); setVoucherOpen(false); }}
                                                        className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-mono text-slate-300 hover:bg-slate-800 transition-colors"
                                                    >
                                                        <span className="truncate">{f.username || f.email}</span>
                                                        {selectedVoucherId === f.id && <Check className="h-3 w-3 text-blue-300 shrink-0" />}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </Row>
                        <Row
                            label="Failure cost"
                            icon={<span className="text-emerald-400 font-mono text-sm leading-none">€</span>}
                        >
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setFailureCost((v) => Math.max(1, Math.round((v - 0.5) * 2) / 2))}
                                    className="text-emerald-400 font-mono text-[1.5rem] leading-none transition-opacity hover:opacity-70"
                                    style={{ textShadow: "0 0 8px rgba(52, 211, 153, 0.7)" }}
                                >
                                    ‹
                                </button>
                                {costEditing ? (
                                    <input
                                        ref={costInputRef}
                                        type="number"
                                        value={costDraft}
                                        onChange={(e) => setCostDraft(e.target.value)}
                                        onBlur={() => {
                                            const n = parseFloat(costDraft);
                                            if (!isNaN(n)) setFailureCost(Math.min(100, Math.max(1, Math.round(n * 2) / 2)));
                                            setCostEditing(false);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                                        }}
                                        className="w-16 bg-transparent text-emerald-400 text-sm font-mono focus:outline-none text-center tabular-nums"
                                    />
                                ) : (
                                    <button
                                        onClick={() => { setCostDraft(failureCost.toFixed(2)); setCostEditing(true); setTimeout(() => costInputRef.current?.select(), 10); }}
                                        className="text-emerald-400 text-sm font-mono tabular-nums hover:text-emerald-300 transition-colors"
                                    >
                                        €{failureCost.toFixed(2)}
                                    </button>
                                )}
                                <button
                                    onClick={() => setFailureCost((v) => Math.min(100, Math.round((v + 0.5) * 2) / 2))}
                                    className="text-emerald-400 font-mono text-[1.5rem] leading-none transition-opacity hover:opacity-70"
                                    style={{ textShadow: "0 0 8px rgba(52, 211, 153, 0.7)" }}
                                >
                                    ›
                                </button>
                            </div>
                        </Row>
                    </Divider>

                    {/* ── Options (Proof + Is Event) ── */}
                    <Divider>
                        <Row
                            label="Require proof"
                            icon={<Camera className="h-4 w-4 text-blue-300" />}
                        >
                            <GlassToggle checked={requiresProof} onChange={setRequiresProof} />
                        </Row>

                        <Row
                            label="Is Event"
                            icon={<span className="text-[#00d9ff] text-xs font-mono">◈</span>}
                        >
                            <GlassToggle checked={isEvent} onChange={setIsEvent} />
                        </Row>

                        {/* Event-only fields */}
                        <div className={cn(
                            "overflow-hidden transition-[max-height] duration-300 ease-in-out",
                            isEvent ? "max-h-[260px]" : "max-h-0",
                        )}>
                            <div className="space-y-3 pt-2">
                                <Row label="Start" icon={<span className="text-slate-600 text-xs font-mono">▶</span>}>
                                    <input
                                        type="datetime-local"
                                        value={eventStart}
                                        onChange={(e) => setEventStart(e.target.value)}
                                        className="bg-transparent text-slate-300 text-sm focus:outline-none font-mono"
                                    />
                                </Row>
                                <Row label="End" icon={<span className="text-slate-600 text-xs font-mono">■</span>}>
                                    <input
                                        type="datetime-local"
                                        value={eventEnd}
                                        onChange={(e) => setEventEnd(e.target.value)}
                                        className="bg-transparent text-slate-300 text-sm focus:outline-none font-mono"
                                    />
                                </Row>
                                <div>
                                    <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-700 mb-2.5">Event colour</p>
                                    <div className="flex flex-wrap gap-2">
                                        {EVENT_COLORS.map((c) => (
                                            <button
                                                key={c.hex}
                                                onClick={() => setEventColor(eventColor === c.hex ? null : c.hex)}
                                                title={c.label}
                                                style={{
                                                    backgroundColor: c.hex,
                                                    boxShadow: eventColor === c.hex
                                                        ? `0 0 0 2px #020617, 0 0 0 4px ${c.hex}, 0 0 10px ${c.hex}88`
                                                        : undefined,
                                                }}
                                                className={cn(
                                                    "h-7 w-7 rounded-full border border-transparent transition-all duration-150",
                                                    eventColor === c.hex ? "scale-110" : "opacity-60 hover:opacity-100",
                                                )}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Divider>

                    {/* ── Actions ── */}
                    <div className="flex gap-3 mt-2">
                        <button
                            onClick={handleClose}
                            disabled={isLoading}
                            style={{
                                border: "1px solid rgba(239, 68, 68, 0.35)",
                                background: "rgba(239, 68, 68, 0.07)",
                                fontFamily: "'DM Mono', ui-monospace, monospace",
                                color: "#f87171",
                            }}
                            className="flex-1 font-medium py-4 rounded-xl text-xs uppercase tracking-[0.12em] transition-all active:opacity-70 disabled:opacity-40"
                            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)"; e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.55)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239, 68, 68, 0.07)"; e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.35)"; }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={isLoading}
                            style={{
                                border: "1px solid rgba(0, 217, 255, 0.35)",
                                background: "rgba(0, 217, 255, 0.07)",
                                fontFamily: "'DM Mono', ui-monospace, monospace",
                                color: "#00d9ff",
                            }}
                            className="flex-1 font-medium py-4 rounded-xl text-xs uppercase tracking-[0.12em] transition-all active:opacity-70 disabled:opacity-40 flex items-center justify-center gap-2"
                            onMouseEnter={(e) => { if (!isLoading) { e.currentTarget.style.background = "rgba(0, 217, 255, 0.12)"; e.currentTarget.style.borderColor = "rgba(0, 217, 255, 0.55)"; } }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0, 217, 255, 0.07)"; e.currentTarget.style.borderColor = "rgba(0, 217, 255, 0.35)"; }}
                        >
                            {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {isLoading ? "Creating…" : "Commit"}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
});

/* ── Section divider (no label) ── */
function Divider({ children }: { children: React.ReactNode }) {
    return (
        <div className="py-4 space-y-3">
            {children}
        </div>
    );
}

/* ── Label + control row ── */
function Row({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
                <span className="shrink-0 flex items-center justify-center w-5 h-5">{icon}</span>
                <span className="text-sm text-slate-400 truncate">{label}</span>
            </div>
            {children}
        </div>
    );
}
