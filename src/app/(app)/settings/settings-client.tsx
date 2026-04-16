"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GlassToggle } from "@/components/GlassToggle";
import { deleteAccount, getActiveVoucherTasks, updateUserDefaults, updateUsername } from "@/actions/auth";
import { exportUserData } from "@/actions/export";
import {
    acceptIncomingFriendRequest,
    blockRelationshipUser,
    getBlockedUsers,
    getFriends,
    getRelationshipData,
    rejectIncomingFriendRequest,
    removeFriendById,
    searchUsersForFriendship,
    sendFriendRequestToUser,
    setOrcaAsFriendEnabled,
    unblockRelationshipUser,
    withdrawOutgoingFriendRequest,
    type BlockedUserOption,
    type IncomingFriendRequest,
    type OutgoingFriendRequest,
    type SearchCandidate,
} from "@/actions/friends";
import {
    disconnectGoogleCalendar,
    listGoogleCalendarsForSettings,
    setGoogleCalendarCalendar,
    setGoogleCalendarAppToGoogleEnabled,
    setGoogleCalendarGoogleToAppEnabled,
    setGoogleCalendarImportTaggedOnly,
    startGoogleCalendarConnect,
    type GoogleCalendarIntegrationState,
} from "@/actions/google-calendar";
import { deleteSubscription, saveSubscription } from "@/actions/push";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SignOutMenuForm } from "@/components/SignOutMenuForm";
import { HardRefreshButton } from "@/components/HardRefreshButton";
import type { FriendProfile, Profile } from "@/lib/types";
import {
    getFailureCostBounds,
    getCurrencySymbol,
    normalizeCurrency,
    SUPPORTED_CURRENCIES,
    type SupportedCurrency,
} from "@/lib/currency";
import { formatDateOnlyDDMMYYYY } from "@/lib/date-format";
import {
    DEFAULT_EVENT_DURATION_MINUTES,
    DEFAULT_FAILURE_COST_CENTS,
    DEFAULT_POMO_DURATION_MINUTES,
    MAX_POMO_DURATION_MINUTES,
} from "@/lib/constants";
import { AI_VOUCHER_DISPLAY_NAME, ORCA_PROFILE_ID } from "@/lib/ai-voucher/constants";
import { normalizePomoDurationMinutes } from "@/lib/pomodoro";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

interface SettingsClientProps {
    profile: Profile;
    friends: FriendProfile[];
    googleCalendarIntegration: GoogleCalendarIntegrationState;
}

type VoucherConflictTask = {
    id: string;
    title: string;
    ownerUsername: string;
};

