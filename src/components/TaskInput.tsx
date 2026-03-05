"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createTask } from "@/actions/tasks";
import { Calendar, Check, Loader2, Repeat, User } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";
import { getCurrencySymbol, getFailureCostBounds, type SupportedCurrency } from "@/lib/currency";
import { DEFAULT_EVENT_DURATION_MINUTES } from "@/lib/constants";
import { parseClockToken, resolveEventSchedule } from "@/lib/task-title-event-time";
import {
    GOOGLE_EVENT_COLOR_OPTIONS,
    extractEventColorMatches,
    findNearestColorHelperToken,
    replaceNearestColorHelperToken,
    stripEventColorTokens,
    validateEventColorUsage,
} from "@/lib/task-title-event-color";
import { toast } from "sonner";
import {
    fromDateTimeLocalValue,
    toDateTimeLocalValue,
} from "@/lib/datetime-local";

const EVENT_TOKEN_REGEX = /(^|\s)-event(?=\s|$)/i;
const TIME_TOKEN_REGEX = /@(\d{1,2}:\d{2}|\d{3,4}|\d{1,2})\b/i;
const ORDINAL_DATE_TOKEN_REGEX = /\b([12]?\d|3[01])(st|nd|rd|th)\b/gi;
const SLASH_DATE_TOKEN_REGEX = /\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])(?:\/(\d{4}))?\b/g;
const HIGHLIGHT_EVENT_TOKEN_REGEX = /(^|\s)(-event)(?=\s|$)/gi;
const HIGHLIGHT_TIME_TOKEN_REGEX = /@(\d{1,2}:\d{2}|\d{3,4}|\d{1,2})\b/g;
const HIGHLIGHT_EVENT_START_TOKEN_REGEX = /(^|\s)(-start\s*(\d{1,2}:\d{2}|\d{1,4}))\b/gi;
const HIGHLIGHT_EVENT_END_TOKEN_REGEX = /(^|\s)(-end\s*(\d{1,2}:\d{2}|\d{1,4}))\b/gi;
const HIGHLIGHT_EVENT_COLOR_HELPER_TOKEN_REGEX = /(^|\s)(-color)(?=\s|$)/gi;
const HIGHLIGHT_TIMER_TOKEN_REGEX = /\b(timer)\s+(\d+)\b/gi;
const HIGHLIGHT_POMO_TOKEN_REGEX = /\b(pomo)\s+(\d+)\b/gi;
const HIGHLIGHT_REMIND_TOKEN_REGEX = /\b(remind)\s+(\d{1,2}:\d{2}|\d{4})\b/gi;
const HIGHLIGHT_TOMORROW_TOKEN_REGEX = /\b(tmrw|tomorrow)\b/gi;
const HIGHLIGHT_VOUCH_TOKEN_REGEX = /(^|\s)(vouch|\.v)\s+(me|self|myself|\w+)\b/gi;
const HIGHLIGHT_ORDINAL_DATE_TOKEN_REGEX = /\b([12]?\d|3[01])(st|nd|rd|th)\b/gi;
const HIGHLIGHT_SLASH_DATE_TOKEN_REGEX = /\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])(?:\/(\d{4}))?\b/g;
const VALUE_EXPECTING_KEYWORDS = new Set(["-start", "-end", "-color", "remind", "timer", "pomo", "vouch", ".v"]);
const COLOR_COMPLETION_TOKENS = [
    ...GOOGLE_EVENT_COLOR_OPTIONS.map((option) => option.aliasToken),
    ...GOOGLE_EVENT_COLOR_OPTIONS.map((option) => option.nativeToken),
    "-lightgreen",
    "-light-green",
    "-lightblue",
    "-light-blue",
];
const PARSER_KEYWORD_COMPLETION_TOKENS = Array.from(new Set([
    "-event",
    "-start",
    "-end",
    "-color",
    "remind",
    "timer",
    "pomo",
    "vouch",
    ".v",
    "tmrw",
    "tomorrow",
    ...COLOR_COMPLETION_TOKENS,
]));

interface TitleHighlightSegment {
    text: string;
    className: string;
    style?: CSSProperties;
}

interface ParserKeywordCompletion {
    fragmentStart: number;
    fragment: string;
    suggestion: string;
    suffix: string;
    insertText: string;
}

function parseTimeToken(token: string, allowHourOnly: boolean) {
    const normalized = token.trim();
    let hours = Number.NaN;
    let minutes = Number.NaN;

    const colonMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (colonMatch) {
        hours = Number.parseInt(colonMatch[1], 10);
        minutes = Number.parseInt(colonMatch[2], 10);
    } else {
        const compactFourMatch = normalized.match(/^(\d{4})$/);
        if (compactFourMatch) {
            hours = Number.parseInt(compactFourMatch[1].slice(0, 2), 10);
            minutes = Number.parseInt(compactFourMatch[1].slice(2, 4), 10);
        } else {
            const compactThreeMatch = normalized.match(/^(\d{3})$/);
            if (compactThreeMatch) {
                hours = Number.parseInt(compactThreeMatch[1].slice(0, 1), 10);
                minutes = Number.parseInt(compactThreeMatch[1].slice(1, 3), 10);
            } else if (allowHourOnly) {
                const hourOnlyMatch = normalized.match(/^(\d{1,2})$/);
                if (hourOnlyMatch) {
                    hours = Number.parseInt(hourOnlyMatch[1], 10);
                    minutes = 0;
                }
            }
        }
    }

    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return { hours, minutes };
}

function parseTimerMinutesToken(text: string): number | null {
    const match = text.match(/\btimer\s+(\d+)\b/i);
    if (!match) return null;

    const parsed = Number.parseInt(match[1], 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) return null;
    return parsed;
}

const TOMORROW_KEYWORD_REGEX = /\b(?:tmrw|tomorrow)\b/i;

type ParsedDateToken =
    | { kind: "ordinal"; day: number; index: number }
    | { kind: "slash"; day: number; month: number; year: number | null; index: number };

function isValidCalendarDate(year: number, month: number, day: number): boolean {
    const candidate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    return (
        candidate.getUTCFullYear() === year &&
        candidate.getUTCMonth() + 1 === month &&
        candidate.getUTCDate() === day
    );
}

function parseDateTokens(text: string): ParsedDateToken[] {
    const tokens: ParsedDateToken[] = [];

    const ordinalRegex = new RegExp(ORDINAL_DATE_TOKEN_REGEX.source, "gi");
    let ordinalMatch: RegExpExecArray | null;
    while ((ordinalMatch = ordinalRegex.exec(text)) !== null) {
        const parsedDay = Number.parseInt(ordinalMatch[1], 10);
        if (parsedDay >= 1 && parsedDay <= 31) {
            tokens.push({
                kind: "ordinal",
                day: parsedDay,
                index: ordinalMatch.index,
            });
        }
    }

    const slashRegex = new RegExp(SLASH_DATE_TOKEN_REGEX.source, "g");
    let slashMatch: RegExpExecArray | null;
    while ((slashMatch = slashRegex.exec(text)) !== null) {
        const parsedDay = Number.parseInt(slashMatch[1], 10);
        const parsedMonth = Number.parseInt(slashMatch[2], 10);
        const parsedYear = slashMatch[3] ? Number.parseInt(slashMatch[3], 10) : null;
        tokens.push({
            kind: "slash",
            day: parsedDay,
            month: parsedMonth,
            year: parsedYear,
            index: slashMatch.index,
        });
    }

    return tokens.sort((a, b) => a.index - b.index);
}

