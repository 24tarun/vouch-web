import { useCallback, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { toast } from "sonner";
import { createTask } from "@/actions/tasks";
import { fromDateTimeLocalValue } from "@/lib/datetime-local";
import { resolveEventSchedule } from "@/lib/task-title-event-time";
import { EVENT_TOKEN_REGEX, getDefaultDeadline, parseProofRequiredFromTitle, parseReminderTimesFromTitle, parseRepeatTokenFromTitle, resolveEventAnchorDate } from "@/lib/task-title-parser";
import { hasParserDrivenDeadlineHint, parseTaskTitleAndSubtasks, resolveTaskDeadline } from "@/lib/parser_keyword_resolver";
import { normalizeReminderDates, resolveDateSheetDraftSubmission } from "@/lib/task-deadline-sheet";
import { validateEventColorUsage } from "@/lib/task-title-event-color";
import { parseRequiredPomoFromTitle } from "@/lib/pomodoro";
import { buildReminderDateOnDeadlineDay, formatTimeUntilDeadline } from "@/components/task-input/utils/task-input-formatters";
import type { TaskInputCreatePayload } from "@/components/TaskInput";

interface UseTaskInputSubmitArgs {
    title: string;
    recurrenceType: string;
    customDays: number[];
    selectedWeekday: number;
    selectedVoucherId: string;
    failureCost: string;
    requiresProof: boolean;
    defaultRequiresProofForAllTasks: boolean;
    normalizedDefaultEventDurationMinutes: number;
    isLoading: boolean;
    isDateSheetOpen: boolean;
    deadlineDraftValue: string;
    eventStartValue: string;
    eventStartDraftValue: string;
    reminderDraftValue: string;
    remindersDraft: Date[];
    reminders: Date[];
    selectedDate: Date | null;
    isDeadlineManuallyPicked: boolean;
    onCreateTaskOptimistic?: (payload: TaskInputCreatePayload) => void;
    setIsLoading: Dispatch<SetStateAction<boolean>>;
    setDeadlineError: Dispatch<SetStateAction<string | null>>;
    setShowShake: Dispatch<SetStateAction<boolean>>;
    setTitle: Dispatch<SetStateAction<string>>;
    setRecurrenceType: Dispatch<SetStateAction<string>>;
    setRecurrenceLabel: Dispatch<SetStateAction<string>>;
    setShowCustomRecurrenceInline: Dispatch<SetStateAction<boolean>>;
    setRequiresProof: Dispatch<SetStateAction<boolean>>;
    resetDeadlineToDefault: () => void;
}

export function useTaskInputSubmit(args: UseTaskInputSubmitArgs) {
    const {
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
    } = args;

    return useCallback(async (e: FormEvent) => {
        e.preventDefault();
        let effectiveIsDeadlineManuallyPicked = isDeadlineManuallyPicked;
        let effectiveSelectedDate = selectedDate;
        let effectiveEventStartDate = fromDateTimeLocalValue(eventStartValue);
        let effectiveReminders = reminders;

        if (isDateSheetOpen) {
            const draftResult = resolveDateSheetDraftSubmission({
                deadlineDraftValue,
                eventStartDraftValue,
                reminderDraftValue,
                remindersDraft,
            });
            if ("error" in draftResult) {
                setDeadlineError(draftResult.error);
                return;
            }

            effectiveIsDeadlineManuallyPicked = true;
            effectiveSelectedDate = draftResult.deadline;
            effectiveEventStartDate = draftResult.eventStart;
            effectiveReminders = draftResult.reminders;
        }

        const { title: taskTitle, subtasks } = parseTaskTitleAndSubtasks(title);
        const titleRequiresProof = parseProofRequiredFromTitle(title);
        const requiredPomoParse = parseRequiredPomoFromTitle(title);
        const requiredPomoMinutes = requiredPomoParse.requiredPomoMinutes;
        const parsedRepeatType = parseRepeatTokenFromTitle(title);
        const effectiveRecurrenceType = parsedRepeatType ?? (recurrenceType || null);

        if (!taskTitle || isLoading) return;

        if (!selectedVoucherId) {
            setShowShake(true);
            setTimeout(() => setShowShake(false), 500);
            return;
        }

        const isEventTask = EVENT_TOKEN_REGEX.test(title);
        const isStrict = /(^|\s)-bound(?=\s|$)/i.test(title);
        const colorValidation = validateEventColorUsage(title, isEventTask);
        if (colorValidation.error) {
            setDeadlineError(colorValidation.error);
            return;
        }
        if (requiredPomoParse.error) {
            setDeadlineError(requiredPomoParse.error);
            return;
        }

        const manuallyPickedEventWindow = effectiveIsDeadlineManuallyPicked && Boolean(effectiveEventStartDate);
        const shouldApplyParserDeadline =
            !effectiveIsDeadlineManuallyPicked ||
            (hasParserDrivenDeadlineHint(title) && !manuallyPickedEventWindow);
        const parserResolution = shouldApplyParserDeadline
            ? resolveTaskDeadline(title, new Date(), normalizedDefaultEventDurationMinutes)
            : null;
        if (parserResolution?.error) {
            setDeadlineError(parserResolution.error);
            return;
        }

        let deadlineToSubmit = parserResolution?.deadline ?? effectiveSelectedDate ?? getDefaultDeadline();
        let eventStartDate: Date | null = null;
        let eventEndDate: Date | null = null;

        if (isEventTask) {
            if (effectiveIsDeadlineManuallyPicked && effectiveEventStartDate) {
                eventStartDate = effectiveEventStartDate;
                eventEndDate = deadlineToSubmit;
                if (eventEndDate.getTime() <= eventStartDate.getTime()) {
                    setDeadlineError("End time must be after start time.");
                    return;
                }
                deadlineToSubmit = eventEndDate;
            } else {
                const anchorDateResolution = effectiveIsDeadlineManuallyPicked
                    ? { anchorDate: effectiveSelectedDate ?? getDefaultDeadline(), error: null as string | null }
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
            }
        } else if (deadlineToSubmit.getTime() <= Date.now()) {
            setDeadlineError("Deadline must be in the future.");
            return;
        }

        const parsedReminderTimes = parseReminderTimesFromTitle(title);
        const parserReminderDates = parsedReminderTimes.map(({ hours, minutes }) =>
            buildReminderDateOnDeadlineDay(deadlineToSubmit, hours, minutes)
        );
        const remindersToSubmit = normalizeReminderDates([...effectiveReminders, ...parserReminderDates]);

        if (remindersToSubmit.some((reminder) => reminder.getTime() <= Date.now())) {
            setDeadlineError("All reminders must be in the future.");
            return;
        }

        if (remindersToSubmit.some((reminder) => reminder.getTime() > deadlineToSubmit.getTime())) {
            setDeadlineError("Reminders must be before or at the deadline.");
            return;
        }

        setDeadlineError(null);

        const recurrenceDaysToUse =
            effectiveRecurrenceType === "WEEKLY"
                ? (customDays.length > 0 ? customDays : [selectedWeekday])
                : [];

        const payload: TaskInputCreatePayload = {
            title: taskTitle,
            rawTitle: title,
            subtasks,
            requiredPomoMinutes,
            requiresProof: requiresProof || titleRequiresProof,
            deadlineIso: deadlineToSubmit.toISOString(),
            eventStartIso: eventStartDate ? eventStartDate.toISOString() : null,
            eventEndIso: eventEndDate ? eventEndDate.toISOString() : null,
            reminderIsos: remindersToSubmit.map((reminder) => reminder.toISOString()),
            voucherId: selectedVoucherId,
            failureCost,
            recurrenceType: effectiveRecurrenceType,
            recurrenceDays: recurrenceDaysToUse,
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            isStrict,
        };

        const timeUntilDeadline = formatTimeUntilDeadline(deadlineToSubmit);

        const resetAfterCreate = () => {
            setTitle("");
            setRecurrenceType("");
            setRecurrenceLabel("");
            setShowCustomRecurrenceInline(false);
            setRequiresProof(defaultRequiresProofForAllTasks);
            resetDeadlineToDefault();
        };

        if (onCreateTaskOptimistic) {
            onCreateTaskOptimistic(payload);
            toast.success(timeUntilDeadline);
            resetAfterCreate();
            return;
        }

        setIsLoading(true);
        try {
            const formData = new FormData();
            formData.append("title", payload.title);
            formData.append("rawTitle", payload.rawTitle);
            formData.append("deadline", payload.deadlineIso);
            if (payload.eventStartIso) formData.append("eventStartIso", payload.eventStartIso);
            if (payload.eventEndIso) formData.append("eventEndIso", payload.eventEndIso);
            formData.append("voucherId", payload.voucherId);
            formData.append("failureCost", payload.failureCost);
            if (payload.subtasks.length > 0) formData.append("subtasks", JSON.stringify(payload.subtasks));
            if (payload.requiredPomoMinutes != null) formData.append("requiredPomoMinutes", String(payload.requiredPomoMinutes));
            formData.append("requiresProof", payload.requiresProof ? "true" : "false");
            if (payload.isStrict) formData.append("isStrict", "true");
            if (payload.reminderIsos.length > 0) formData.append("reminders", JSON.stringify(payload.reminderIsos));

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
                resetAfterCreate();
            }
        } catch (error) {
            console.error("Failed to create task", error);
        } finally {
            setIsLoading(false);
        }
    }, [
        customDays,
        deadlineDraftValue,
        defaultRequiresProofForAllTasks,
        eventStartValue,
        eventStartDraftValue,
        failureCost,
        isDateSheetOpen,
        isDeadlineManuallyPicked,
        isLoading,
        normalizedDefaultEventDurationMinutes,
        onCreateTaskOptimistic,
        recurrenceType,
        reminderDraftValue,
        reminders,
        remindersDraft,
        requiresProof,
        resetDeadlineToDefault,
        selectedDate,
        selectedVoucherId,
        selectedWeekday,
        setDeadlineError,
        setIsLoading,
        setRecurrenceLabel,
        setRecurrenceType,
        setRequiresProof,
        setShowCustomRecurrenceInline,
        setShowShake,
        setTitle,
        title,
    ]);
}