export default function SettingsClient({
    profile,
    friends: initialFriends,
    googleCalendarIntegration,
}: SettingsClientProps) {
    const initialCurrency = normalizeCurrency(profile.currency);
    const initialFailureCostBounds = getFailureCostBounds(initialCurrency);
    const initialFailureCostMajorRaw = (profile.default_failure_cost_cents ?? DEFAULT_FAILURE_COST_CENTS) / 100;
    const initialFailureCostMajorClamped = Math.min(
        initialFailureCostBounds.maxMajor,
        Math.max(initialFailureCostBounds.minMajor, initialFailureCostMajorRaw)
    );

    const [friends, setFriends] = useState<FriendProfile[]>(initialFriends);
    const [relationshipFriends, setRelationshipFriends] = useState<Array<IncomingFriendRequest["sender"]>>([]);
    const [incomingRequests, setIncomingRequests] = useState<IncomingFriendRequest[]>([]);
    const [outgoingRequests, setOutgoingRequests] = useState<OutgoingFriendRequest[]>([]);
    const [relationshipsLoading, setRelationshipsLoading] = useState(false);
    const [relationshipsError, setRelationshipsError] = useState<string | null>(null);
    const [relationshipSuccess, setRelationshipSuccess] = useState<string | null>(null);
    const [relationshipInFlight, setRelationshipInFlight] = useState<Record<string, string | null>>({});
    const [friendSearchQuery, setFriendSearchQuery] = useState("");
    const [friendSearchResults, setFriendSearchResults] = useState<SearchCandidate[]>([]);
    const [friendSearchLoading, setFriendSearchLoading] = useState(false);
    const [friendSearchError, setFriendSearchError] = useState<string | null>(null);
    const [blockedUsers, setBlockedUsers] = useState<BlockedUserOption[]>([]);
    const [blockedUsersLoading, setBlockedUsersLoading] = useState(false);
    const [blockedUsersError, setBlockedUsersError] = useState<string | null>(null);
    const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);
    const [orcaFriendEnabled, setOrcaFriendEnabled] = useState(profile.orca_friend_opt_in ?? false);
    const [isOrcaFriendLoading, setIsOrcaFriendLoading] = useState(false);
    const [orcaFriendError, setOrcaFriendError] = useState<string | null>(null);
    const [orcaFriendSuccess, setOrcaFriendSuccess] = useState<string | null>(null);

    const [username, setUsername] = useState(profile.username);
    const [isUsernameLoading, setIsUsernameLoading] = useState(false);
    const [usernameError, setUsernameError] = useState<string | null>(null);
    const [usernameSuccess, setUsernameSuccess] = useState(false);

    const [defaultPomoDurationMinutes, setDefaultPomoDurationMinutes] = useState(
        String(
            normalizePomoDurationMinutes(
                profile.default_pomo_duration_minutes,
                DEFAULT_POMO_DURATION_MINUTES
            )
        )
    );
    const [defaultEventDurationMinutes, setDefaultEventDurationMinutes] = useState(
        String(profile.default_event_duration_minutes ?? DEFAULT_EVENT_DURATION_MINUTES)
    );
    const [defaultFailureCostEuros, setDefaultFailureCostEuros] = useState(
        initialFailureCostBounds.step < 1
            ? initialFailureCostMajorClamped.toFixed(2)
            : Math.round(initialFailureCostMajorClamped).toString()
    );
    const [defaultVoucherId, setDefaultVoucherId] = useState<string | null>(
        profile.default_voucher_id ?? profile.id
    );
    const [strictPomoEnabled, setStrictPomoEnabled] = useState(
        profile.strict_pomo_enabled ?? false
    );
    const [deadlineOneHourWarningEnabled, setDeadlineOneHourWarningEnabled] = useState(
        profile.deadline_one_hour_warning_enabled ?? true
    );
    const [deadlineFinalWarningEnabled, setDeadlineFinalWarningEnabled] = useState(
        profile.deadline_final_warning_enabled ?? true
    );
    const [voucherCanViewActiveTasksEnabled, setVoucherCanViewActiveTasksEnabled] = useState(
        profile.voucher_can_view_active_tasks ?? false
    );
    const [mobileNotificationsEnabled, setMobileNotificationsEnabled] = useState(
        profile.mobile_notifications_enabled ?? false
    );
    const [isMobileNotificationsLoading, setIsMobileNotificationsLoading] = useState(false);
    const [mobileNotificationsError, setMobileNotificationsError] = useState<string | null>(null);
    const [currency, setCurrency] = useState<SupportedCurrency>(initialCurrency);
    const [isDefaultsLoading, setIsDefaultsLoading] = useState(false);
    const [defaultsError, setDefaultsError] = useState<string | null>(null);
    const [defaultsSuccess, setDefaultsSuccess] = useState(false);
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);
    const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
    const [deleteAccountSuccess, setDeleteAccountSuccess] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [voucherConflicts, setVoucherConflicts] = useState<VoucherConflictTask[]>([]);
    const [isCheckingVoucherConflicts, setIsCheckingVoucherConflicts] = useState(false);
    const [googleConnected, setGoogleConnected] = useState(googleCalendarIntegration.connected);
    const [googleSyncAppToGoogleEnabled, setGoogleSyncAppToGoogleEnabled] = useState(
        googleCalendarIntegration.syncAppToGoogleEnabled
    );
    const [googleSyncGoogleToAppEnabled, setGoogleSyncGoogleToAppEnabled] = useState(
        googleCalendarIntegration.syncGoogleToAppEnabled
    );
    const [googleImportOnlyTaggedEvents, setGoogleImportOnlyTaggedEvents] = useState(
        googleCalendarIntegration.importOnlyTaggedGoogleEvents
    );
    const [googleAccountEmail, setGoogleAccountEmail] = useState<string | null>(googleCalendarIntegration.accountEmail);
    const [googleSelectedCalendarId, setGoogleSelectedCalendarId] = useState<string>(
        googleCalendarIntegration.selectedCalendarId ?? ""
    );
    const [googleSelectedCalendarSummary, setGoogleSelectedCalendarSummary] = useState<string | null>(
        googleCalendarIntegration.selectedCalendarSummary
    );
    const [googleLastSyncAt, setGoogleLastSyncAt] = useState<string | null>(googleCalendarIntegration.lastSyncAt);
    const [googleLastError, setGoogleLastError] = useState<string | null>(googleCalendarIntegration.lastError);
    const [googleCalendars, setGoogleCalendars] = useState<Array<{ id: string; summary: string; primary?: boolean }>>([]);
    const [isGoogleCalendarsLoading, setIsGoogleCalendarsLoading] = useState(false);
    const [isGoogleActionLoading, setIsGoogleActionLoading] = useState(false);
    const [googleActionSuccess, setGoogleActionSuccess] = useState<string | null>(null);
    const hasMountedRef = useRef(false);
    const lastSavedDefaultsSnapshotRef = useRef<string | null>(null);
    const saveRequestIdRef = useRef(0);
    const hasValidDefaultVoucher =
        !!defaultVoucherId &&
        (defaultVoucherId === profile.id || friends.some((friend) => friend.id === defaultVoucherId));
    const effectiveDefaultVoucherId = hasValidDefaultVoucher ? (defaultVoucherId as string) : profile.id;
    const currencySymbol = getCurrencySymbol(currency);
    const failureCostBounds = getFailureCostBounds(currency);
    const pushApiSupported =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
    const canEnableMobileNotifications = VAPID_PUBLIC_KEY.length > 0 && pushApiSupported;
    const defaultsSnapshot = useMemo(
        () =>
            JSON.stringify({
                defaultPomoDurationMinutes,
                defaultEventDurationMinutes,
                defaultFailureCostEuros,
                effectiveDefaultVoucherId,
                strictPomoEnabled,
                deadlineOneHourWarningEnabled,
                deadlineFinalWarningEnabled,
                voucherCanViewActiveTasksEnabled,
                mobileNotificationsEnabled,
                currency,
            }),
        [
            defaultPomoDurationMinutes,
            defaultEventDurationMinutes,
            defaultFailureCostEuros,
            effectiveDefaultVoucherId,
            strictPomoEnabled,
            deadlineOneHourWarningEnabled,
            deadlineFinalWarningEnabled,
            voucherCanViewActiveTasksEnabled,
            mobileNotificationsEnabled,
            currency,
        ]
    );

    const clampFailureCostToCurrencyBounds = (rawValue: string, targetCurrency: SupportedCurrency): string => {
        const targetBounds = getFailureCostBounds(targetCurrency);
        const parsed = Number(rawValue);
        const normalized = Number.isFinite(parsed) ? parsed : targetBounds.minMajor;
        const clamped = Math.min(targetBounds.maxMajor, Math.max(targetBounds.minMajor, normalized));

        return targetBounds.step < 1
            ? clamped.toFixed(2)
            : Math.round(clamped).toString();
    };

    /*
     * This helper collects every defaults-related state field and writes them into FormData using
     * the exact keys expected by updateUserDefaults on the server.
     *
     * The auto-save effect calls this function immediately before invoking updateUserDefaults(formData),
     * so this stays as the single source of truth for request payload construction and keeps the new
     * auto-save behavior aligned with the old manual submit behavior.
     */
    const buildDefaultsFormData = () => {
        const formData = new FormData();
        formData.append("defaultPomoDurationMinutes", defaultPomoDurationMinutes);
        formData.append("defaultEventDurationMinutes", defaultEventDurationMinutes);
        formData.append("defaultFailureCost", defaultFailureCostEuros);
        formData.append("defaultVoucherId", effectiveDefaultVoucherId ?? "");
        formData.append("strictPomoEnabled", String(strictPomoEnabled));
        formData.append("deadlineOneHourWarningEnabled", String(deadlineOneHourWarningEnabled));
        formData.append("deadlineFinalWarningEnabled", String(deadlineFinalWarningEnabled));
        formData.append("voucherCanViewActiveTasksEnabled", String(voucherCanViewActiveTasksEnabled));
        formData.append("mobileNotificationsEnabled", String(mobileNotificationsEnabled));
        formData.append("currency", currency);
        return formData;
    };

    /*
     * This validation helper prevents invalid intermediate values from triggering server writes while
     * the user is actively typing.
     *
     * Validation order:
     * 1) Check default pomodoro duration is an integer within 1..120.
     * 2) Check failure cost is parseable to a finite number.
     * 3) Load per-currency bounds via getFailureCostBounds(currency) and validate rounded cents against
     *    minCents/maxCents so client logic matches authoritative server-side logic.
     *
     * Returning a non-null string means "do not save yet"; the effect will surface this as defaultsError
     * and skip calling updateUserDefaults.
     */
    const validateDefaultsState = () => {
        const parsedPomo = Number(defaultPomoDurationMinutes);
        if (
            !Number.isFinite(parsedPomo) ||
            !Number.isInteger(parsedPomo) ||
            parsedPomo < 1 ||
            parsedPomo > MAX_POMO_DURATION_MINUTES
        ) {
            return `Default Pomodoro duration must be an integer between 1 and ${MAX_POMO_DURATION_MINUTES}.`;
        }

        const parsedEventDuration = Number(defaultEventDurationMinutes);
        if (
            !Number.isFinite(parsedEventDuration) ||
            !Number.isInteger(parsedEventDuration) ||
            parsedEventDuration < 1 ||
            parsedEventDuration > 720
        ) {
            return "Default event duration must be an integer between 1 and 720.";
        }

        const parsedFailureMajor = Number(defaultFailureCostEuros);
        if (!Number.isFinite(parsedFailureMajor)) {
            return "Default failure cost is invalid.";
        }

        const bounds = getFailureCostBounds(currency);
        const parsedFailureCents = Math.round(parsedFailureMajor * 100);
        if (parsedFailureCents < bounds.minCents || parsedFailureCents > bounds.maxCents) {
            return `Default failure cost must be between ${currencySymbol}${bounds.minMajor} and ${currencySymbol}${bounds.maxMajor}.`;
        }

        return null;
    };

    async function refreshFriendsList() {
        const updatedFriends = await getFriends();
        setFriends((updatedFriends as FriendProfile[]) || []);
    }

    function updateRelationshipInFlight(key: string, action: string | null) {
        setRelationshipInFlight((prev) => ({ ...prev, [key]: action }));
    }

    async function refreshRelationshipsAndSearch() {
        setRelationshipsLoading(true);
        setRelationshipsError(null);

        const [relationshipsResult, blockedUsersResult] = await Promise.all([
            getRelationshipData(),
            getBlockedUsers(),
        ]);

        if (relationshipsResult.error) {
            setRelationshipsError(relationshipsResult.error);
        } else {
            setRelationshipFriends(relationshipsResult.friends);
            setIncomingRequests(relationshipsResult.incomingRequests);
            setOutgoingRequests(relationshipsResult.outgoingRequests);
        }

        if (blockedUsersResult.error) {
            setBlockedUsersError(blockedUsersResult.error);
        } else {
            setBlockedUsers(blockedUsersResult.users);
            setBlockedUsersError(null);
        }

        setRelationshipsLoading(false);
        setBlockedUsersLoading(false);
        await refreshFriendsList();

        const searchQuery = friendSearchQuery.trim();
        if (searchQuery) {
            const searchResult = await searchUsersForFriendship(searchQuery);
            if (searchResult.error) {
                setFriendSearchResults([]);
                setFriendSearchError(searchResult.error);
            } else {
                setFriendSearchResults(searchResult.candidates);
                setFriendSearchError(null);
            }
        }
    }

    async function handleSendFriendRequest(candidate: SearchCandidate) {
        const key = `send:${candidate.id}`;
        updateRelationshipInFlight(key, "send");
        setRelationshipSuccess(null);
        try {
            const result = await sendFriendRequestToUser(candidate.id);
            if (result.error) {
                setRelationshipsError(result.error);
                return;
            }

            setRelationshipSuccess("Friend request sent.");
            await refreshRelationshipsAndSearch();
        } finally {
            updateRelationshipInFlight(key, null);
        }
    }

    async function handleAcceptFriendRequest(request: IncomingFriendRequest) {
        const key = `request:${request.id}:accept`;
        updateRelationshipInFlight(key, "accept");
        setRelationshipSuccess(null);
        try {
            const result = await acceptIncomingFriendRequest(request.id);
            if (result.error) {
                setRelationshipsError(result.error);
                return;
            }

            setRelationshipSuccess(`Accepted @${request.sender.username}.`);
            await refreshRelationshipsAndSearch();
        } finally {
            updateRelationshipInFlight(key, null);
        }
    }

    async function handleRejectFriendRequest(request: IncomingFriendRequest) {
        const key = `request:${request.id}:reject`;
        updateRelationshipInFlight(key, "reject");
        setRelationshipSuccess(null);
        try {
            const result = await rejectIncomingFriendRequest(request.id);
            if (result.error) {
                setRelationshipsError(result.error);
                return;
            }

            setRelationshipSuccess(`Rejected @${request.sender.username}.`);
            await refreshRelationshipsAndSearch();
        } finally {
            updateRelationshipInFlight(key, null);
        }
    }

    async function handleWithdrawFriendRequest(request: OutgoingFriendRequest) {
        const key = `outgoing:${request.id}:withdraw`;
        updateRelationshipInFlight(key, "withdraw");
        setRelationshipSuccess(null);
        try {
            const result = await withdrawOutgoingFriendRequest(request.id);
            if (result.error) {
                setRelationshipsError(result.error);
                return;
            }

            setRelationshipSuccess(`Request to @${request.receiver.username} withdrawn.`);
            await refreshRelationshipsAndSearch();
        } finally {
            updateRelationshipInFlight(key, null);
        }
    }

    async function handleRemoveFriend(friend: IncomingFriendRequest["sender"]) {
        const key = `friend:${friend.id}:remove`;
        updateRelationshipInFlight(key, "remove");
        setRelationshipSuccess(null);
        try {
            const result = await removeFriendById(friend.id);
            if (result.error) {
                setRelationshipsError(result.error);
                return;
            }

            if (defaultVoucherId === friend.id) {
                setDefaultVoucherId(profile.id);
            }

            setRelationshipSuccess(`Removed @${friend.username}.`);
            await refreshRelationshipsAndSearch();
        } finally {
            updateRelationshipInFlight(key, null);
        }
    }

    async function handleBlockRelationshipUser(
        target: SearchCandidate | IncomingFriendRequest["sender"] | OutgoingFriendRequest["receiver"] | FriendProfile,
        sourceKey: string
    ) {
        updateRelationshipInFlight(sourceKey, "block");
        setRelationshipSuccess(null);
        try {
            const result = await blockRelationshipUser(target.id);
            if (result.error) {
                setRelationshipsError(result.error);
                return;
            }

            if (defaultVoucherId === target.id) {
                setDefaultVoucherId(profile.id);
            }

            setRelationshipSuccess(`Blocked @${target.username}.`);
            await refreshRelationshipsAndSearch();
        } finally {
            updateRelationshipInFlight(sourceKey, null);
        }
    }

    async function handleUnblockUser(userId: string, username: string) {
        setUnblockingUserId(userId);
        setBlockedUsersError(null);
        setRelationshipSuccess(null);
        try {
            const result = await unblockRelationshipUser(userId);
            if (result.error) {
                setBlockedUsersError(result.error);
                return;
            }

            setRelationshipSuccess(`Unblocked @${username}.`);
            await refreshRelationshipsAndSearch();
        } finally {
            setUnblockingUserId(null);
        }
    }

    async function handleOrcaFriendToggle(nextEnabled: boolean) {
        if (isOrcaFriendLoading) return;

        const previousEnabled = orcaFriendEnabled;
        setOrcaFriendEnabled(nextEnabled);
        setIsOrcaFriendLoading(true);
        setOrcaFriendError(null);
        setOrcaFriendSuccess(null);

        try {
            const result = await setOrcaAsFriendEnabled(nextEnabled);

            if (result.error) {
                setOrcaFriendEnabled(previousEnabled);
                setOrcaFriendError(result.error);
                return;
            }

            const resolvedEnabled = result.enabled ?? nextEnabled;
            setOrcaFriendEnabled(resolvedEnabled);
            if (!resolvedEnabled && defaultVoucherId === ORCA_PROFILE_ID) {
                setDefaultVoucherId(profile.id);
            }
            setOrcaFriendSuccess(
                resolvedEnabled
                    ? `${AI_VOUCHER_DISPLAY_NAME} added as a friend.`
                    : `${AI_VOUCHER_DISPLAY_NAME} removed from your friends.`
            );
            await refreshRelationshipsAndSearch();
        } catch (error) {
            console.error(error);
            setOrcaFriendEnabled(previousEnabled);
            setOrcaFriendError("Failed to update Orca friend setting.");
        } finally {
            setIsOrcaFriendLoading(false);
        }
    }

    async function handleUsernameSubmit(e: React.FormEvent) {
        e.preventDefault();
        setIsUsernameLoading(true);
        setUsernameError(null);
        setUsernameSuccess(false);

        const formData = new FormData();
        formData.append("username", username);

        const result = await updateUsername(formData);

        if (result.error) {
            setUsernameError(result.error);
        } else {
            setUsernameSuccess(true);
        }

        setIsUsernameLoading(false);
    }

    function handleCurrencyChange(value: string) {
        const nextCurrency = normalizeCurrency(value);
        setCurrency(nextCurrency);
        setDefaultFailureCostEuros((prev) =>
            clampFailureCostToCurrencyBounds(prev, nextCurrency)
        );
    }

    async function handleMobileNotificationsToggle(nextEnabled: boolean) {
        if (isMobileNotificationsLoading) return;

        setIsMobileNotificationsLoading(true);
        setMobileNotificationsError(null);

        try {
            if (!nextEnabled) {
                if (pushApiSupported) {
                    const registration = await navigator.serviceWorker.ready;
                    const existingSubscription = await registration.pushManager.getSubscription();
                    if (existingSubscription) {
                        const serialized = JSON.parse(JSON.stringify(existingSubscription));
                        await deleteSubscription(serialized);
                        await existingSubscription.unsubscribe();
                    }
                }
                setMobileNotificationsEnabled(false);
                return;
            }

            if (!VAPID_PUBLIC_KEY) {
                setMobileNotificationsError("Push is not configured. Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY.");
                return;
            }

            if (!pushApiSupported) {
                setMobileNotificationsError("This browser does not support Web Push in the current mode.");
                return;
            }

            const permission = await Notification.requestPermission();
            if (permission !== "granted") {
                setMobileNotificationsError(
                    permission === "denied"
                        ? "Notification permission denied. Enable notifications in browser settings."
                        : "Notification permission request was dismissed."
                );
                return;
            }

            const registration = await navigator.serviceWorker.ready;
            let subscription = await registration.pushManager.getSubscription();
            if (!subscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
                });
            }

            const serialized = JSON.parse(JSON.stringify(subscription));
            const result = await saveSubscription(serialized);
            if (!result.success) {
                setMobileNotificationsError(result.error ?? "Could not save push subscription.");
                return;
            }

            setMobileNotificationsEnabled(true);
        } catch (error) {
            console.error(error);
            setMobileNotificationsError("Could not update mobile notification setting.");
        } finally {
            setIsMobileNotificationsLoading(false);
        }
    }

    /*
     * This effect implements debounced auto-save for the Defaults card.
     *
     * Sequence of operations:
     * 1) Skip the very first render with hasMountedRef so initial server-loaded values do not immediately
     *    trigger a write-back.
     * 2) Run validateDefaultsState(); if invalid, show defaultsError and stop without network calls.
     * 3) Increment saveRequestIdRef to mark the newest intended save request.
     * 4) Wait for the debounce window, then call updateUserDefaults(buildDefaultsFormData()).
     * 5) When the request resolves, only apply the response if the request id still matches the newest
     *    id; this discards stale out-of-order responses from earlier edits.
     * 6) On success, briefly show defaultsSuccess and auto-hide it after 1.5s if no newer request exists.
     */
    useEffect(() => {
        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            lastSavedDefaultsSnapshotRef.current = defaultsSnapshot;
            return;
        }

        if (lastSavedDefaultsSnapshotRef.current === defaultsSnapshot) {
            return;
        }

        const requestId = saveRequestIdRef.current + 1;
        saveRequestIdRef.current = requestId;

        const validationError = validateDefaultsState();
        if (validationError) {
            setDefaultsError(validationError);
            setDefaultsSuccess(false);
            setIsDefaultsLoading(false);
            return;
        }

        setDefaultsError(null);
        setDefaultsSuccess(false);
        setIsDefaultsLoading(true);

        const debounceTimer = window.setTimeout(async () => {
            const result = await updateUserDefaults(buildDefaultsFormData());

            if (requestId !== saveRequestIdRef.current) {
                return;
            }

            if (result.error) {
                setDefaultsError(result.error);
                setDefaultsSuccess(false);
            } else {
                lastSavedDefaultsSnapshotRef.current = defaultsSnapshot;
                setDefaultsError(null);
                setDefaultsSuccess(true);
                window.setTimeout(() => {
                    if (requestId === saveRequestIdRef.current) {
                        setDefaultsSuccess(false);
                    }
                }, 1500);
            }

            setIsDefaultsLoading(false);
        }, 600);

        return () => {
            window.clearTimeout(debounceTimer);
        };
    }, [
        defaultsSnapshot,
    ]);

    useEffect(() => {
        setBlockedUsersLoading(true);
        void refreshRelationshipsAndSearch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const search = friendSearchQuery.trim();
        if (!search) {
            setFriendSearchLoading(false);
            setFriendSearchError(null);
            setFriendSearchResults([]);
            return;
        }

        setFriendSearchLoading(true);
        setFriendSearchError(null);
        const timer = window.setTimeout(async () => {
            const result = await searchUsersForFriendship(search);
            if (result.error) {
                setFriendSearchResults([]);
                setFriendSearchError(result.error);
            } else {
                setFriendSearchResults(result.candidates);
                setFriendSearchError(null);
            }
            setFriendSearchLoading(false);
        }, 250);

        return () => {
            window.clearTimeout(timer);
        };
    }, [friendSearchQuery]);

    useEffect(() => {
        if (!googleConnected) return;
        setIsGoogleCalendarsLoading(true);
        listGoogleCalendarsForSettings()
            .then((result) => {
                if (result.error) {
                    setGoogleCalendars([]);
                    setGoogleLastError(result.error);
                    return;
                }
                setGoogleCalendars(result.calendars || []);
                setGoogleLastError(null);
            })
            .catch((error) => {
                console.error(error);
                setGoogleLastError("Could not load Google calendars.");
            })
            .finally(() => {
                setIsGoogleCalendarsLoading(false);
            });
    }, [googleConnected]);

    async function handleGoogleConnect() {
        if (isGoogleActionLoading) return;
        setIsGoogleActionLoading(true);
        setGoogleActionSuccess(null);
        setGoogleLastError(null);

        try {
            const result = await startGoogleCalendarConnect();
            if ("error" in result && result.error) {
                setGoogleLastError(result.error);
                setIsGoogleActionLoading(false);
                return;
            }

            if (!result.url) {
                setGoogleLastError("Google OAuth URL could not be generated.");
                setIsGoogleActionLoading(false);
                return;
            }

            window.location.href = result.url;
        } catch (error) {
            console.error(error);
            setGoogleLastError("Failed to start Google connection.");
            setIsGoogleActionLoading(false);
        }
    }

    async function handleGoogleDisconnect() {
        if (isGoogleActionLoading) return;
        const confirmed = window.confirm(
            "Disconnect & Forget will revoke Google access and remove all Google sync data from this app. Existing tasks will remain. Continue?"
        );
        if (!confirmed) return;

        setIsGoogleActionLoading(true);
        setGoogleActionSuccess(null);
        setGoogleLastError(null);

        try {
            const result = await disconnectGoogleCalendar();
            if (result.error) {
                setGoogleLastError(result.error);
                return;
            }

            setGoogleConnected(false);
            setGoogleSyncAppToGoogleEnabled(false);
            setGoogleSyncGoogleToAppEnabled(false);
            setGoogleImportOnlyTaggedEvents(false);
            setGoogleAccountEmail(null);
            setGoogleSelectedCalendarId("");
            setGoogleSelectedCalendarSummary(null);
            setGoogleCalendars([]);
            setGoogleLastSyncAt(null);
            setGoogleLastError(null);
            setGoogleActionSuccess("Google Calendar disconnected and forgotten.");
        } catch (error) {
            console.error(error);
            setGoogleLastError("Failed to disconnect and forget Google Calendar.");
        } finally {
            setIsGoogleActionLoading(false);
        }
    }

    async function handleGoogleRefreshCalendars() {
        if (isGoogleActionLoading) return;
        setIsGoogleActionLoading(true);
        setGoogleActionSuccess(null);
        setGoogleLastError(null);

        try {
            const result = await listGoogleCalendarsForSettings();
            if (result.error) {
                setGoogleLastError(result.error);
                return;
            }
            setGoogleCalendars(result.calendars || []);
            setGoogleActionSuccess("Calendars refreshed.");
        } catch (error) {
            console.error(error);
            setGoogleLastError("Could not refresh Google calendars.");
        } finally {
            setIsGoogleActionLoading(false);
        }
    }

    async function handleGoogleCalendarSelection(nextCalendarId: string) {
        if (isGoogleActionLoading) return;
        setIsGoogleActionLoading(true);
        setGoogleActionSuccess(null);
        setGoogleLastError(null);

        try {
            const result = await setGoogleCalendarCalendar(nextCalendarId);
            if (result.error) {
                setGoogleLastError(result.error);
                return;
            }

            const selected = googleCalendars.find((calendar) => calendar.id === nextCalendarId);
            setGoogleSelectedCalendarId(nextCalendarId);
            setGoogleSelectedCalendarSummary(selected?.summary || null);
            setGoogleActionSuccess("Google calendar selected.");
        } catch (error) {
            console.error(error);
            setGoogleLastError("Could not set Google calendar.");
        } finally {
            setIsGoogleActionLoading(false);
        }
    }

    async function handleGoogleAppToGoogleToggle(enabled: boolean) {
        if (isGoogleActionLoading) return;
        setIsGoogleActionLoading(true);
        setGoogleActionSuccess(null);
        setGoogleLastError(null);

        try {
            const result = await setGoogleCalendarAppToGoogleEnabled(enabled);
            if (result.error) {
                setGoogleLastError(result.error);
                return;
            }

            setGoogleSyncAppToGoogleEnabled(enabled);
            setGoogleActionSuccess(
                enabled ? "Vouch to Google Calendar sync enabled." : "Vouch to Google Calendar sync disabled."
            );
        } catch (error) {
            console.error(error);
            setGoogleLastError("Could not update Vouch to Google sync setting.");
        } finally {
            setIsGoogleActionLoading(false);
        }
    }

    async function handleGoogleGoogleToAppToggle(enabled: boolean) {
        if (isGoogleActionLoading) return;
        setIsGoogleActionLoading(true);
        setGoogleActionSuccess(null);
        setGoogleLastError(null);

        try {
            const result = await setGoogleCalendarGoogleToAppEnabled(enabled);
            if (result.error) {
                setGoogleLastError(result.error);
                return;
            }

            setGoogleSyncGoogleToAppEnabled(enabled);
            if (enabled) {
                setGoogleLastSyncAt(new Date().toISOString());
            }
            setGoogleActionSuccess(
                enabled ? "Google Calendar to Vouch sync enabled." : "Google Calendar to Vouch sync disabled."
            );
        } catch (error) {
            console.error(error);
            setGoogleLastError("Could not update Google to Vouch sync setting.");
        } finally {
            setIsGoogleActionLoading(false);
        }
    }

    async function handleGoogleImportFilterToggle(enabled: boolean) {
        if (isGoogleActionLoading) return;
        setIsGoogleActionLoading(true);
        setGoogleActionSuccess(null);
        setGoogleLastError(null);

        try {
            const result = await setGoogleCalendarImportTaggedOnly(enabled);
            if (result.error) {
                setGoogleLastError(result.error);
                return;
            }

            setGoogleImportOnlyTaggedEvents(enabled);
            setGoogleActionSuccess(
                enabled
                    ? "Google import filter enabled: only events with -event in title or description will import."
                    : "Google import filter disabled: all calendar events can import."
            );
        } catch (error) {
            console.error(error);
            setGoogleLastError("Could not update Google import filter.");
        } finally {
            setIsGoogleActionLoading(false);
        }
    }

    async function handleExportData() {
        if (isExporting) return;
        setIsExporting(true);
        setExportError(null);
        try {
            const result = await exportUserData();
            if ("error" in result) {
                setExportError(result.error);
                return;
            }
            const json = JSON.stringify(result.data, null, 2);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `vouch-data-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            setExportError("Export failed. Please try again.");
        } finally {
            setIsExporting(false);
        }
    }

    async function performAccountDeletion() {
        if (isDeletingAccount || deleteAccountSuccess) return;

        setIsDeletingAccount(true);
        setDeleteAccountError(null);

        try {
            const result = await deleteAccount();
            if ("error" in result) {
                setDeleteAccountError(result.error);
                setIsDeletingAccount(false);
                return;
            }

            setDeleteAccountSuccess(true);
            setIsDeletingAccount(false);
            window.setTimeout(() => {
                window.location.href = "https://tas.tarunh.com";
            }, 3000);
        } catch (error) {
            console.error(error);
            setDeleteAccountError("Failed to delete account.");
            setIsDeletingAccount(false);
        }
    }

    async function handleDeleteAccount() {
        if (isDeletingAccount || deleteAccountSuccess || isCheckingVoucherConflicts) return;

        setIsCheckingVoucherConflicts(true);
        setDeleteAccountError(null);

        try {
            const result = await getActiveVoucherTasks();
            if ("error" in result) {
                setDeleteAccountError(result.error);
                return;
            }

            setVoucherConflicts(result.tasks);
            setShowDeleteModal(true);
        } catch (error) {
            console.error(error);
            setDeleteAccountError("Failed to check active voucher tasks.");
        } finally {
            setIsCheckingVoucherConflicts(false);
        }
    }

    async function handleDeleteAccountConfirm() {
        if (isDeletingAccount || deleteAccountSuccess) return;
        setShowDeleteModal(false);
        await performAccountDeletion();
    }

    return (
        <div className="max-w-3xl mx-auto space-y-8 pb-20 px-4 md:px-0">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-bold text-white">Settings</h1>
                    <p className="text-slate-400 mt-1">Manage your profile and defaults</p>
                    <p className="text-xs text-slate-500 font-mono mt-2">
                        Signed in as <span className="text-slate-300">{profile.email}</span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <HardRefreshButton />
                    <SignOutMenuForm variant="nav" />
                </div>
            </div>
            <section className="space-y-6 border-b border-slate-900 pb-8">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-white">Friends</h2>
                    <p className="text-sm text-slate-400">
                        Search people, manage friend requests, and block users.
                    </p>
                </div>
                <div className="space-y-3">
                    <Label htmlFor="friendSearch" className="text-slate-200">
                        Search by email or username
                    </Label>
                    <Input
                        id="friendSearch"
                        type="text"
                        placeholder="Find people..."
                        value={friendSearchQuery}
                        onChange={(e) => setFriendSearchQuery(e.target.value)}
                        className="bg-slate-800/40 border-slate-700 text-white"
                    />
                </div>

                {relationshipsError && <p className="text-sm text-red-400">{relationshipsError}</p>}
                {blockedUsersError && <p className="text-sm text-red-400">{blockedUsersError}</p>}
                {relationshipSuccess && <p className="text-sm text-green-400">{relationshipSuccess}</p>}
                {relationshipsLoading && <p className="text-sm text-slate-400">Loading relationships...</p>}

                {friendSearchQuery.trim().length > 0 ? (
                    <div className="space-y-2">
                        {friendSearchLoading ? (
                            <p className="text-sm text-slate-400">Searching...</p>
                        ) : friendSearchError ? (
                            <p className="text-sm text-red-400">{friendSearchError}</p>
                        ) : friendSearchResults.length === 0 ? (
                            <p className="text-sm text-slate-500">No matching users found.</p>
                        ) : (
                            friendSearchResults.map((candidate) => {
                                const sendKey = `send:${candidate.id}`;
                                const blockKey = `search:${candidate.id}:block`;
                                const isSending = relationshipInFlight[sendKey] === "send";
                                const isBlocking = relationshipInFlight[blockKey] === "block";

                                return (
                                    <div
                                        key={candidate.id}
                                        className="flex items-center justify-between gap-3 border-b border-slate-900 py-3 last:border-b-0"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <Avatar className="h-10 w-10 border border-slate-700 bg-slate-900">
                                                <AvatarFallback className="bg-slate-900 text-slate-300 text-[11px] font-mono">
                                                    {candidate.username?.slice(0, 2).toUpperCase() || "??"}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-white truncate">{candidate.username}</p>
                                                <p className="text-xs text-slate-400 truncate">{candidate.email}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {candidate.incoming_request_pending ? (
                                                <span className="text-xs text-amber-300">Requested you</span>
                                            ) : candidate.outgoing_request_pending ? (
                                                <span className="text-xs text-slate-400">Requested</span>
                                            ) : (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    onClick={() => void handleSendFriendRequest(candidate)}
                                                    disabled={isSending || isBlocking}
                                                    className="bg-slate-100 text-slate-950 hover:bg-white font-semibold"
                                                >
                                                    {isSending ? "Sending..." : "Add Friend"}
                                                </Button>
                                            )}
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => void handleBlockRelationshipUser(candidate, blockKey)}
                                                disabled={isSending || isBlocking}
                                                className="text-red-300 hover:text-red-200 hover:bg-red-500/10"
                                            >
                                                {isBlocking ? "Blocking..." : "Block"}
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {incomingRequests.length === 0 && outgoingRequests.length === 0 && relationshipFriends.length === 0 ? (
                            <p className="text-sm text-slate-500">No friends yet.</p>
                        ) : null}

                        {incomingRequests.map((request) => {
                            const acceptKey = `request:${request.id}:accept`;
                            const rejectKey = `request:${request.id}:reject`;
                            const blockKey = `request:${request.id}:block`;
                            const busy = Boolean(
                                relationshipInFlight[acceptKey] ||
                                relationshipInFlight[rejectKey] ||
                                relationshipInFlight[blockKey]
                            );
                            return (
                                <div
                                    key={request.id}
                                    className="flex items-center justify-between gap-3 border-b border-slate-900 py-3 last:border-b-0"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Avatar className="h-10 w-10 border border-slate-700 bg-slate-900">
                                            <AvatarFallback className="bg-slate-900 text-slate-300 text-[11px] font-mono">
                                                {request.sender.initial}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-white truncate">{request.sender.username}</p>
                                            <p className="text-xs text-slate-400 truncate">{request.sender.email}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => void handleAcceptFriendRequest(request)}
                                            disabled={busy}
                                            className="bg-emerald-700 text-white hover:bg-emerald-600"
                                        >
                                            {relationshipInFlight[acceptKey] === "accept" ? "Accepting..." : "Accept"}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => void handleRejectFriendRequest(request)}
                                            disabled={busy}
                                            className="text-amber-300 hover:text-amber-200 hover:bg-amber-500/10"
                                        >
                                            {relationshipInFlight[rejectKey] === "reject" ? "Rejecting..." : "Reject"}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => void handleBlockRelationshipUser(request.sender, blockKey)}
                                            disabled={busy}
                                            className="text-red-300 hover:text-red-200 hover:bg-red-500/10"
                                        >
                                            {relationshipInFlight[blockKey] === "block" ? "Blocking..." : "Block"}
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}

                        {outgoingRequests.map((request) => {
                            const withdrawKey = `outgoing:${request.id}:withdraw`;
                            const blockKey = `sent-request:${request.id}:block`;
                            const isWithdrawing = relationshipInFlight[withdrawKey] === "withdraw";
                            const isBlocking = relationshipInFlight[blockKey] === "block";
                            return (
                                <div
                                    key={request.id}
                                    className="flex items-center justify-between gap-3 border-b border-slate-900 py-3 last:border-b-0"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Avatar className="h-10 w-10 border border-slate-700 bg-slate-900">
                                            <AvatarFallback className="bg-slate-900 text-slate-300 text-[11px] font-mono">
                                                {request.receiver.initial}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-white truncate">{request.receiver.username}</p>
                                            <p className="text-xs text-slate-400 truncate">{request.receiver.email}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => void handleWithdrawFriendRequest(request)}
                                            disabled={isWithdrawing || isBlocking}
                                            className="text-amber-300 hover:text-amber-200 hover:bg-amber-500/10"
                                        >
                                            {isWithdrawing ? "Withdrawing..." : "Withdraw"}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => void handleBlockRelationshipUser(request.receiver, blockKey)}
                                            disabled={isWithdrawing || isBlocking}
                                            className="text-red-300 hover:text-red-200 hover:bg-red-500/10"
                                        >
                                            {isBlocking ? "Blocking..." : "Block"}
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}

                        {relationshipFriends.map((friend) => {
                            const removeKey = `friend:${friend.id}:remove`;
                            const blockKey = `friend:${friend.id}:block`;
                            const isRemoving = relationshipInFlight[removeKey] === "remove";
                            const isBlocking = relationshipInFlight[blockKey] === "block";

                            return (
                                <div
                                    key={friend.id}
                                    className="flex items-center justify-between gap-3 border-b border-slate-900 py-3 last:border-b-0"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Avatar className="relative h-10 w-10 border border-slate-700 bg-slate-900 overflow-visible">
                                            <AvatarFallback className="bg-slate-900 text-slate-300 text-[11px] font-mono">
                                                {friend.username?.slice(0, 2).toUpperCase() || "??"}
                                            </AvatarFallback>
                                            <span
                                                className="absolute -top-1 -right-1 rounded-full min-w-[34px] h-5 px-1.5 flex items-center justify-center text-[9px] font-mono font-semibold text-white leading-none border border-orange-300/50"
                                                style={{
                                                    background: "linear-gradient(90deg, rgb(234,88,12) 0%, rgb(251,146,60) 100%)",
                                                    boxShadow: "0 0 8px 1px rgba(251,146,60,0.5)",
                                                    textShadow: "0 0 4px rgba(0,0,0,0.45)",
                                                }}
                                                aria-label={`${friend.username ?? "Friend"} RP score ${friend.rp_score ?? 400}`}
                                            >
                                                {friend.rp_score ?? 400}
                                            </span>
                                        </Avatar>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-white truncate">{friend.username}</p>
                                            <p className="text-xs text-slate-400 truncate">{friend.email}</p>
                                        </div>
                                    </div>
                                    {friend.id === ORCA_PROFILE_ID ? (
                                        <span className="text-xs text-slate-500">Managed in AI Features</span>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => void handleRemoveFriend(friend)}
                                                disabled={isRemoving || isBlocking}
                                                className="text-amber-300 hover:text-amber-200 hover:bg-amber-500/10"
                                            >
                                                {isRemoving ? "Removing..." : "Remove"}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => void handleBlockRelationshipUser(friend, blockKey)}
                                                disabled={isRemoving || isBlocking}
                                                className="text-red-300 hover:text-red-200 hover:bg-red-500/10"
                                            >
                                                {isBlocking ? "Blocking..." : "Block"}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                <p className="text-xs text-slate-500">
                    Remove or block is disabled by backend rules while one of you is still voucher for the other on pending tasks.
                </p>
            </section>

            <section className="space-y-4 border-b border-slate-900 pb-8">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-white">Blocked Users</h2>
                    <p className="text-sm text-slate-400">
                        Unblock people you previously blocked so they can send friend requests again.
                    </p>
                </div>
                {blockedUsersLoading ? (
                    <p className="text-sm text-slate-400">Loading blocked users...</p>
                ) : blockedUsers.length === 0 ? (
                    <p className="text-sm text-slate-500">No blocked users.</p>
                ) : (
                    <div>
                        {blockedUsers.map((blockedUser) => (
                            <div
                                key={blockedUser.id}
                                className="flex items-center justify-between gap-3 border-b border-slate-900 py-3 last:border-b-0"
                            >
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-white truncate">{blockedUser.username}</p>
                                    <p className="text-xs text-slate-400 truncate">{blockedUser.email}</p>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void handleUnblockUser(blockedUser.id, blockedUser.username)}
                                    disabled={unblockingUserId === blockedUser.id}
                                    className="text-cyan-300 hover:text-cyan-200 hover:bg-cyan-500/10"
                                >
                                    {unblockingUserId === blockedUser.id ? "Unblocking..." : "Unblock"}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section className="space-y-4 border-b border-slate-900 pb-8">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-white">Profile</h2>
                    <p className="text-sm text-slate-400">Update your username</p>
                </div>

                <form onSubmit={handleUsernameSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="username" className="text-slate-200">
                            Username
                        </Label>
                        <Input
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            minLength={3}
                            required
                            className="bg-slate-800/40 border-slate-700 text-white"
                        />
                        <p className="text-xs text-slate-500">
                            Your friends can find you by this username
                        </p>
                    </div>

                    {usernameError && <p className="text-sm text-red-400">{usernameError}</p>}
                    {usernameSuccess && (
                        <p className="text-sm text-green-400">Username updated!</p>
                    )}

                    <Button
                        type="submit"
                        disabled={isUsernameLoading || username === profile.username}
                        className="bg-slate-100 text-slate-950 hover:bg-white font-semibold"
                    >
                        {isUsernameLoading ? "Saving..." : "Save Changes"}
                    </Button>
                </form>
            </section>

            <section className="space-y-4 border-b border-slate-900 pb-8">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-white">Defaults</h2>
                </div>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="defaultPomoDurationMinutes" className="text-slate-200">
                            Default Pomodoro Duration (minutes)
                        </Label>
                        <Input
                            id="defaultPomoDurationMinutes"
                            type="number"
                            min="1"
                            max={String(MAX_POMO_DURATION_MINUTES)}
                            step="1"
                            value={defaultPomoDurationMinutes}
                            onChange={(e) => setDefaultPomoDurationMinutes(e.target.value)}
                            className="bg-slate-800/40 border-slate-700 text-white"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="defaultFailureCost" className="text-slate-200">
                            Default Failure Cost ({currencySymbol})
                        </Label>
                        <Input
                            id="defaultFailureCost"
                            type="number"
                            min={failureCostBounds.minMajor}
                            max={failureCostBounds.maxMajor}
                            step={failureCostBounds.step}
                            value={defaultFailureCostEuros}
                            onChange={(e) => setDefaultFailureCostEuros(e.target.value)}
                            className="bg-slate-800/40 border-slate-700 text-white"
                        />
                        <p className="text-xs text-slate-500">
                            {currencySymbol}{failureCostBounds.minMajor} - {currencySymbol}{failureCostBounds.maxMajor}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="defaultEventDurationMinutes" className="text-slate-200">
                            Default Event Duration (minutes)
                        </Label>
                        <Input
                            id="defaultEventDurationMinutes"
                            type="number"
                            min="1"
                            max="720"
                            step="1"
                            value={defaultEventDurationMinutes}
                            onChange={(e) => setDefaultEventDurationMinutes(e.target.value)}
                            className="bg-slate-800/40 border-slate-700 text-white"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="defaultVoucherId" className="text-slate-200">
                            Default Voucher
                        </Label>
                        <Select
                            value={effectiveDefaultVoucherId}
                            onValueChange={setDefaultVoucherId}
                        >
                            <SelectTrigger
                                id="defaultVoucherId"
                                className="bg-slate-800/40 border-slate-700 text-white w-full"
                            >
                                <SelectValue placeholder="Select default voucher" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-900 border-slate-800 text-white">
                                <SelectItem value={profile.id}>Myself</SelectItem>
                                {friends.map((friend) => (
                                    <SelectItem key={friend.id} value={friend.id}>
                                        {friend.username} ({friend.email})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="currency" className="text-slate-200">
                            Currency
                        </Label>
                        <Select value={currency} onValueChange={handleCurrencyChange}>
                            <SelectTrigger
                                id="currency"
                                className="bg-slate-800/40 border-slate-700 text-white w-full"
                            >
                                <SelectValue placeholder="Select currency" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-900 border-slate-800 text-white">
                                {SUPPORTED_CURRENCIES.map((currencyCode) => (
                                    <SelectItem key={currencyCode} value={currencyCode}>
                                        {currencyCode}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div aria-live="polite" className="min-h-5">
                        {isDefaultsLoading ? (
                            <p className="text-sm text-slate-300 leading-5">Saving...</p>
                        ) : null}
                    </div>

                    <div className="border-b border-slate-900 py-3">
                        <div className="flex items-start gap-4">
                            <div className="flex-1 min-w-0 space-y-1">
                                <Label htmlFor="strictPomoEnabled" className="text-slate-200">
                                    Strict Pomodoro
                                </Label>
                                <p className="text-xs text-slate-400">
                                    When enabled, newly started pomodoros cannot be paused and only timer-completed sessions count.
                                </p>
                            </div>
                            <GlassToggle
                                id="strictPomoEnabled"
                                checked={strictPomoEnabled}
                                onChange={setStrictPomoEnabled}
                            />
                        </div>
                    </div>

                    <div className="border-b border-slate-900 py-3">
                        <div className="flex items-start gap-4">
                            <div className="flex-1 min-w-0 space-y-1">
                                <Label htmlFor="deadlineOneHourWarningEnabled" className="text-slate-200">
                                    Deadline warning (1 hour before deadline)
                                </Label>
                                <p className="text-xs text-slate-400">
                                    Auto-adds a 1-hour reminder to each task. You can remove it per task in task details.
                                </p>
                            </div>
                            <GlassToggle
                                id="deadlineOneHourWarningEnabled"
                                checked={deadlineOneHourWarningEnabled}
                                onChange={setDeadlineOneHourWarningEnabled}
                            />
                        </div>
                    </div>

                    <div className="border-b border-slate-900 py-3">
                        <div className="flex items-start gap-4">
                            <div className="flex-1 min-w-0 space-y-1">
                                <Label htmlFor="deadlineFinalWarningEnabled" className="flex items-center gap-2 cursor-pointer font-medium text-slate-200">
                                    Final deadline warning (10 minutes before deadline)
                                </Label>
                                <p className="text-xs text-slate-400">
                                    Auto-adds a 10-minute reminder to each task. You can remove it per task in task details.
                                </p>
                            </div>
                            <GlassToggle
                                id="deadlineFinalWarningEnabled"
                                checked={deadlineFinalWarningEnabled}
                                onChange={setDeadlineFinalWarningEnabled}
                            />
                        </div>
                    </div>

                    <div className="border-b border-slate-900 py-3">
                        <div className="flex items-start gap-4">
                            <div className="flex-1 min-w-0 space-y-1">
                                <Label htmlFor="voucherCanViewActiveTasksEnabled" className="text-slate-200">
                                    Allow vouchers to view my active tasks
                                </Label>
                                <p className="text-xs text-slate-400">
                                    Controls whether selected vouchers can see your tasks in ACTIVE or POSTPONED status.
                                </p>
                            </div>
                            <GlassToggle
                                id="voucherCanViewActiveTasksEnabled"
                                checked={voucherCanViewActiveTasksEnabled}
                                onChange={setVoucherCanViewActiveTasksEnabled}
                            />
                        </div>
                    </div>

                    <div className="border-b border-slate-900 py-3">
                        <div className="flex items-start gap-4">
                            <div className="flex-1 min-w-0 space-y-1">
                                <Label htmlFor="mobileNotificationsEnabled" className="text-slate-200">
                                    Enable mobile notifications
                                </Label>
                                <p className="text-xs text-slate-400">
                                    Get push updates for deadlines, voucher actions, and important account events.
                                </p>
                                {!VAPID_PUBLIC_KEY && (
                                    <p className="text-xs text-amber-300">
                                        Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY, so push cannot be enabled yet.
                                    </p>
                                )}
                                {VAPID_PUBLIC_KEY && !pushApiSupported && (
                                    <p className="text-xs text-slate-500">
                                        This browser does not currently support Web Push.
                                    </p>
                                )}
                                {mobileNotificationsError && (
                                    <p className="text-xs text-red-400">{mobileNotificationsError}</p>
                                )}
                            </div>
                            <GlassToggle
                                id="mobileNotificationsEnabled"
                                checked={mobileNotificationsEnabled}
                                disabled={
                                    isMobileNotificationsLoading ||
                                    (!mobileNotificationsEnabled && !canEnableMobileNotifications)
                                }
                                onChange={handleMobileNotificationsToggle}
                            />
                        </div>
                    </div>

                    <div aria-live="polite" className="min-h-5">
                        {defaultsError ? (
                            <p className="text-sm text-red-400 leading-5">{defaultsError}</p>
                        ) : defaultsSuccess ? (
                            <p className="text-sm text-green-400 leading-5">Defaults updated!</p>
                        ) : null}
                    </div>
                </div>
            </section>

            <section className="space-y-4 border-b border-slate-900 pb-8">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-white">AI Features</h2>
                    <p className="text-sm text-slate-400">
                        Opt in to AI-powered helpers.
                    </p>
                </div>
                <div className="border-b border-slate-900 py-3">
                    <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0 space-y-1">
                            <Label htmlFor="orcaFriendEnabled" className="text-slate-200">
                                Add Orca as a friend
                            </Label>
                            <p className="text-xs text-slate-400">
                                When enabled, {AI_VOUCHER_DISPLAY_NAME} is added to your friends list and appears in voucher pickers.
                            </p>
                        </div>
                        <GlassToggle
                            id="orcaFriendEnabled"
                            checked={orcaFriendEnabled}
                            disabled={isOrcaFriendLoading}
                            onChange={handleOrcaFriendToggle}
                        />
                    </div>
                </div>
                {orcaFriendError && <p className="text-sm text-red-400">{orcaFriendError}</p>}
                {orcaFriendSuccess && <p className="text-sm text-green-400">{orcaFriendSuccess}</p>}
            </section>

            <section className="space-y-4 border-b border-slate-900 pb-8">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-white">Google Calendar</h2>
                    <p className="text-sm text-slate-400">
                        Configure Vouch to Google and Google to Vouch sync independently. Use -event when creating a task to sync it with Google Calendar.
                    </p>
                </div>

                <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                        {!googleConnected ? (
                            <Button
                                type="button"
                                onClick={handleGoogleConnect}
                                disabled={isGoogleActionLoading}
                                className="bg-slate-100 text-slate-950 hover:bg-white font-semibold"
                            >
                                {isGoogleActionLoading ? "Connecting..." : "Connect Google"}
                            </Button>
                        ) : (
                            <>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={handleGoogleRefreshCalendars}
                                    disabled={isGoogleActionLoading}
                                    className="border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                                >
                                    {isGoogleActionLoading ? "Working..." : "Refresh Calendars"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={handleGoogleDisconnect}
                                    disabled={isGoogleActionLoading}
                                    className="text-red-300 hover:text-red-200 hover:bg-red-500/10"
                                >
                                    Disconnect & Forget
                                </Button>
                            </>
                        )}
                    </div>

                    {googleAccountEmail && (
                        <p className="text-xs text-slate-400">
                            Connected as <span className="text-slate-200">{googleAccountEmail}</span>
                        </p>
                    )}

                    {googleConnected && (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor="googleCalendarSelect" className="text-slate-200">
                                    Sync Calendar
                                </Label>
                                <Select
                                    value={googleSelectedCalendarId || undefined}
                                    onValueChange={handleGoogleCalendarSelection}
                                >
                                    <SelectTrigger
                                        id="googleCalendarSelect"
                                        className="bg-slate-800/40 border-slate-700 text-white w-full"
                                    >
                                        <SelectValue
                                            placeholder={
                                                isGoogleCalendarsLoading ? "Loading calendars..." : "Select a Google calendar"
                                            }
                                        />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-900 border-slate-800 text-white">
                                        {googleCalendars.map((calendar) => (
                                            <SelectItem key={calendar.id} value={calendar.id}>
                                                {calendar.summary}{calendar.primary ? " (Primary)" : ""}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {googleSelectedCalendarSummary && (
                                    <p className="text-xs text-slate-500">
                                        Selected: {googleSelectedCalendarSummary}
                                    </p>
                                )}
                            </div>

                            <div className="border-b border-slate-900 py-3">
                                <div className="flex items-start gap-4">
                                    <div className="flex-1 min-w-0 space-y-1">
                                        <Label htmlFor="googleSyncAppToGoogleEnabled" className="text-slate-200">
                                            Sync Vouch -&gt; Google Calendar
                                        </Label>
                                        <p className="text-xs text-slate-400">
                                            Task changes in Vouch are pushed to your selected Google calendar.
                                        </p>
                                    </div>
                                    <GlassToggle
                                        id="googleSyncAppToGoogleEnabled"
                                        checked={googleSyncAppToGoogleEnabled}
                                        disabled={!googleSelectedCalendarId || isGoogleActionLoading}
                                        onChange={handleGoogleAppToGoogleToggle}
                                    />
                                </div>
                            </div>

                            <div className="border-b border-slate-900 py-3">
                                <div className="flex items-start gap-4">
                                    <div className="flex-1 min-w-0 space-y-1">
                                        <Label htmlFor="googleSyncGoogleToAppEnabled" className="text-slate-200">
                                            Sync Google Calendar -&gt; Vouch
                                        </Label>
                                        <p className="text-xs text-slate-400">
                                            Uses your default voucher and default failure cost for Google-created tasks.
                                        </p>
                                    </div>
                                    <GlassToggle
                                        id="googleSyncGoogleToAppEnabled"
                                        checked={googleSyncGoogleToAppEnabled}
                                        disabled={!googleSelectedCalendarId || isGoogleActionLoading}
                                        onChange={handleGoogleGoogleToAppToggle}
                                    />
                                </div>
                            </div>

                            <div className="border-b border-slate-900 py-3">
                                <div className="flex items-start gap-4">
                                    <div className="flex-1 min-w-0 space-y-1">
                                        <Label htmlFor="googleImportOnlyTaggedEvents" className="text-slate-200">
                                            Import only tagged Google events
                                        </Label>
                                        <p className="text-xs text-slate-400">
                                            When enabled, only Google events containing <span className="font-mono">-event</span> in the title or description are imported into Vouch.
                                        </p>
                                    </div>
                                    <GlassToggle
                                        id="googleImportOnlyTaggedEvents"
                                        checked={googleImportOnlyTaggedEvents}
                                        disabled={!googleSyncGoogleToAppEnabled || isGoogleActionLoading}
                                        onChange={handleGoogleImportFilterToggle}
                                    />
                                </div>
                                {!googleSyncGoogleToAppEnabled && (
                                    <p className="mt-2 text-xs text-slate-500">
                                        Enable Google Calendar -&gt; Vouch sync first to configure this filter.
                                    </p>
                                )}
                            </div>
                        </>
                    )}

                    {googleLastSyncAt && (
                        <p className="text-xs text-slate-500">
                            Last sync: {new Date(googleLastSyncAt).toLocaleString()}
                        </p>
                    )}

                    {googleLastError && (
                        <p className="border-b border-red-900/60 pb-2 text-sm text-red-400">
                            {googleLastError}
                        </p>
                    )}
                    {googleActionSuccess && (
                        <p className="border-b border-green-900/60 pb-2 text-sm text-green-400">
                            {googleActionSuccess}
                        </p>
                    )}
                </div>
            </section>

            <section className="space-y-3 border-b border-slate-900 pb-8">
                <h2 className="text-xl font-semibold text-white">Account</h2>
                <div className="flex justify-between border-b border-slate-900 py-2 text-sm">
                    <span className="text-slate-400">Member since</span>
                    <span className="text-white">
                        {formatDateOnlyDDMMYYYY(profile.created_at)}
                    </span>
                </div>
            </section>

            <section className="space-y-4 border-b border-red-950 pb-8">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-red-300">Danger Zone</h2>
                    <p className="text-sm text-red-200/80">
                        Permanently delete your account and associated data.
                    </p>
                </div>
                <div className="space-y-2">
                    <p className="text-sm text-slate-400">
                        Download a copy of all your data — tasks, ledger, sessions, friends, and more — as a JSON file.
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleExportData}
                        disabled={isExporting}
                        className="border-slate-700 text-slate-200 hover:bg-slate-800"
                    >
                        {isExporting ? "Exporting..." : "Export my data"}
                    </Button>
                    {exportError && (
                        <p className="text-sm text-red-400">{exportError}</p>
                    )}
                </div>
                <p className="text-sm text-red-100/90">
                    This action is irreversible. Your profile, tasks, reminders, friendships, and related records will be deleted.
                </p>
                {deleteAccountError && (
                    <p className="border-b border-red-900/60 pb-2 text-sm text-red-300">
                        {deleteAccountError}
                    </p>
                )}
                {deleteAccountSuccess && (
                    <p className="border-b border-green-900/60 pb-2 text-sm text-green-300">
                        Account successfully deleted. Redirecting...
                    </p>
                )}
                <Button
                    type="button"
                    variant="destructive"
                    onClick={handleDeleteAccount}
                    disabled={isDeletingAccount || deleteAccountSuccess || isCheckingVoucherConflicts}
                    className="bg-red-700 hover:bg-red-600 text-white"
                >
                    {deleteAccountSuccess
                        ? "Account Deleted"
                        : isDeletingAccount
                            ? "Deleting Account..."
                            : isCheckingVoucherConflicts
                                ? "Checking..."
                                : "Delete Account"}
                </Button>
            </section>

            <section className="space-y-3 border-b border-slate-900 pb-8">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-white">Charity Preferences</h2>
                    <p className="text-sm text-slate-400">Coming soon</p>
                </div>
                <p className="text-slate-400">
                    You&apos;ll be able to select your preferred charity for donations
                    here. For now, all contributions will go to a placeholder charity.
                </p>
            </section>

            {showDeleteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
                    <div className="w-full max-w-xl border border-slate-700 bg-slate-900 p-6">
                        <h3 className="text-lg font-semibold text-white">
                            {voucherConflicts.length > 0
                                ? "You are an active voucher"
                                : "Delete account?"}
                        </h3>

                        {voucherConflicts.length > 0 ? (
                            <div className="mt-4 space-y-4">
                                <p className="text-sm text-slate-300">
                                    Deleting your account will remove you as voucher for these tasks. The task owners will not be notified.
                                </p>
                                <ul className="max-h-56 overflow-auto border-y border-slate-800 py-3 text-sm text-slate-200">
                                    {voucherConflicts.map((task) => (
                                        <li key={task.id} className="border-b border-slate-900 py-2 last:border-b-0">
                                            {"\u2022"} {task.title} {"\u2014"} owned by @{task.ownerUsername}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : (
                            <p className="mt-4 text-sm text-slate-300">
                                This permanently deletes your account and all associated data. This action cannot be undone.
                            </p>
                        )}

                        <div className="mt-6 flex justify-end gap-3">
                            <Button
                                type="button"
                                onClick={() => setShowDeleteModal(false)}
                                disabled={isDeletingAccount}
                                className="bg-slate-800 text-slate-100 hover:bg-slate-700"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                onClick={handleDeleteAccountConfirm}
                                disabled={isDeletingAccount}
                                className="bg-red-700 hover:bg-red-600 text-white"
                            >
                                {isDeletingAccount
                                    ? "Deleting Account..."
                                    : voucherConflicts.length > 0
                                        ? "Delete Anyway"
                                        : "Delete Account"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

function urlBase64ToUint8Array(base64String: string) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