function getDefaultDeadline(now: Date = new Date()): Date {
    const deadline = new Date(now);
    deadline.setHours(23, 59, 0, 0);
    if (deadline.getTime() <= now.getTime()) {
        deadline.setDate(deadline.getDate() + 1);
    }
    return deadline;
}

function formatTimeUntilDeadline(deadline: Date, now: Date = new Date()): string {
    const diffMs = deadline.getTime() - now.getTime();
    const totalMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));
    const days = Math.floor(totalMinutes / (24 * 60));
    const remainingAfterDays = totalMinutes % (24 * 60);
    const hours = Math.floor(remainingAfterDays / 60);
    const minutes = remainingAfterDays % 60;
    const parts: string[] = [];

    if (days > 0) {
        parts.push(`${days} ${days === 1 ? "day" : "days"}`);
    }
    if (hours > 0) {
        parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
    }
    if (minutes > 0 || parts.length === 0) {
        parts.push(`${minutes} ${minutes === 1 ? "min" : "mins"}`);
    }

    return `${parts.join(" ")} until deadline`;
}

function buildTitleHighlightSegments(text: string): TitleHighlightSegment[] {
    if (!text) return [{ text: "", className: "text-white" }];

    const classNames = Array<string>(text.length).fill("text-white");
    const inlineStyles = Array<CSSProperties | undefined>(text.length).fill(undefined);
    const applyKeywordRange = (start: number, end: number) => {
        const clampedStart = Math.max(0, start);
        const clampedEnd = Math.min(text.length, end);
        for (let index = clampedStart; index < clampedEnd; index += 1) {
            if (classNames[index] === "text-white") {
                classNames[index] = "text-orange-400";
            }
        }
    };
    const applyColorRange = (start: number, end: number, colorHex: string) => {
        const clampedStart = Math.max(0, start);
        const clampedEnd = Math.min(text.length, end);
        for (let index = clampedStart; index < clampedEnd; index += 1) {
            classNames[index] = "";
            inlineStyles[index] = { color: colorHex };
        }
    };

    const isEventTask = EVENT_TOKEN_REGEX.test(text);

    for (const match of text.matchAll(HIGHLIGHT_EVENT_TOKEN_REGEX)) {
        if (!match[2]) continue;
        const start = (match.index ?? 0) + (match[1]?.length ?? 0);
        applyKeywordRange(start, start + match[2].length);
    }

    if (!isEventTask) {
        for (const match of text.matchAll(HIGHLIGHT_TIME_TOKEN_REGEX)) {
            const rawToken = match[0];
            const parsed = parseTimeToken(rawToken.slice(1), true);
            if (!parsed) continue;
            const start = match.index ?? 0;
            applyKeywordRange(start, start + rawToken.length);
        }
    }

    for (const match of text.matchAll(HIGHLIGHT_EVENT_START_TOKEN_REGEX)) {
        if (!match[2] || !match[3]) continue;
        const parsed = parseClockToken(match[3]);
        if (!parsed) continue;
        const start = (match.index ?? 0) + (match[1]?.length ?? 0);
        applyKeywordRange(start, start + match[2].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_EVENT_END_TOKEN_REGEX)) {
        if (!match[2] || !match[3]) continue;
        const parsed = parseClockToken(match[3]);
        if (!parsed) continue;
        const start = (match.index ?? 0) + (match[1]?.length ?? 0);
        applyKeywordRange(start, start + match[2].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_EVENT_COLOR_HELPER_TOKEN_REGEX)) {
        if (!match[2]) continue;
        const start = (match.index ?? 0) + (match[1]?.length ?? 0);
        applyKeywordRange(start, start + match[2].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_TIMER_TOKEN_REGEX)) {
        if (!match[0] || !match[2]) continue;
        const parsed = Number.parseInt(match[2], 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) continue;
        const start = match.index ?? 0;
        applyKeywordRange(start, start + match[0].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_POMO_TOKEN_REGEX)) {
        if (!match[0] || !match[2]) continue;
        const parsed = Number.parseInt(match[2], 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) continue;
        const start = match.index ?? 0;
        applyKeywordRange(start, start + match[0].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_REMIND_TOKEN_REGEX)) {
        if (!match[0] || !match[2]) continue;
        const parsed = parseTimeToken(match[2], false);
        if (!parsed) continue;
        const start = match.index ?? 0;
        applyKeywordRange(start, start + match[0].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_TOMORROW_TOKEN_REGEX)) {
        if (!match[0]) continue;
        const start = match.index ?? 0;
        applyKeywordRange(start, start + match[0].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_VOUCH_TOKEN_REGEX)) {
        if (!match[2] || !match[3]) continue;
        const start = (match.index ?? 0) + (match[1]?.length ?? 0);
        applyKeywordRange(start, start + `${match[2]} ${match[3]}`.length);
    }

    for (const match of text.matchAll(HIGHLIGHT_ORDINAL_DATE_TOKEN_REGEX)) {
        if (!match[0] || !match[1]) continue;
        const parsedDay = Number.parseInt(match[1], 10);
        if (!Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) continue;
        const start = match.index ?? 0;
        applyKeywordRange(start, start + match[0].length);
    }

    for (const match of text.matchAll(HIGHLIGHT_SLASH_DATE_TOKEN_REGEX)) {
        if (!match[0]) continue;
        const start = match.index ?? 0;
        applyKeywordRange(start, start + match[0].length);
    }

    for (const colorMatch of extractEventColorMatches(text)) {
        const colorOption = GOOGLE_EVENT_COLOR_OPTIONS.find((option) => option.colorId === colorMatch.colorId);
        if (!colorOption) continue;
        applyColorRange(colorMatch.start, colorMatch.end, colorOption.swatchHex);
    }

    const segments: TitleHighlightSegment[] = [];
    let segmentStart = 0;
    for (let index = 1; index < text.length; index += 1) {
        const classChanged = classNames[index] !== classNames[index - 1];
        const styleChanged = inlineStyles[index]?.color !== inlineStyles[index - 1]?.color;
        if (!classChanged && !styleChanged) continue;
        segments.push({
            text: text.slice(segmentStart, index),
            className: classNames[index - 1],
            style: inlineStyles[index - 1],
        });
        segmentStart = index;
    }
    segments.push({
        text: text.slice(segmentStart),
        className: classNames[text.length - 1],
        style: inlineStyles[text.length - 1],
    });

    return segments;
}

