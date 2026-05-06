"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Calendar, CalendarDays, Camera, Check, Loader2, Repeat, User } from "lucide-react";
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
import { TaskDateTimePicker } from "@/components/ui/task-date-time-picker";
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
import {
    buildReminderDateOnDeadlineDay,
    formatCustomDaysLabel,
    formatDeadlineLabel,
    formatDeadlineTitle,
    formatReminderLabel,
    formatTimeUntilDeadline,
    getSelectedWeekday,
} from "@/components/task-input/utils/task-input-formatters";
import {
    hasParserDrivenDeadlineHint,
    resolveTaskDeadline,
    stripMetadata,
    parseTaskTitleAndSubtasks,
} from "@/lib/parser_keyword_resolver";
import type { ParserKeywordCompletion } from "@/lib/task-title-parser";
import { useTaskInputSubmit } from "@/components/task-input/hooks/use-task-input-submit";

const TIME_TOKEN_REGEX = /(?:^|\s)@(\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,4}(?:\s*(?:am|pm))?|\d{1,2}(?:\s*(?:am|pm))?)\b/i;
const weekdayOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon–Sun
const weekdayShort = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const TITLE_TEXT_METRICS_CLASS =
    "text-base sm:text-lg font-medium leading-normal [font-kerning:none] [font-variant-ligatures:none] [font-feature-settings:'liga'_0,'clig'_0]";

interface TaskInputProps {
    friends: Profile[];
    defaultFailureCostEuros: string;
    defaultCurrency: SupportedCurrency;
    defaultVoucherId: string | null;
    defaultEventDurationMinutes: number;
    defaultRequiresProofForAllTasks: boolean;
    deadlineOneHourWarningEnabled?: boolean;
    deadlineFinalWarningEnabled?: boolean;
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
    isStrict: boolean;
}

export interface TaskInputHandle {
    focusTitle: () => void;
}

