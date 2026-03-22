"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
    DEFAULT_EVENT_DURATION_MINUTES,
    MAX_POMO_DURATION_MINUTES,
} from "@/lib/constants";
import { resolveEventSchedule } from "@/lib/task-title-event-time";
import {
    GOOGLE_EVENT_COLOR_OPTIONS,
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
import { parseRequiredPomoFromTitle } from "@/lib/pomodoro";
import {
    normalizeReminderDates,
    resolveDateSheetDraftSubmission,
} from "@/lib/task-deadline-sheet";
import {
    applyParserKeywordCompletion,
    buildTaskTitleOverlayModel,
    EVENT_TOKEN_REGEX,
    extractWeekdayDateTokens,
    getDefaultDeadline,
    isValidCalendarDate,
    parseDateTokens,
    parseProofRequiredFromTitle,
    parseReminderTimesFromTitle,
    parseRepeatTokenFromTitle,
    parseTaskInputTimeToken,
    parseTimerMinutesToken,
    resolveEventAnchorDate,
    resolveUpcomingWeekdayDate,
    stripRepeatTokens,
    TOMORROW_KEYWORD_REGEX,
    WEEKDAY_TOKEN_REGEX,
} from "@/lib/task-title-parser";
import type { ParserKeywordCompletion } from "@/lib/task-title-parser";

const TIME_TOKEN_REGEX = /@(\d{1,2}:\d{2}|\d{3,4}|\d{1,2})\b/i;
const TITLE_TEXT_METRICS_CLASS =
    "text-lg font-medium leading-normal [font-kerning:none] [font-variant-ligatures:none] [font-feature-settings:'liga'_0,'clig'_0]";


function formatTimeUntilDeadline(deadline: Date, now: Date = new Date()): string {
    const diffMs = deadline.getTime() - now.getTime();
    if (diffMs <= 0) {
        return "Deadline passed";
    }
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
    requiresProof: boolean;
    deadlineIso: string;
    eventStartIso: string | null;
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
    const isComposingRef = useRef(false);
    const pendingCaretPositionRef = useRef<number | null>(null);
    const completionTapInProgressRef = useRef(false);
    const pendingTapCompletionRef = useRef<ParserKeywordCompletion | null>(null);
    const currencySymbol = getCurrencySymbol(defaultCurrency);
    const failureCostBounds = getFailureCostBounds(defaultCurrency);
    const normalizedDefaultEventDurationMinutes =
        Number.isInteger(defaultEventDurationMinutes) &&
            defaultEventDurationMinutes >= 1 &&
            defaultEventDurationMinutes <= 720
            ? defaultEventDurationMinutes
            : DEFAULT_EVENT_DURATION_MINUTES;
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
    const {
        titleHighlightSegments,
        inlineKeywordCompletion,
        showTitleOverlay,
    } = useMemo(
        () => buildTaskTitleOverlayModel(title, titleCaretIndex, isTitleFocused, isColorPickerVisible, friends),
        [friends, isColorPickerVisible, isTitleFocused, title, titleCaretIndex]
    );
    const syncTitleHighlightScroll = useCallback(() => {
        if (!titleInputRef.current || !titleHighlightRef.current) return;
        titleHighlightRef.current.scrollLeft = titleInputRef.current.scrollLeft;
    }, []);

    const syncTitleCaretFromElement = useCallback((input: HTMLInputElement | null) => {
        if (!input) return;
        setTitleCaretIndex(input.selectionStart ?? input.value.length);
    }, []);

    const syncTitleCaretFromInput = useCallback(() => {
        syncTitleCaretFromElement(titleInputRef.current);
    }, [syncTitleCaretFromElement]);
    const keepTitleTypingInView = useCallback((input: HTMLInputElement | null) => {
        if (!input) return;
        window.requestAnimationFrame(() => {
            syncTitleHighlightScroll();
            input.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
    }, [syncTitleHighlightScroll]);

    const commitTitleAndCaret = useCallback((nextTitle: string, nextCaretIndex: number) => {
        setTitle(nextTitle);
        setTitleCaretIndex(nextCaretIndex);
        pendingCaretPositionRef.current = nextCaretIndex;
    }, []);

    // Apply pending caret position synchronously after DOM update (before browser paint)
    // so visual selection and overlay model stay in lockstep across desktop and mobile keyboards.
    useLayoutEffect(() => {
        const pos = pendingCaretPositionRef.current;
        if (pos === null) return;
        pendingCaretPositionRef.current = null;
        const input = titleInputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(pos, pos);
        syncTitleCaretFromElement(input);
        syncTitleHighlightScroll();
    }, [syncTitleCaretFromElement, syncTitleHighlightScroll, title, titleCaretIndex]);

    const applyColorPickerSelection = useCallback((aliasToken: string) => {
        const input = titleInputRef.current;
        const caretIndex = input?.selectionStart ?? titleCaretIndex;
        const replacement = replaceNearestColorHelperToken(title, caretIndex, aliasToken);
        if (!replacement.replaced) return;

        commitTitleAndCaret(replacement.nextTitle, replacement.nextCaretIndex);
        setIsColorPickerDismissed(false);
    }, [commitTitleAndCaret, title, titleCaretIndex]);

    const applyInlineKeywordCompletion = useCallback(() => {
        if (!inlineKeywordCompletion) return;
        const { nextTitle, nextCaretIndex } = applyParserKeywordCompletion(title, inlineKeywordCompletion);
        commitTitleAndCaret(nextTitle, nextCaretIndex);
    }, [commitTitleAndCaret, inlineKeywordCompletion, title]);

    const handleInlineCompletionPointerDown = useCallback(
        (event: React.PointerEvent<HTMLElement>) => {
            pendingTapCompletionRef.current = inlineKeywordCompletion;
            completionTapInProgressRef.current = true;
            event.preventDefault();
        },
        [inlineKeywordCompletion]
    );

    const handleInlineCompletionTap = useCallback(
        (event: React.MouseEvent<HTMLElement>) => {
            event.preventDefault();
            event.stopPropagation();
            completionTapInProgressRef.current = false;
            const completion = pendingTapCompletionRef.current ?? inlineKeywordCompletion;
            pendingTapCompletionRef.current = null;
            if (!completion) return;
            const { nextTitle, nextCaretIndex } = applyParserKeywordCompletion(title, completion);
            commitTitleAndCaret(nextTitle, nextCaretIndex);
        },
        [commitTitleAndCaret, inlineKeywordCompletion, title]
    );

    const titleOverlayRuns = useMemo(() => {
        const runs: React.ReactNode[] = [];
        const completionFragmentStart = inlineKeywordCompletion?.fragmentStart ?? -1;
        const completionFragmentEnd =
            inlineKeywordCompletion && inlineKeywordCompletion.fragment.length > 0
                ? completionFragmentStart + inlineKeywordCompletion.fragment.length
                : -1;
        let absoluteIndex = 0;
        let cursorInserted = false;

        const insertCursor = () => {
            runs.push(
                <span
                    key={`title-caret-${titleCaretIndex}`}
                    className="title-caret"
                    aria-hidden="true"
                />
            );
            cursorInserted = true;
        };

        for (const [index, segment] of titleHighlightSegments.entries()) {
            const segmentStart = absoluteIndex;
            const segmentEnd = segmentStart + segment.text.length;
            absoluteIndex = segmentEnd;
            const overlayClassName =
                segment.style?.color
                    ? undefined
                    : segment.className;

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

            for (let splitIndex = 0; splitIndex < splitPoints.length - 1; splitIndex += 1) {
                const partStart = splitPoints[splitIndex];
                const partEnd = splitPoints[splitIndex + 1];
                if (partEnd <= partStart) continue;

                const partText = segment.text.slice(partStart - segmentStart, partEnd - segmentStart);
                const isCompletionFragmentPart =
                    completionFragmentEnd > completionFragmentStart &&
                    partStart < completionFragmentEnd &&
                    partEnd > completionFragmentStart;

                runs.push(
                    <span
                        key={`${index}-${partStart}`}
                        data-testid={isCompletionFragmentPart ? "task-input-completion-fragment" : undefined}
                        className={cn(
                            overlayClassName,
                            isCompletionFragmentPart && "pointer-events-auto cursor-pointer"
                        )}
                        style={segment.style}
                        onPointerDown={isCompletionFragmentPart ? handleInlineCompletionPointerDown : undefined}
                        onClick={isCompletionFragmentPart ? handleInlineCompletionTap : undefined}
                    >
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
                    data-testid="task-input-completion-suffix"
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

    const buildReminderDateOnDeadlineDay = (deadlineDate: Date, hours: number, minutes: number) => {
        const reminderDate = new Date(deadlineDate);
        reminderDate.setHours(hours, minutes, 0, 0);
        return reminderDate;
    };


    const resolveDeadlineFromTitle = useCallback((text: string) => {
        const now = new Date();
        const defaultDeadline = getDefaultDeadline(now);
        const isEventTask = EVENT_TOKEN_REGEX.test(text);

        if (isEventTask) {
            const anchorResolution = resolveEventAnchorDate(text, now);
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

            if (eventResolution.error || !eventResolution.endDate) {
                return {
                    deadline: defaultDeadline,
                    error: eventResolution.error || "Event end time is invalid.",
                };
            }

            return {
                deadline: eventResolution.endDate,
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
        const parsedWeekdayTokens = extractWeekdayDateTokens(text);
        if (parsedDateTokens.length > 1 || parsedWeekdayTokens.length > 1) {
            return {
                deadline: defaultDeadline,
                error: "Use only one date token (for example: monday, 28th or 05/03).",
            };
        }

        const hasTomorrowKeyword = TOMORROW_KEYWORD_REGEX.test(text);
        const timeMatch = text.match(TIME_TOKEN_REGEX);
        const parsedTime = timeMatch ? parseTaskInputTimeToken(timeMatch[1], true) : null;

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

        if (parsedWeekdayTokens.length === 1) {
            const weekdayToken = parsedWeekdayTokens[0];
            const deadline = resolveUpcomingWeekdayDate(weekdayToken.weekday, now);
            deadline.setHours(parsedTime?.hours ?? 23, parsedTime?.minutes ?? 59, 0, 0);

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
    }, [normalizedDefaultEventDurationMinutes]);

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

    const commitDateSheetDraft = (closeSheet: boolean) => {
        const result = resolveDateSheetDraftSubmission({
            deadlineDraftValue,
            reminderDraftValue,
            remindersDraft,
        });
        if ("error" in result) {
            setDeadlineError(result.error);
            return null;
        }

        setDeadlineError(null);
        setIsDeadlineManuallyPicked(true);
        setSelectedDate(result.deadline);
        setReminders(result.reminders);
        setReminderDraftValue("");
        if (closeSheet) {
            setIsDateSheetOpen(false);
        }

        return result;
    };

    const applyDateSheet = () => {
        commitDateSheetDraft(true);
    };

    const handleDateSheetCreate = () => {
        if (isLoading) return;
        formRef.current?.requestSubmit();
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
        syncTitleCaretFromInput();

        const isComposing = isComposingRef.current || e.nativeEvent.isComposing;
        if (isComposing && (e.key === "Enter" || e.key === "Tab")) {
            return;
        }

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
        e.preventDefault();
        formRef.current?.requestSubmit();
    };

    useEffect(() => {
        if (!isDeadlineManuallyPicked) {
            const parserResolution = resolveDeadlineFromTitle(title);
            setSelectedDate(parserResolution.deadline);
            setDeadlineError(parserResolution.error);
        }

        if (/(?:\bvouch|\.v)\s+(me|self|myself)(?=\s|$|\/)/i.test(title)) {
            setSelectedVoucherId(selfUserId);
        } else {
            const vouchMatch = title.match(/(?:\bvouch|\.v)\s+([^\s/]+)/i);
            if (vouchMatch) {
                const name = vouchMatch[1]
                    .toLowerCase()
                    .replace(/^[^a-z0-9@._+-]+/i, "")
                    .replace(/[^a-z0-9@._+-]+$/i, "");
                if (!name) return;
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

    useLayoutEffect(() => {
        syncTitleHighlightScroll();
    }, [showTitleOverlay, syncTitleHighlightScroll, title, titleCaretIndex]);

    const stripMetadata = (text: string) => {
        const withoutStandardTokens = text
            .replace(/@(?:\d{1,2}:\d{2}|\d{3,4}|\d{1,2})\b/g, "")
            .replace(/(?:^|\s)-start\s*(?:\d{1,2}:\d{2}|\d{1,4})\b/gi, " ")
            .replace(/(?:^|\s)-end\s*(?:\d{1,2}:\d{2}|\d{1,4})\b/gi, " ")
            .replace(/\b([12]?\d|3[01])(?:st|nd|rd|th)\b/gi, "")
            .replace(/\b(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])(?:\/\d{4})?\b/g, "")
            .replace(/\bremind\s+(?:\d{1,2}:\d{2}|\d{4})\b/gi, "")
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

    const parseTaskTitleAndSubtasks = (text: string) => {
        const cleaned = stripMetadata(text);
        const segments = cleaned.split("/").map((segment) => segment.trim());
        const taskTitle = segments[0] || "";
        const subtasks = segments.slice(1).filter(Boolean);

        return { taskTitle, subtasks };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        let effectiveIsDeadlineManuallyPicked = isDeadlineManuallyPicked;
        let effectiveSelectedDate = selectedDate;
        let effectiveReminders = reminders;

        if (isDateSheetOpen) {
            const draftResult = resolveDateSheetDraftSubmission({
                deadlineDraftValue,
                reminderDraftValue,
                remindersDraft,
            });
            if ("error" in draftResult) {
                setDeadlineError(draftResult.error);
                return;
            }

            setDeadlineError(null);
            setIsDeadlineManuallyPicked(true);
            setSelectedDate(draftResult.deadline);
            setReminders(draftResult.reminders);
            setReminderDraftValue("");
            setIsDateSheetOpen(false);

            effectiveIsDeadlineManuallyPicked = true;
            effectiveSelectedDate = draftResult.deadline;
            effectiveReminders = draftResult.reminders;
        }

        const { taskTitle, subtasks } = parseTaskTitleAndSubtasks(title);
        const requiredPomoParse = parseRequiredPomoFromTitle(title);
        const requiredPomoMinutes = requiredPomoParse.requiredPomoMinutes;
        const requiresProof = parseProofRequiredFromTitle(title);
        const parsedRepeatType = parseRepeatTokenFromTitle(title);
        const effectiveRecurrenceType = parsedRepeatType ?? (recurrenceType || null);

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
        if (requiredPomoParse.error) {
            setDeadlineError(requiredPomoParse.error);
            return;
        }

        const parserResolution = effectiveIsDeadlineManuallyPicked ? null : resolveDeadlineFromTitle(title);
        if (parserResolution?.error) {
            setDeadlineError(parserResolution.error);
            return;
        }

        let deadlineToSubmit = parserResolution?.deadline ?? effectiveSelectedDate ?? getDefaultDeadline();
        let eventStartDate: Date | null = null;
        let eventEndDate: Date | null = null;

        if (isEventTask) {
            const anchorDateResolution = effectiveIsDeadlineManuallyPicked
                ? {
                    anchorDate: effectiveSelectedDate ?? getDefaultDeadline(),
                    error: null as string | null,
                }
                : resolveEventAnchorDate(title);

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

            eventStartDate = eventResolution.startDate;
            eventEndDate = eventResolution.endDate;
            deadlineToSubmit = eventResolution.endDate;
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
        const remindersToSubmit = normalizeReminderDates([...effectiveReminders, ...parserReminderDates]);

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
            effectiveRecurrenceType === "WEEKLY"
                ? (customDays.length > 0 ? customDays : [getSelectedWeekday()])
                : [];

        const payload: TaskInputCreatePayload = {
            title: taskTitle,
            rawTitle: title,
            subtasks,
            requiredPomoMinutes,
            requiresProof,
            deadlineIso: deadlineToSubmit.toISOString(),
            eventStartIso: eventStartDate ? eventStartDate.toISOString() : null,
            eventEndIso: eventEndDate ? eventEndDate.toISOString() : null,
            reminderIsos: remindersToSubmit.map((reminder) => reminder.toISOString()),
            voucherId: selectedVoucherId,
            failureCost,
            recurrenceType: effectiveRecurrenceType,
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
            if (payload.eventStartIso) {
                formData.append("eventStartIso", payload.eventStartIso);
            }
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
            formData.append("requiresProof", payload.requiresProof ? "true" : "false");
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
                    {showTitleOverlay && (
                        <div
                            ref={titleHighlightRef}
                            aria-hidden="true"
                            className={cn(
                                "pointer-events-none absolute inset-0 overflow-hidden px-5 py-4 text-white",
                                TITLE_TEXT_METRICS_CLASS
                            )}
                        >
                            <span className="whitespace-pre">{titleOverlayRuns}</span>
                        </div>
                    )}
                    <input
                        ref={titleInputRef}
                        type="text"
                        value={title}
                        onChange={(e) => {
                            setTitle(e.currentTarget.value);
                            syncTitleCaretFromElement(e.currentTarget);
                            keepTitleTypingInView(e.currentTarget);
                        }}
                        onKeyDown={handleTitleKeyDown}
                        onSelect={() => {
                            syncTitleCaretFromInput();
                            keepTitleTypingInView(titleInputRef.current);
                        }}
                        onClick={() => {
                            syncTitleCaretFromInput();
                            keepTitleTypingInView(titleInputRef.current);
                        }}
                        onFocus={() => {
                            completionTapInProgressRef.current = false;
                            setIsTitleFocused(true);
                            syncTitleCaretFromInput();
                            keepTitleTypingInView(titleInputRef.current);
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
                        enterKeyHint="done"
                        placeholder="click the bulb button on the right"
                        className={cn(
                            "w-full bg-transparent border-none px-5 py-4 placeholder:text-slate-500/70 focus:outline-none transition-all",
                            showTitleOverlay ? "text-transparent [caret-color:transparent]" : "text-white caret-white",
                            TITLE_TEXT_METRICS_CLASS
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
                        <button
                            type="button"
                            onClick={handleDateSheetCreate}
                            disabled={isLoading || !deadlineDraftValue}
                            aria-label="Apply deadline and create task"
                            title="Apply deadline and create task"
                            className="h-9 w-9 shrink-0 rounded-md border border-blue-500/30 bg-blue-600/20 text-blue-300 transition-colors hover:bg-blue-600/30 disabled:opacity-50 flex items-center justify-center"
                        >
                            {isLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
                            ) : (
                                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                            )}
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