function getParserKeywordCompletion(text: string, caretIndex: number): ParserKeywordCompletion | null {
    if (caretIndex !== text.length) return null;

    const leading = text.slice(0, caretIndex);
    const tokenMatch = leading.match(/(^|\s)([^\s]+)$/);
    if (!tokenMatch) return null;

    const fragment = tokenMatch[2];
    if (!fragment || fragment.length < 2) return null;
    if (/[0-9:\/]/.test(fragment)) return null;

    const normalized = fragment.toLowerCase();
    if (PARSER_KEYWORD_COMPLETION_TOKENS.includes(normalized)) return null;

    const suggestion = PARSER_KEYWORD_COMPLETION_TOKENS.find((keyword) => keyword.startsWith(normalized));
    if (!suggestion) return null;

    const insertText = VALUE_EXPECTING_KEYWORDS.has(suggestion)
        ? `${suggestion} `
        : suggestion;
    const suffix = insertText.slice(fragment.length);
    if (!suffix) return null;

    return {
        fragmentStart: caretIndex - fragment.length,
        fragment,
        suggestion,
        suffix,
        insertText,
    };
}

interface TaskInputProps {
    friends: Profile[];
    defaultFailureCostEuros: string;
    defaultCurrency: SupportedCurrency;
    defaultVoucherId: string | null;
    defaultEventDurationMinutes: number;
    selfUserId: string;
    onCreateTaskOptimistic?: (payload: TaskInputCreatePayload) => void;
}

export interface TaskInputCreatePayload {
    title: string;
    rawTitle: string;
    subtasks: string[];
    requiredPomoMinutes: number | null;
    deadlineIso: string;
    eventEndIso: string | null;
    reminderIsos: string[];
    voucherId: string;
    failureCost: string;
    recurrenceType: string | null;
    recurrenceDays: number[];
    userTimezone: string;
}