export const TaskInput = forwardRef<TaskInputHandle, TaskInputProps>(function TaskInput({
    friends,
    defaultFailureCostEuros,
    defaultCurrency,
    defaultVoucherId,
    defaultEventDurationMinutes,
    defaultRequiresProofForAllTasks,
    deadlineOneHourWarningEnabled = true,
    deadlineFinalWarningEnabled = true,
    selfUserId,
    onCreateTaskOptimistic,
}: TaskInputProps, ref) {
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
    const [dateSheetNowMs, setDateSheetNowMs] = useState(0);
    const [deadlineDraftValue, setDeadlineDraftValue] = useState("");
    const [eventStartValue, setEventStartValue] = useState("");
    const [eventStartDraftValue, setEventStartDraftValue] = useState("");
    const [reminders, setReminders] = useState<Date[]>([]);
    const [remindersDraft, setRemindersDraft] = useState<Date[]>([]);
    const [reminderDraftValue, setReminderDraftValue] = useState("");

    const [recurrenceType, setRecurrenceType] = useState<string>("");
    const [recurrenceLabel, setRecurrenceLabel] = useState<string>("");
    const [showCustomRecurrenceInline, setShowCustomRecurrenceInline] = useState(false);
    const [customDays, setCustomDays] = useState<number[]>([]);
    const [requiresProof, setRequiresProof] = useState(defaultRequiresProofForAllTasks);
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
    const nearestColorHelperStart = nearestColorHelperToken?.start ?? null;
    const nearestColorHelperEnd = nearestColorHelperToken?.end ?? null;
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
    const keepTitleTypingInView = useCallback((input: HTMLInputElement | null, ensureVisible: boolean = false) => {
        if (!input) return;
        window.requestAnimationFrame(() => {
            syncTitleHighlightScroll();
            if (ensureVisible) {
                input.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
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

    useImperativeHandle(ref, () => ({
        focusTitle: () => {
            titleInputRef.current?.focus();
            titleInputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        },
    }), []);

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
            // Keep native input caret active to avoid overlay-caret layout jitter while typing.
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
                        className={overlayClassName}
                        style={segment.style}
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
        if (nearestColorHelperStart === null || nearestColorHelperEnd === null) return;
        setColorPickerIndex(0);
    }, [nearestColorHelperEnd, nearestColorHelperStart]);

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
        setRequiresProof(defaultRequiresProofForAllTasks);
    }, [defaultRequiresProofForAllTasks]);

    useEffect(() => {
        // Profile default takes precedence over localStorage — if the user has a
        // default voucher set and it's still a valid friend, always use it.
        if (defaultVoucherId && friends.some((f) => f.id === defaultVoucherId)) {
            setSelectedVoucherId(defaultVoucherId);
            return;
        }

        // No profile default (or default is no longer a friend) — fall back to
        // the last voucher the user picked, then to self.
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
    }, [defaultVoucherId, friends, resolveVoucherSelection]);

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

    const selectedWeekday = getSelectedWeekday(selectedDate);

    const getDraftDeadline = () => {
        if (!deadlineDraftValue) return null;
        return fromDateTimeLocalValue(deadlineDraftValue);
    };

    const resetDeadlineToDefault = () => {
        setDeadlineError(null);
        setIsDeadlineManuallyPicked(false);
        setSelectedDate(getDefaultDeadline());
        setReminders([]);
        setRemindersDraft([]);
        setReminderDraftValue("");
        setEventStartValue("");
        setEventStartDraftValue("");
    };

    const openDateSheet = () => {
        setDeadlineDraftValue(
            toDateTimeLocalValue(selectedDate ?? getDefaultDeadline())
        );
        setEventStartDraftValue(eventStartValue);
        setRemindersDraft(reminders.slice().sort((a, b) => a.getTime() - b.getTime()));
        setReminderDraftValue("");
        setDateSheetNowMs(Date.now());
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
            eventStartDraftValue,
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
        const nextEventStartValue = result.eventStart ? toDateTimeLocalValue(result.eventStart) : "";
        setEventStartValue(nextEventStartValue);
        setEventStartDraftValue(nextEventStartValue);
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

    const scheduledReminderPreview = useMemo(() => {
        const deadline = fromDateTimeLocalValue(deadlineDraftValue);
        if (!deadline) return [];

        const nowMs = dateSheetNowMs || 0;
        const deadlineMs = deadline.getTime();
        if (Number.isNaN(deadlineMs)) return [];

        const rows: Array<{ key: string; label: string; reminder: Date }> = [];
        const addDefaultReminder = (enabled: boolean, offsetMs: number, label: string, key: string) => {
            if (!enabled) return;
            const reminder = new Date(deadlineMs - offsetMs);
            if (reminder.getTime() <= nowMs) return;
            rows.push({ key, label, reminder });
        };

        addDefaultReminder(deadlineOneHourWarningEnabled, 60 * 60 * 1000, "1h", "default-1h");
        addDefaultReminder(deadlineFinalWarningEnabled, 10 * 60 * 1000, "10m", "default-10m");

        const pendingReminder = reminderDraftValue.trim()
            ? fromDateTimeLocalValue(reminderDraftValue)
            : null;
        const manualReminders = normalizeReminderDates(
            pendingReminder ? [...remindersDraft, pendingReminder] : remindersDraft
        );

        for (const reminder of manualReminders) {
            const reminderMs = reminder.getTime();
            if (reminderMs <= nowMs || reminderMs > deadlineMs) continue;
            rows.push({
                key: `manual-${reminder.toISOString()}`,
                label: "Manual",
                reminder,
            });
        }

        return rows.sort((a, b) => a.reminder.getTime() - b.reminder.getTime());
    }, [
        deadlineDraftValue,
        deadlineFinalWarningEnabled,
        deadlineOneHourWarningEnabled,
        dateSheetNowMs,
        reminderDraftValue,
        remindersDraft,
    ]);

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
        const shouldApplyParserDeadline = !isDeadlineManuallyPicked || hasParserDrivenDeadlineHint(title);
        if (!shouldApplyParserDeadline) return;

        const result = resolveTaskDeadline(title, new Date(), normalizedDefaultEventDurationMinutes);
        if (!result.error) {
            setDeadlineError(null);
            setSelectedDate(result.deadline);
            return;
        }

        setDeadlineError(result.error);
        setSelectedDate(getDefaultDeadline());
    }, [title, isDeadlineManuallyPicked, normalizedDefaultEventDurationMinutes]);

    useEffect(() => {
        if (/(?:\bvouch|\.v)\s+(me|self)(?=\s|$|\/)/i.test(title)) {
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
    }, [title, friends, isDeadlineManuallyPicked, selfUserId]);




    const handleSubmit = useTaskInputSubmit({
        title,
        recurrenceType,
        customDays,
        selectedWeekday,
        selectedVoucherId,
        failureCost,
        requiresProof,
        defaultRequiresProofForAllTasks,
        normalizedDefaultEventDurationMinutes,
        isLoading,
        isDateSheetOpen,
        deadlineDraftValue,
        eventStartValue,
        eventStartDraftValue,
        reminderDraftValue,
        remindersDraft,
        reminders,
        selectedDate,
        isDeadlineManuallyPicked,
        onCreateTaskOptimistic,
        setIsLoading,
        setDeadlineError,
        setShowShake,
        setTitle,
        setRecurrenceType,
        setRecurrenceLabel,
        setShowCustomRecurrenceInline,
        setRequiresProof,
        resetDeadlineToDefault,
    });

    const isEventTask = EVENT_TOKEN_REGEX.test(title);

    const handleEventToggle = useCallback(() => {
        const titleWithoutEvent = title
            .replace(/(^|\s)-event(?=\s|$)/gi, " ")
            .replace(/\s+/g, " ")
            .trim();

        const baseTitle = title.trimEnd();
        const nextTitle = isEventTask
            ? titleWithoutEvent
            : `${baseTitle}${baseTitle ? " " : ""}-event`;

        commitTitleAndCaret(nextTitle, nextTitle.length);
        keepTitleTypingInView(titleInputRef.current, true);
    }, [commitTitleAndCaret, isEventTask, keepTitleTypingInView, title]);

    return (
        <form ref={formRef} onSubmit={handleSubmit} className="relative space-y-3 mb-8">
            <div className="bg-slate-900/50 border border-slate-800/50 focus-within:border-slate-700/50 rounded-xl transition-all shadow-2xl overflow-visible">
                <div className="relative">

                    <input
                        ref={titleInputRef}
                        type="text"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
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
                            keepTitleTypingInView(titleInputRef.current, true);
                        }}
                        onFocus={() => {
                            completionTapInProgressRef.current = false;
                            setIsTitleFocused(true);
                            syncTitleCaretFromInput();
                            keepTitleTypingInView(titleInputRef.current, true);
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
                            "w-full bg-transparent border-none px-5 py-4 placeholder:text-slate-500/70 focus:outline-none transition-colors",
                            "text-white caret-white",
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

                            <div className={`min-w-[112px] flex-1 shrink ${showShake ? "animate-shake" : ""}`}>
                                <Select value={selectedVoucherId} onValueChange={setSelectedVoucherId}>
                                    <SelectTrigger className="h-9 w-full bg-slate-800/30 border-slate-700/30 text-slate-300 text-[10px] font-mono focus:ring-0 rounded-lg px-2.5">
                                        <span className="flex min-w-0 items-center">
                                            <User className="h-3 w-3 mr-1.5 shrink-0 opacity-70" />
                                            <SelectValue placeholder="Voucher" />
                                        </span>
                                    </SelectTrigger>
                                    <SelectContent
                                        position="popper"
                                        align="start"
                                        sideOffset={6}
                                        className="w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)] rounded-xl border-slate-700/80 bg-slate-900/95 text-slate-200 shadow-[0_14px_36px_rgba(2,6,23,0.6)] backdrop-blur-sm"
                                    >
                                        {selfUserId && (
                                            <SelectItem value={selfUserId} className="text-[11px] font-mono focus:bg-slate-800 focus:text-white">
                                                Self
                                            </SelectItem>
                                        )}
                                        {friends.map((friend) => (
                                            <SelectItem
                                                key={friend.id}
                                                value={friend.id}
                                                className="text-[11px] font-mono focus:bg-slate-800 focus:text-white"
                                            >
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
                                    "h-9 min-w-[160px] flex-1 px-2.5 bg-slate-800/30 hover:bg-slate-700/30 border border-slate-700/30 text-slate-400 hover:text-slate-200 rounded-lg transition-all flex items-center justify-start gap-1.5",
                                    selectedDate && "text-blue-400 border-blue-500/30 bg-blue-500/5"
                                )}
                                title={formatDeadlineTitle(selectedDate, hasMounted)}
                            >
                                <Calendar className="h-3.5 w-3.5 shrink-0" />
                                <span className="text-[10px] font-mono truncate">
                                    {formatDeadlineLabel(selectedDate, hasMounted)}
                                    {reminders.length > 0 ? ` • ${reminders.length}R` : ""}
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={handleEventToggle}
                                className={cn(
                                    "h-9 px-2.5 shrink-0 border rounded-lg transition-all flex items-center justify-center gap-1.5 text-[10px] font-mono",
                                    isEventTask
                                        ? "bg-indigo-500/15 border-indigo-400/40 text-indigo-200"
                                        : "bg-slate-800/30 hover:bg-slate-700/30 border-slate-700/30 text-slate-400 hover:text-slate-200"
                                )}
                                title={isEventTask ? "Event enabled for this task" : "Mark this task as an event"}
                            >
                                <CalendarDays className="h-3.5 w-3.5" />
                                <span>Event</span>
                            </button>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className={cn(
                                            "h-9 w-9 shrink-0 bg-slate-800/30 hover:bg-slate-700/30 border border-slate-700/30 text-slate-400 hover:text-slate-200 rounded-lg transition-all flex items-center justify-center",
                                            recurrenceType && "text-purple-400 border-purple-400/30 bg-purple-400/10"
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
                                            setCustomDays([selectedWeekday]);
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
                                            const initialDays = customDays.length > 0 ? customDays : [selectedWeekday];
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

                            <button
                                type="button"
                                onClick={() => setRequiresProof((prev) => !prev)}
                                className={cn(
                                    "h-9 px-2.5 shrink-0 border rounded-lg transition-all flex items-center justify-center gap-1.5 text-[10px] font-mono",
                                    requiresProof
                                        ? "bg-cyan-500/15 border-cyan-400/40 text-cyan-200"
                                        : "bg-slate-800/30 hover:bg-slate-700/30 border-slate-700/30 text-slate-400 hover:text-slate-200"
                                )}
                                title={requiresProof ? "Proof required by default for this task" : "Proof optional for this task"}
                            >
                                <Camera className="h-3.5 w-3.5" />
                                <span>Proof</span>
                            </button>
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
                <DialogContent className="bg-slate-900 border-slate-800 text-slate-200 sm:max-w-[640px] [&>[data-slot='dialog-close']]:text-slate-300 [&>[data-slot='dialog-close']]:opacity-100 [&>[data-slot='dialog-close']]:hover:text-white">
                    <DialogHeader>
                        <DialogTitle className="text-white">Set deadline</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-3">
                        <TaskDateTimePicker
                            deadlineValue={deadlineDraftValue}
                            eventStartValue={eventStartDraftValue}
                            onDeadlineValueChange={setDeadlineDraftValue}
                            onEventStartValueChange={setEventStartDraftValue}
                            actions={
                                <>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setIsDateSheetOpen(false)}
                                            className="h-9 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                resetDeadlineToDefault();
                                                setIsDateSheetOpen(false);
                                            }}
                                            className="h-9 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800"
                                        >
                                            Reset
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={applyDateSheet}
                                        disabled={!deadlineDraftValue}
                                        className="h-9 w-full rounded-md bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30 disabled:opacity-50"
                                    >
                                        Apply
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleDateSheetCreate}
                                        disabled={isLoading || !deadlineDraftValue}
                                        aria-label="Apply deadline and create task"
                                        title="Apply deadline and create task"
                                        className="h-9 w-full shrink-0 rounded-md border border-blue-500/30 bg-blue-600/20 text-blue-300 transition-colors hover:bg-blue-600/30 disabled:opacity-50 flex items-center justify-center"
                                    >
                                        {isLoading ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
                                        ) : (
                                            <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                        )}
                                    </button>
                                </>
                            }
                        />

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

                            {scheduledReminderPreview.length > 0 && (
                                <div className="space-y-1.5">
                                    {scheduledReminderPreview.map(({ key, label, reminder }) => (
                                        <div key={key} className="flex items-center justify-between gap-2">
                                            <span className="text-xs text-slate-300">{formatReminderLabel(reminder)}</span>
                                            <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {remindersDraft.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {remindersDraft.map((reminder) => (
                                        <button
                                            key={reminder.toISOString()}
                                            type="button"
                                            onClick={() => handleRemoveReminderDraft(reminder.toISOString())}
                                            className="h-7 rounded-md border border-slate-700 bg-slate-950/50 px-2 text-[11px] text-slate-400 transition-colors hover:border-red-400/40 hover:text-red-300"
                                        >
                                            Remove {formatReminderLabel(reminder)}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            {deadlineError && (
                <p className="px-2 text-xs text-red-400">{deadlineError}</p>
            )}
        </form>
    );
});