export function TaskInput({
    friends,
    defaultFailureCostEuros,
    defaultCurrency,
    defaultVoucherId,
    defaultEventDurationMinutes,
    selfUserId,
    onCreateTaskOptimistic,
}: TaskInputProps) {
    const LAST_VOUCHER_STORAGE_KEY = "task-input:last-voucher-id";

    const resolveVoucherSelection = useCallback((candidate: string | null | undefined) => {
        if (candidate === selfUserId) return selfUserId;
        if (candidate && friends.some((friend) => friend.id === candidate)) return candidate;
        return selfUserId;
    }, [friends, selfUserId]);

    const [title, setTitle] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [hasMounted, setHasMounted] = useState(false);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedVoucherId, setSelectedVoucherId] = useState<string>(resolveVoucherSelection(defaultVoucherId));
    const [failureCost, setFailureCost] = useState(defaultFailureCostEuros);
    const [isDeadlineManuallyPicked, setIsDeadlineManuallyPicked] = useState(false);

    const [isDateSheetOpen, setIsDateSheetOpen] = useState(false);
    const [deadlineDraftValue, setDeadlineDraftValue] = useState("");
    const [reminders, setReminders] = useState<Date[]>([]);
    const [remindersDraft, setRemindersDraft] = useState<Date[]>([]);
    const [reminderDraftValue, setReminderDraftValue] = useState("");

    const [recurrenceType, setRecurrenceType] = useState<string>("");
    const [recurrenceLabel, setRecurrenceLabel] = useState<string>("");
    const [showCustomRecurrenceInline, setShowCustomRecurrenceInline] = useState(false);
    const [customDays, setCustomDays] = useState<number[]>([]);
    const [deadlineError, setDeadlineError] = useState<string | null>(null);

    const [showShake, setShowShake] = useState(false);
    const [titleCaretIndex, setTitleCaretIndex] = useState(0);
    const [isTitleFocused, setIsTitleFocused] = useState(false);
    const [colorPickerIndex, setColorPickerIndex] = useState(0);
    const [isColorPickerDismissed, setIsColorPickerDismissed] = useState(false);

    const formRef = useRef<HTMLFormElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const titleHighlightRef = useRef<HTMLDivElement>(null);
    const colorPickerListRef = useRef<HTMLDivElement>(null);
    const colorOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const lastCalendarTapRef = useRef(0);
    const currencySymbol = getCurrencySymbol(defaultCurrency);
    const failureCostBounds = getFailureCostBounds(defaultCurrency);
    const normalizedDefaultEventDurationMinutes =
        Number.isInteger(defaultEventDurationMinutes) &&
            defaultEventDurationMinutes >= 1 &&
            defaultEventDurationMinutes <= 720
            ? defaultEventDurationMinutes
            : DEFAULT_EVENT_DURATION_MINUTES;
    const titleHighlightSegments = buildTitleHighlightSegments(title);
    const nearestColorHelperToken =
        isTitleFocused ? findNearestColorHelperToken(title, titleCaretIndex) : null;
    const isCaretNearColorHelper = Boolean(
        nearestColorHelperToken &&
        titleCaretIndex >= nearestColorHelperToken.start - 1 &&
        titleCaretIndex <= nearestColorHelperToken.end + 1
    );
    const isColorPickerVisible = Boolean(
        nearestColorHelperToken &&
        isCaretNearColorHelper &&
        !isColorPickerDismissed
    );
    const inlineKeywordCompletion = useMemo(() => {
        if (!isTitleFocused || isColorPickerVisible) return null;
        return getParserKeywordCompletion(title, titleCaretIndex);
    }, [isTitleFocused, isColorPickerVisible, title, titleCaretIndex]);

    const syncTitleHighlightScroll = useCallback(() => {
        if (!titleInputRef.current || !titleHighlightRef.current) return;
        titleHighlightRef.current.scrollLeft = titleInputRef.current.scrollLeft;
    }, []);

    const syncTitleCaretFromInput = useCallback(() => {
        const input = titleInputRef.current;
        if (!input) return;
        setTitleCaretIndex(input.selectionStart ?? input.value.length);
    }, []);

    const applyColorPickerSelection = useCallback((aliasToken: string) => {
        const input = titleInputRef.current;
        const caretIndex = input?.selectionStart ?? titleCaretIndex;
        const replacement = replaceNearestColorHelperToken(title, caretIndex, aliasToken);
        if (!replacement.replaced) return;

        setTitle(replacement.nextTitle);
        setTitleCaretIndex(replacement.nextCaretIndex);
        setIsColorPickerDismissed(false);

        requestAnimationFrame(() => {
            const nextInput = titleInputRef.current;
            if (!nextInput) return;
            nextInput.focus();
            nextInput.setSelectionRange(replacement.nextCaretIndex, replacement.nextCaretIndex);
            syncTitleHighlightScroll();
        });
    }, [title, titleCaretIndex, syncTitleHighlightScroll]);

    const applyInlineKeywordCompletion = useCallback(() => {
        if (!inlineKeywordCompletion) return;
        const fragmentEnd = inlineKeywordCompletion.fragmentStart + inlineKeywordCompletion.fragment.length;
        const nextTitle = `${title.slice(0, inlineKeywordCompletion.fragmentStart)}${inlineKeywordCompletion.insertText}${title.slice(fragmentEnd)}`;
        const nextCaretIndex = inlineKeywordCompletion.fragmentStart + inlineKeywordCompletion.insertText.length;

        setTitle(nextTitle);
        setTitleCaretIndex(nextCaretIndex);

        requestAnimationFrame(() => {
            const input = titleInputRef.current;
            if (!input) return;
            input.focus();
            input.setSelectionRange(nextCaretIndex, nextCaretIndex);
            syncTitleHighlightScroll();
        });
    }, [inlineKeywordCompletion, title, syncTitleHighlightScroll]);

    useEffect(() => {
        if (!nearestColorHelperToken) return;
        setColorPickerIndex(0);
    }, [nearestColorHelperToken?.start, nearestColorHelperToken?.end]);

    useEffect(() => {
        if (!isColorPickerVisible) return;
        const listEl = colorPickerListRef.current;
        const optionEl = colorOptionRefs.current[colorPickerIndex];
        if (!listEl || !optionEl) return;

        const optionTop = optionEl.offsetTop;
        const optionBottom = optionTop + optionEl.offsetHeight;
        const visibleTop = listEl.scrollTop;
        const visibleBottom = visibleTop + listEl.clientHeight;

        if (optionTop < visibleTop) {
            listEl.scrollTop = optionTop;
        } else if (optionBottom > visibleBottom) {
            listEl.scrollTop = optionBottom - listEl.clientHeight;
        }
    }, [colorPickerIndex, isColorPickerVisible]);

    useEffect(() => {
        setFailureCost(defaultFailureCostEuros);
    }, [defaultFailureCostEuros]);

    useEffect(() => {
        try {
            const savedVoucherId = window.localStorage.getItem(LAST_VOUCHER_STORAGE_KEY);
            if (savedVoucherId) {
                setSelectedVoucherId(resolveVoucherSelection(savedVoucherId));
                return;
            }
        } catch {
            // Ignore localStorage failures and fallback to default behavior.
        }

        setSelectedVoucherId(resolveVoucherSelection(defaultVoucherId));
    }, [defaultVoucherId, resolveVoucherSelection]);

    useEffect(() => {
        if (!selectedVoucherId) return;
        try {
            window.localStorage.setItem(LAST_VOUCHER_STORAGE_KEY, selectedVoucherId);
        } catch {
            // Ignore localStorage failures.
        }
    }, [selectedVoucherId]);

    useEffect(() => {
        const defaultDeadline = getDefaultDeadline();
        setSelectedDate(defaultDeadline);
        setDeadlineDraftValue(toDateTimeLocalValue(defaultDeadline));
        setHasMounted(true);
    }, []);

    useEffect(() => {
        if (selectedVoucherId === selfUserId) return;
        const isStillFriend = friends.some((friend) => friend.id === selectedVoucherId);
        if (!isStillFriend) {
            setSelectedVoucherId(selfUserId);
        }
    }, [friends, selectedVoucherId, selfUserId]);

    useEffect(() => {
        const localValue = toDateTimeLocalValue(selectedDate);
        if (!localValue) return;
        setDeadlineDraftValue(localValue);
    }, [selectedDate]);

    useEffect(() => {
        setIsColorPickerDismissed(false);
    }, [title, titleCaretIndex, isTitleFocused]);

    const getSelectedWeekday = () => {
        return selectedDate?.getDay() ?? new Date().getDay();
    };

    const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
    const weekdayShort: Record<number, string> = {
        1: "M",
        2: "T",
        3: "W",
        4: "T",
        5: "F",
        6: "S",
        0: "S",
    };

    const formatCustomDaysLabel = (days: number[]) => {
        const ordered = weekdayOrder.filter((day) => days.includes(day));
        return ordered.map((day) => weekdayShort[day]).join(" ");
    };

    const formatDeadlineLabel = (date: Date | null) => {
        if (!hasMounted) return "Set date";
        if (!date) return "Set date";
        return date.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const formatDeadlineTitle = (date: Date | null) => {
        if (!hasMounted || !date) return "Set Date";
        return date.toLocaleString();
    };

    const formatReminderLabel = (date: Date) => {
        return date.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const getDraftDeadline = () => {
        if (!deadlineDraftValue) return null;
        return fromDateTimeLocalValue(deadlineDraftValue);
    };

    const normalizeReminderDates = (values: Date[]) => {
        const deduped = new Map<number, Date>();
        for (const value of values) {
            deduped.set(value.getTime(), value);
        }
        return Array.from(deduped.values()).sort((a, b) => a.getTime() - b.getTime());
    };

    const buildReminderDateOnDeadlineDay = (deadlineDate: Date, hours: number, minutes: number) => {
        const reminderDate = new Date(deadlineDate);
        reminderDate.setHours(hours, minutes, 0, 0);
        return reminderDate;
    };

    const parseReminderTimesFromTitle = (text: string) => {
        const regex = /\bremind\s+(\d{1,2}:\d{2}|\d{4})\b/gi;
        const results: Array<{ hours: number; minutes: number }> = [];
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            const parsed = parseTimeToken(match[1], false);
            if (!parsed) continue;
            results.push(parsed);
        }

        return results;
    };

    const resolveEventAnchorDateFromTitle = useCallback((text: string, now: Date = new Date()) => {
        const parsedDateTokens = parseDateTokens(text);
        if (parsedDateTokens.length > 1) {
            return {
                anchorDate: getDefaultDeadline(now),
                error: "Use only one date token (for example: 28th or 05/03).",
            };
        }

        const hasTomorrowKeyword = TOMORROW_KEYWORD_REGEX.test(text);

        if (parsedDateTokens.length === 1) {
            const dateToken = parsedDateTokens[0];
            const year = dateToken.kind === "slash" ? (dateToken.year ?? now.getFullYear()) : now.getFullYear();
            const month = dateToken.kind === "slash" ? dateToken.month : now.getMonth() + 1;
            const day = dateToken.day;

            if (!isValidCalendarDate(year, month, day)) {
                return {
                    anchorDate: getDefaultDeadline(now),
                    error: "Date is invalid. Use 28th, 05/03, or 05/03/2026.",
                };
            }

            return {
                anchorDate: new Date(year, month - 1, day, 12, 0, 0, 0),
                error: null as string | null,
            };
        }

        if (hasTomorrowKeyword) {
            const anchorDate = new Date(now);
            anchorDate.setDate(anchorDate.getDate() + 1);
            anchorDate.setHours(12, 0, 0, 0);
            return { anchorDate, error: null as string | null };
        }

        return {
            anchorDate: getDefaultDeadline(now),
            error: null as string | null,
        };
    }, []);

    const resolveDeadlineFromTitle = useCallback((text: string) => {
        const now = new Date();
        const defaultDeadline = getDefaultDeadline(now);
        const isEventTask = EVENT_TOKEN_REGEX.test(text);

        if (isEventTask) {
            const anchorResolution = resolveEventAnchorDateFromTitle(text, now);
            if (anchorResolution.error) {
                return {
                    deadline: defaultDeadline,
                    error: anchorResolution.error,
                };
            }

            const eventResolution = resolveEventSchedule({
                rawTitle: text,
                anchorDate: anchorResolution.anchorDate,
                defaultDurationMinutes: normalizedDefaultEventDurationMinutes,
                now,
            });

            if (eventResolution.error || !eventResolution.startDate) {
                return {
                    deadline: defaultDeadline,
                    error: eventResolution.error || "Event start time is invalid.",
                };
            }

            return {
                deadline: eventResolution.startDate,
                error: null as string | null,
            };
        }

        const timerMinutes = parseTimerMinutesToken(text);

        if (timerMinutes !== null) {
            const timerDeadline = new Date();
            timerDeadline.setMinutes(timerDeadline.getMinutes() + timerMinutes);
            return { deadline: timerDeadline, error: null as string | null };
        }

        const parsedDateTokens = parseDateTokens(text);
        if (parsedDateTokens.length > 1) {
            return {
                deadline: defaultDeadline,
                error: "Use only one date token (for example: 28th or 05/03).",
            };
        }

        const hasTomorrowKeyword = TOMORROW_KEYWORD_REGEX.test(text);
        const timeMatch = text.match(TIME_TOKEN_REGEX);
        const parsedTime = timeMatch ? parseTimeToken(timeMatch[1], true) : null;

        if (timeMatch && !parsedTime) {
            return { deadline: defaultDeadline, error: "Deadline is invalid." };
        }

        if (parsedDateTokens.length === 1) {
            const dateToken = parsedDateTokens[0];
            const year = dateToken.kind === "slash" ? (dateToken.year ?? now.getFullYear()) : now.getFullYear();
            const month = dateToken.kind === "slash" ? dateToken.month : now.getMonth() + 1;
            const day = dateToken.day;

            if (!isValidCalendarDate(year, month, day)) {
                return { deadline: defaultDeadline, error: "Date is invalid. Use 28th, 05/03, or 05/03/2026." };
            }

            const deadline = new Date(
                year,
                month - 1,
                day,
                parsedTime?.hours ?? 23,
                parsedTime?.minutes ?? 59,
                0,
                0
            );

            if (deadline.getTime() <= now.getTime()) {
                return { deadline, error: "Deadline must be in the future." };
            }

            return { deadline, error: null as string | null };
        }

        if (hasTomorrowKeyword) {
            const deadline = new Date(now);
            deadline.setDate(deadline.getDate() + 1);
            deadline.setHours(parsedTime?.hours ?? 23, parsedTime?.minutes ?? 59, 0, 0);

            return { deadline, error: null as string | null };
        }

        if (parsedTime) {
            const deadline = new Date(now);
            deadline.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);

            if (deadline.getTime() <= now.getTime()) {
                return { deadline, error: "Deadline must be in the future." };
            }

            return { deadline, error: null as string | null };
        }

        return { deadline: defaultDeadline, error: null as string | null };
    }, [normalizedDefaultEventDurationMinutes, resolveEventAnchorDateFromTitle]);

    const resetDeadlineToDefault = () => {
        setDeadlineError(null);
        setIsDeadlineManuallyPicked(false);
        setSelectedDate(getDefaultDeadline());
        setReminders([]);
        setRemindersDraft([]);
        setReminderDraftValue("");
    };

    const openDateSheet = () => {
        setDeadlineDraftValue(
            toDateTimeLocalValue(selectedDate ?? getDefaultDeadline())
        );
        setRemindersDraft(reminders.slice().sort((a, b) => a.getTime() - b.getTime()));
        setReminderDraftValue("");
        setIsDateSheetOpen(true);
    };

    const handleCalendarClick = () => {
        const now = Date.now();
        const isDoubleTap = now - lastCalendarTapRef.current <= 300;
        lastCalendarTapRef.current = now;

        if (isDoubleTap) {
            resetDeadlineToDefault();
            return;
        }

        openDateSheet();
    };

    const applyDateSheet = () => {
        const parsed = fromDateTimeLocalValue(deadlineDraftValue);
        if (!parsed) return;
        if (parsed.getTime() <= Date.now()) {
            setDeadlineError("Deadline must be in the future.");
            return;
        }

        const pendingReminder =
            reminderDraftValue.trim().length > 0
                ? fromDateTimeLocalValue(reminderDraftValue)
                : null;
        if (reminderDraftValue.trim().length > 0 && !pendingReminder) {
            setDeadlineError("Please choose a valid reminder.");
            return;
        }

        const remindersToApply = normalizeReminderDates(
            pendingReminder ? [...remindersDraft, pendingReminder] : remindersDraft
        );

        const hasInvalidReminder = remindersToApply.some(
            (reminder) => reminder.getTime() <= Date.now() || reminder.getTime() > parsed.getTime()
        );
        if (hasInvalidReminder) {
            setDeadlineError("Reminders must be in the future and before or at the deadline.");
            return;
        }

        setDeadlineError(null);
        setIsDeadlineManuallyPicked(true);
        setSelectedDate(parsed);
        setReminders(remindersToApply);
        setReminderDraftValue("");
        setIsDateSheetOpen(false);
    };

    const handleAddReminderDraft = () => {
        if (!reminderDraftValue) return;

        const parsedReminder = fromDateTimeLocalValue(reminderDraftValue);
        const parsedDeadline = getDraftDeadline();
        if (!parsedReminder || !parsedDeadline) {
            setDeadlineError("Please choose a valid reminder.");
            return;
        }

        if (parsedReminder.getTime() <= Date.now()) {
            setDeadlineError("Reminder must be in the future.");
            return;
        }

        if (parsedReminder.getTime() > parsedDeadline.getTime()) {
            setDeadlineError("Reminder must be before or at the deadline.");
            return;
        }

        setDeadlineError(null);
        setRemindersDraft((prev) => normalizeReminderDates([...prev, parsedReminder]));
        setReminderDraftValue("");
    };

    const handleRemoveReminderDraft = (iso: string) => {
        setRemindersDraft((prev) => prev.filter((reminder) => reminder.toISOString() !== iso));
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (isColorPickerVisible) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setColorPickerIndex((prev) => (prev + 1) % GOOGLE_EVENT_COLOR_OPTIONS.length);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setColorPickerIndex((prev) => (prev - 1 + GOOGLE_EVENT_COLOR_OPTIONS.length) % GOOGLE_EVENT_COLOR_OPTIONS.length);
                return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const option = GOOGLE_EVENT_COLOR_OPTIONS[colorPickerIndex];
                if (option) {
                    applyColorPickerSelection(option.aliasToken);
                }
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                setIsColorPickerDismissed(true);
                return;
            }
        }

        if (e.key === "Tab" && inlineKeywordCompletion) {
            e.preventDefault();
            applyInlineKeywordCompletion();
            return;
        }

        if (e.key !== "Enter") return;
        if (e.nativeEvent.isComposing) return;
        e.preventDefault();
        formRef.current?.requestSubmit();
    };

    useEffect(() => {
        if (!isDeadlineManuallyPicked) {
            const parserResolution = resolveDeadlineFromTitle(title);
            setSelectedDate(parserResolution.deadline);
            setDeadlineError(parserResolution.error);
        }

        if (/(?:\bvouch|\.v)\s+(me|self|myself)\b/i.test(title)) {
            setSelectedVoucherId(selfUserId);
        } else {
            const vouchMatch = title.match(/(?:\bvouch|\.v)\s+(\w+)/i);
            if (vouchMatch) {
                const name = vouchMatch[1].toLowerCase();
                const friend = friends.find(
                    (f) =>
                        f.username?.toLowerCase().includes(name) ||
                        f.email?.toLowerCase().includes(name)
                );
                if (friend) {
                    setSelectedVoucherId(friend.id);
                }
            }
        }
    }, [title, friends, isDeadlineManuallyPicked, selfUserId, resolveDeadlineFromTitle]);

    useEffect(() => {
        syncTitleHighlightScroll();
    }, [title, syncTitleHighlightScroll]);

    const stripMetadata = (text: string) => {
        const withoutStandardTokens = text
            .replace(/@(?:\d{1,2}:\d{2}|\d{3,4}|\d{1,2})\b/g, "")
            .replace(/(?:^|\s)-start\s*(?:\d{1,2}:\d{2}|\d{1,4})\b/gi, " ")
            .replace(/(?:^|\s)-end\s*(?:\d{1,2}:\d{2}|\d{1,4})\b/gi, " ")
            .replace(/\b([12]?\d|3[01])(?:st|nd|rd|th)\b/gi, "")
            .replace(/\b(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])(?:\/\d{4})?\b/g, "")
            .replace(/\bremind\s+(?:\d{1,2}:\d{2}|\d{4})\b/gi, "")
            .replace(/\b(?:tmrw|tomorrow)\b/gi, "")
            .replace(/(?:\bvouch|\.v)\s+\w+/gi, "")
            .replace(/\bpomo\s+\d+\b/gi, "")
            .replace(/\btimer\s+\d+\b/gi, "")
            .replace(/\s+/g, " ")
            .trim();

        return stripEventColorTokens(withoutStandardTokens);
    };

    const parseRequiredPomoMinutes = (text: string): number | null => {
        const match = text.match(/\bpomo\s+(\d+)\b/i);
        if (!match) return null;

        const parsed = Number.parseInt(match[1], 10);
        if (!Number.isInteger(parsed)) return null;
        if (parsed < 1 || parsed > 10000) return null;
        return parsed;
    };

    const parseTaskTitleAndSubtasks = (text: string) => {
        const cleaned = stripMetadata(text);
        const segments = cleaned.split("/").map((segment) => segment.trim());
        const taskTitle = segments[0] || "";
        const subtasks = segments.slice(1).filter(Boolean);

        return { taskTitle, subtasks };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const { taskTitle, subtasks } = parseTaskTitleAndSubtasks(title);
        const requiredPomoMinutes = parseRequiredPomoMinutes(title);

        if (!taskTitle || isLoading) return;

        if (!selectedVoucherId) {
            setShowShake(true);
            setTimeout(() => setShowShake(false), 500);
            return;
        }

        const isEventTask = EVENT_TOKEN_REGEX.test(title);
        const colorValidation = validateEventColorUsage(title, isEventTask);
        if (colorValidation.error) {
            setDeadlineError(colorValidation.error);
            return;
        }

        const parserResolution = isDeadlineManuallyPicked ? null : resolveDeadlineFromTitle(title);
        if (parserResolution?.error) {
            setDeadlineError(parserResolution.error);
            return;
        }

        let deadlineToSubmit = parserResolution?.deadline ?? selectedDate ?? getDefaultDeadline();
        let eventEndDate: Date | null = null;

        if (isEventTask) {
            const anchorDateResolution = isDeadlineManuallyPicked
                ? {
                    anchorDate: selectedDate ?? getDefaultDeadline(),
                    error: null as string | null,
                }
                : resolveEventAnchorDateFromTitle(title);

            if (anchorDateResolution.error) {
                setDeadlineError(anchorDateResolution.error);
                return;
            }

            const eventResolution = resolveEventSchedule({
                rawTitle: title,
                anchorDate: anchorDateResolution.anchorDate,
                defaultDurationMinutes: normalizedDefaultEventDurationMinutes,
            });

            if (eventResolution.error || !eventResolution.startDate || !eventResolution.endDate) {
                setDeadlineError(eventResolution.error || "Event time is invalid.");
                return;
            }

            deadlineToSubmit = eventResolution.startDate;
            eventEndDate = eventResolution.endDate;
        } else {
            if (deadlineToSubmit.getTime() <= Date.now()) {
                setDeadlineError("Deadline must be in the future.");
                return;
            }
        }

        const parsedReminderTimes = parseReminderTimesFromTitle(title);
        const parserReminderDates = parsedReminderTimes.map(({ hours, minutes }) =>
            buildReminderDateOnDeadlineDay(deadlineToSubmit, hours, minutes)
        );
        const remindersToSubmit = normalizeReminderDates([...reminders, ...parserReminderDates]);

        const hasPastReminder = remindersToSubmit.some((reminder) => reminder.getTime() <= Date.now());
        if (hasPastReminder) {
            setDeadlineError("All reminders must be in the future.");
            return;
        }

        const hasReminderAfterDeadline = remindersToSubmit.some(
            (reminder) => reminder.getTime() > deadlineToSubmit.getTime()
        );
        if (hasReminderAfterDeadline) {
            setDeadlineError("Reminders must be before or at the deadline.");
            return;
        }

        setDeadlineError(null);

        const recurrenceDaysToUse =
            recurrenceType === "WEEKLY"
                ? (customDays.length > 0 ? customDays : [getSelectedWeekday()])
                : [];

        const payload: TaskInputCreatePayload = {
            title: taskTitle,
            rawTitle: title,
            subtasks,
            requiredPomoMinutes,
            deadlineIso: deadlineToSubmit.toISOString(),
            eventEndIso: eventEndDate ? eventEndDate.toISOString() : null,
            reminderIsos: remindersToSubmit.map((reminder) => reminder.toISOString()),
            voucherId: selectedVoucherId,
            failureCost,
            recurrenceType: recurrenceType || null,
            recurrenceDays: recurrenceDaysToUse,
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        };
        const timeUntilDeadline = formatTimeUntilDeadline(deadlineToSubmit);

        if (onCreateTaskOptimistic) {
            onCreateTaskOptimistic(payload);
            toast.success(timeUntilDeadline);
            setTitle("");
            setRecurrenceType("");
            setRecurrenceLabel("");
            setShowCustomRecurrenceInline(false);
            resetDeadlineToDefault();
            return;
        }

        setIsLoading(true);
        try {
            const formData = new FormData();
            formData.append("title", payload.title);
            formData.append("rawTitle", payload.rawTitle);
            formData.append("deadline", payload.deadlineIso);
            if (payload.eventEndIso) {
                formData.append("eventEndIso", payload.eventEndIso);
            }
            formData.append("voucherId", payload.voucherId);
            formData.append("failureCost", payload.failureCost);
            if (payload.subtasks.length > 0) {
                formData.append("subtasks", JSON.stringify(payload.subtasks));
            }
            if (payload.requiredPomoMinutes != null) {
                formData.append("requiredPomoMinutes", String(payload.requiredPomoMinutes));
            }
            if (payload.reminderIsos.length > 0) {
                formData.append("reminders", JSON.stringify(payload.reminderIsos));
            }

            if (payload.recurrenceType) {
                formData.append("recurrenceType", payload.recurrenceType);
                formData.append("userTimezone", payload.userTimezone);
                formData.append("recurrenceInterval", "1");

                if (payload.recurrenceType === "WEEKLY" && payload.recurrenceDays.length > 0) {
                    formData.append("recurrenceDays", JSON.stringify(payload.recurrenceDays));
                }
            }

            const result = await createTask(formData);
            if (result?.error) {
                console.error("Failed to create task", result.error);
            } else {
                toast.success(timeUntilDeadline);
                setTitle("");
                setRecurrenceType("");
                setRecurrenceLabel("");
                setShowCustomRecurrenceInline(false);
                resetDeadlineToDefault();
            }
        } catch (error) {
            console.error("Failed to create task", error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form ref={formRef} onSubmit={handleSubmit} className="relative space-y-3 mb-8">
            <div className="bg-slate-900/50 border border-slate-800/50 focus-within:border-slate-700/50 rounded-xl transition-all shadow-2xl overflow-visible">
                <div className="relative">
                    {title.length > 0 && (
                        <div
                            ref={titleHighlightRef}
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 overflow-hidden py-4 px-5 whitespace-pre text-lg font-medium text-white"
                        >
                            {titleHighlightSegments.map((segment, index) => (
                                <span
                                    key={`${index}-${segment.text}`}
                                    className={segment.className || undefined}
                                    style={segment.style}
                                >
                                    {segment.text}
                                </span>
                            ))}
                            {inlineKeywordCompletion?.suffix && (
                                <span className="text-slate-500/75">
                                    {inlineKeywordCompletion.suffix}
                                </span>
                            )}
                        </div>
                    )}
                    <input
                        ref={titleInputRef}
                        type="text"
                        value={title}
                        onChange={(e) => {
                            setTitle(e.target.value);
                            setTitleCaretIndex(e.target.selectionStart ?? e.target.value.length);
                        }}
                        onKeyDown={handleTitleKeyDown}
                        onKeyUp={syncTitleCaretFromInput}
                        onClick={syncTitleCaretFromInput}
                        onSelect={syncTitleCaretFromInput}
                        onFocus={() => {
                            setIsTitleFocused(true);
                            syncTitleCaretFromInput();
                        }}
                        onBlur={() => {
                            setIsTitleFocused(false);
                        }}
                        onScroll={syncTitleHighlightScroll}
                        enterKeyHint="done"
                        placeholder="plan sprint -event -start930 -color /write notes remind 1000 vouch bob (.v bob)"
                        className={cn(
                            "w-full bg-transparent border-none py-4 px-5 text-white placeholder:text-slate-500/70 focus:outline-none transition-all font-medium text-lg",
                            title.length > 0 && "text-transparent caret-white"
                        )}
                        disabled={isLoading}
                    />
                    {isColorPickerVisible && (
                        <div
                            className="absolute left-5 right-5 top-full z-30 mt-2 rounded-lg border border-slate-700/60 bg-slate-950/95 shadow-xl backdrop-blur-sm"
                            onMouseDown={(e) => e.preventDefault()}
                        >
                            <div ref={colorPickerListRef} className="max-h-56 overflow-y-auto py-1">
                                {GOOGLE_EVENT_COLOR_OPTIONS.map((option, index) => {
                                    const isActive = index === colorPickerIndex;
                                    return (
                                        <button
                                            key={option.aliasToken}
                                            ref={(element) => {
                                                colorOptionRefs.current[index] = element;
                                            }}
                                            type="button"
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => {
                                                setColorPickerIndex(index);
                                                applyColorPickerSelection(option.aliasToken);
                                            }}
                                            className={cn(
                                                "w-full px-3 py-1.5 text-left text-sm font-mono transition-colors",
                                                isActive ? "bg-slate-800/80" : "hover:bg-slate-800/50"
                                            )}
                                        >
                                            <span style={{ color: option.swatchHex }}>
                                                {option.aliasToken}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-2 border-t border-slate-800/30">
                    <div className="flex items-start gap-1.5">
                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-w-0 flex-1 pr-1">
                            <div className="relative w-16 shrink-0">
                                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-[9px] font-mono pointer-events-none z-10">{currencySymbol}</span>
                                <input
                                    type="number"
                                    step={failureCostBounds.step}
                                    min={failureCostBounds.minMajor}
                                    max={failureCostBounds.maxMajor}
                                    value={failureCost}
                                    onChange={(e) => setFailureCost(e.target.value)}
                                    className="h-9 w-full pl-4 pr-1 bg-slate-800/30 hover:bg-slate-700/30 border border-slate-700/30 rounded-lg text-slate-300 text-[11px] font-mono focus:outline-none focus:border-slate-600 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-center"
                                    placeholder={defaultFailureCostEuros}
                                />
                            </div>

                            <div className={`flex-1 min-w-[92px] shrink ${showShake ? "animate-shake" : ""}`}>
                                <Select value={selectedVoucherId} onValueChange={setSelectedVoucherId}>
                                    <SelectTrigger className="h-9 w-full bg-slate-800/30 border-slate-700/30 text-slate-300 text-[10px] font-mono focus:ring-0 rounded-lg justify-start px-2">
                                        <User className="h-3 w-3 mr-1.5 shrink-0 opacity-70" />
                                        <SelectValue placeholder="Voucher" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
                                        {selfUserId && <SelectItem value={selfUserId}>Myself</SelectItem>}
                                        {friends.map((friend) => (
                                            <SelectItem key={friend.id} value={friend.id}>
                                                {friend.username || friend.email}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <button
                                type="button"
                                onClick={handleCalendarClick}
                                onDoubleClick={resetDeadlineToDefault}
                                className={cn(
                                    "h-9 max-w-[180px] shrink-0 px-2.5 bg-slate-800/30 hover:bg-slate-700/30 border border-slate-700/30 text-slate-400 hover:text-slate-200 rounded-lg transition-all flex items-center justify-start gap-1.5",
                                    selectedDate && "text-blue-400 border-blue-500/30 bg-blue-500/5"
                                )}
                                title={formatDeadlineTitle(selectedDate)}
                            >
                                <Calendar className="h-3.5 w-3.5 shrink-0" />
                                <span className="text-[10px] font-mono truncate">
                                    {formatDeadlineLabel(selectedDate)}
                                    {reminders.length > 0 ? ` • ${reminders.length}R` : ""}
                                </span>
                            </button>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className={cn(
                                            "h-9 w-9 shrink-0 bg-slate-800/30 hover:bg-slate-700/30 border border-slate-700/30 text-slate-400 hover:text-slate-200 rounded-lg transition-all flex items-center justify-center",
                                            recurrenceType && "text-purple-400 border-purple-500/30 bg-purple-500/5"
                                        )}
                                        title={recurrenceLabel || "Repeat Task"}
                                    >
                                        <Repeat className="h-3.5 w-3.5" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="bg-slate-900 border-slate-800 text-slate-300 min-w-[180px]">
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setRecurrenceType("");
                                            setRecurrenceLabel("");
                                            setShowCustomRecurrenceInline(false);
                                        }}
                                        className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs"
                                    >
                                        None
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-slate-800" />
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setRecurrenceType("DAILY");
                                            setRecurrenceLabel("Daily");
                                            setShowCustomRecurrenceInline(false);
                                        }}
                                        className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs justify-between"
                                    >
                                        Daily
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setRecurrenceType("WEEKLY");
                                            setRecurrenceLabel("Weekly");
                                            setCustomDays([getSelectedWeekday()]);
                                            setShowCustomRecurrenceInline(false);
                                        }}
                                        className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs"
                                    >
                                        Weekly
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setRecurrenceType("MONTHLY");
                                            setRecurrenceLabel("Monthly");
                                            setShowCustomRecurrenceInline(false);
                                        }}
                                        className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs"
                                    >
                                        Monthly
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setRecurrenceType("YEARLY");
                                            setRecurrenceLabel("Yearly");
                                            setShowCustomRecurrenceInline(false);
                                        }}
                                        className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs"
                                    >
                                        Yearly
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-slate-800" />
                                    <DropdownMenuItem
                                        onSelect={(e) => {
                                            e.preventDefault();
                                            const initialDays = customDays.length > 0 ? customDays : [getSelectedWeekday()];
                                            setCustomDays(initialDays);
                                            setRecurrenceType("WEEKLY");
                                            setRecurrenceLabel(`Custom: ${formatCustomDaysLabel(initialDays)}`);
                                            setShowCustomRecurrenceInline((prev) => !prev);
                                        }}
                                        className="focus:bg-slate-800 focus:text-slate-200 cursor-pointer text-xs"
                                    >
                                        Custom...
                                    </DropdownMenuItem>
                                    {showCustomRecurrenceInline && (
                                        <div className="px-2 pb-2 pt-1 border-t border-slate-800 mt-1 space-y-2">
                                            <div className="text-[10px] text-slate-400 uppercase tracking-wide">Select days</div>
                                            <div className="grid grid-cols-7 gap-1">
                                                {weekdayOrder.map((dayIdx) => {
                                                    const isSelected = customDays.includes(dayIdx);
                                                    return (
                                                        <button
                                                            key={dayIdx}
                                                            type="button"
                                                            onClick={() => {
                                                                const next = customDays.includes(dayIdx)
                                                                    ? customDays.filter((d) => d !== dayIdx)
                                                                    : [...customDays, dayIdx];
                                                                const normalizedRaw = weekdayOrder.filter((d) => next.includes(d));
                                                                const normalized = normalizedRaw.length > 0 ? normalizedRaw : [dayIdx];
                                                                setCustomDays(normalized);
                                                                setRecurrenceType("WEEKLY");
                                                                setRecurrenceLabel(`Custom: ${formatCustomDaysLabel(normalized)}`);
                                                            }}
                                                            className={cn(
                                                                "h-7 w-7 rounded-md text-[10px] font-semibold transition-colors",
                                                                isSelected
                                                                    ? "bg-blue-600 text-white"
                                                                    : "bg-slate-800/60 text-slate-300 hover:bg-slate-700"
                                                            )}
                                                        >
                                                            {weekdayShort[dayIdx]}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="h-9 w-9 shrink-0 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 rounded-lg transition-all disabled:opacity-50 flex items-center justify-center"
                        >
                            {isLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
                            ) : (
                                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                            )}
                        </button>
                    </div>
                </div>
            </div>

            <Dialog open={isDateSheetOpen} onOpenChange={setIsDateSheetOpen}>
                <DialogContent className="bg-slate-900 border-slate-800 text-slate-200 [&>[data-slot='dialog-close']]:text-slate-300 [&>[data-slot='dialog-close']]:opacity-100 [&>[data-slot='dialog-close']]:hover:text-white">
                    <DialogHeader>
                        <DialogTitle className="text-white">Set deadline</DialogTitle>
                        <DialogDescription className="text-slate-400">
                            Pick date and time for this task.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <label className="text-xs uppercase tracking-wide text-slate-400">Deadline</label>
                            <input
                                type="datetime-local"
                                value={deadlineDraftValue}
                                onChange={(e) => setDeadlineDraftValue(e.target.value)}
                                className="h-9 w-full px-3 bg-slate-800/70 border border-slate-600 rounded-md text-white [color-scheme:dark] focus:outline-none focus:border-slate-400"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs uppercase tracking-wide text-slate-400">Reminders</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="datetime-local"
                                    value={reminderDraftValue}
                                    onChange={(e) => setReminderDraftValue(e.target.value)}
                                    className="h-9 w-full px-3 bg-slate-800/70 border border-slate-600 rounded-md text-white [color-scheme:dark] focus:outline-none focus:border-slate-400"
                                />
                                <button
                                    type="button"
                                    onClick={handleAddReminderDraft}
                                    disabled={!deadlineDraftValue || !reminderDraftValue}
                                    className="h-9 px-3 rounded-md border border-slate-600 text-slate-100 hover:bg-slate-700 disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-400 disabled:opacity-100"
                                >
                                    Add
                                </button>
                            </div>
                            <p className="text-xs text-slate-400">Click Add or just Apply to include this reminder.</p>

                            {remindersDraft.length > 0 && (
                                <div className="space-y-1.5 rounded-md border border-slate-800 bg-slate-950/40 p-2">
                                    {remindersDraft.map((reminder) => (
                                        <div key={reminder.toISOString()} className="flex items-center justify-between gap-2">
                                            <span className="text-xs text-slate-300">{formatReminderLabel(reminder)}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveReminderDraft(reminder.toISOString())}
                                                className="text-xs text-red-300 hover:text-red-200"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <button
                            type="button"
                            onClick={() => setIsDateSheetOpen(false)}
                            className="h-9 px-3 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                resetDeadlineToDefault();
                                setIsDateSheetOpen(false);
                            }}
                            className="h-9 px-3 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800"
                        >
                            Reset
                        </button>
                        <button
                            type="button"
                            onClick={applyDateSheet}
                            disabled={!deadlineDraftValue}
                            className="h-9 px-3 rounded-md bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30 disabled:opacity-50"
                        >
                            Apply
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {deadlineError && (
                <p className="px-2 text-xs text-red-400">{deadlineError}</p>
            )}
        </form>
    );
}
