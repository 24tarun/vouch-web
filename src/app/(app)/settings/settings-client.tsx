"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GlassToggle } from "@/components/GlassToggle";
import { deleteAccount, getActiveVoucherTasks, updateUserDefaults, updateUsername } from "@/actions/auth";
import { exportUserData } from "@/actions/export";
import {
    searchUsersForFriendship,
    setAiAsFriendEnabled,
    type BlockedUserOption,
    type IncomingFriendRequest,
    type OutgoingFriendRequest,
    type SearchCandidate,
} from "@/actions/friends";
import {
    listGoogleCalendarsForSettings,
    type GoogleCalendarIntegrationState,
} from "@/actions/google-calendar";
import { deleteSubscription, saveSubscription, sendTestPushNotification } from "@/actions/push";
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
import type { Charity, FriendProfile, Profile } from "@/lib/types";
import {
    getFailureCostBounds,
    getCurrencySymbol,
    normalizeCurrency,
    SUPPORTED_CURRENCIES,
    type SupportedCurrency,
} from "@/lib/currency";
import {
    DEFAULT_EVENT_DURATION_MINUTES,
    DEFAULT_FAILURE_COST_CENTS,
    DEFAULT_POMO_DURATION_MINUTES,
    MAX_POMO_DURATION_MINUTES,
} from "@/lib/constants";
import { AI_VOUCHER_DISPLAY_NAME, AI_PROFILE_ID } from "@/lib/ai-voucher/constants";
import { normalizePomoDurationMinutes } from "@/lib/pomodoro";
import { formatTimeZoneLabel, getTimeZoneOptions } from "@/lib/timezones";
import { DeleteAccountModal } from "@/app/(app)/settings/settings/sections/delete-account-modal";
import { useSettingsRelationships } from "@/app/(app)/settings/settings/hooks/use-settings-relationships";
import { useSettingsGoogleCalendar } from "@/app/(app)/settings/settings/hooks/use-settings-google-calendar";
import {
    buildDefaultsFormData,
    clampFailureCostToCurrencyBounds,
    validateDefaultsState,
} from "@/app/(app)/settings/settings/utils/defaults";
import {
    isLikelyValidVapidPublicKey,
    normalizeVapidPublicKey,
    urlBase64ToUint8Array,
} from "@/app/(app)/settings/settings/utils/push";

const VAPID_PUBLIC_KEY = normalizeVapidPublicKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "");

interface SettingsClientProps {
    profile: Profile;
    friends: FriendProfile[];
    googleCalendarIntegration: GoogleCalendarIntegrationState;
    charities: Charity[];
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
    charities,
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
    const [aiFriendEnabled, setAiFriendEnabled] = useState(profile.ai_friend_opt_in ?? false);
    const [isAiFriendLoading, setIsAiFriendLoading] = useState(false);
    const [aiFriendError, setAiFriendError] = useState<string | null>(null);
    const [aiFriendSuccess, setAiFriendSuccess] = useState<string | null>(null);

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
    const [deadlineOneHourWarningEnabled, setDeadlineOneHourWarningEnabled] = useState(
        profile.deadline_one_hour_warning_enabled ?? true
    );
    const [deadlineFinalWarningEnabled, setDeadlineFinalWarningEnabled] = useState(
        profile.deadline_final_warning_enabled ?? true
    );
    const [voucherCanViewActiveTasksEnabled, setVoucherCanViewActiveTasksEnabled] = useState(
        profile.voucher_can_view_active_tasks ?? false
    );
    const [defaultRequiresProofForAllTasks, setDefaultRequiresProofForAllTasks] = useState(
        profile.default_requires_proof_for_all_tasks ?? false
    );
    const [mobileNotificationsEnabled, setMobileNotificationsEnabled] = useState(
        profile.mobile_notifications_enabled ?? false
    );
    const [isMobileNotificationsLoading, setIsMobileNotificationsLoading] = useState(false);
    const [mobileNotificationsError, setMobileNotificationsError] = useState<string | null>(null);
    const [isTestPushLoading, setIsTestPushLoading] = useState(false);
    const [testPushStatusMessage, setTestPushStatusMessage] = useState<string | null>(null);
    const [testPushStatusKind, setTestPushStatusKind] = useState<"success" | "error" | null>(null);
    const [currency, setCurrency] = useState<SupportedCurrency>(initialCurrency);
    const [timeZone, setTimeZone] = useState(profile.timezone || "UTC");
    const [timeZoneUserSet, setTimeZoneUserSet] = useState(profile.timezone_user_set ?? false);
    const [charityEnabled, setCharityEnabled] = useState(profile.charity_enabled ?? false);
    const [selectedCharityId, setSelectedCharityId] = useState(profile.selected_charity_id ?? "");
    const [isCharitySelectOpen, setIsCharitySelectOpen] = useState(false);
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
    const [googleAccountEmail, setGoogleAccountEmail] = useState<string | null>(googleCalendarIntegration.accountEmail);
    const [googleSelectedCalendarId, setGoogleSelectedCalendarId] = useState<string>(
        googleCalendarIntegration.selectedCalendarId ?? ""
    );
    const [googleSelectedCalendarSummary, setGoogleSelectedCalendarSummary] = useState<string | null>(
        googleCalendarIntegration.selectedCalendarSummary
    );
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
    const [pushApiSupported, setPushApiSupported] = useState(false);
    useEffect(() => {
        setPushApiSupported(
            "serviceWorker" in navigator &&
            "PushManager" in window &&
            "Notification" in window
        );
    }, []);
    const canEnableMobileNotifications = VAPID_PUBLIC_KEY.length > 0 && pushApiSupported;
    const deviceTimeZone = useMemo(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        []
    );
    const timeZoneOptions = useMemo(() => {
        const options = getTimeZoneOptions();
        return options.includes(timeZone) ? options : [timeZone, ...options];
    }, [timeZone]);
    const selectedCharity = useMemo(
        () => charities.find((charity) => charity.id === selectedCharityId) ?? null,
        [charities, selectedCharityId]
    );
    const defaultCharityId = useMemo(() => {
        const donateToDeveloper = charities.find(
            (charity) => charity.key === "donate_to_developer" && charity.is_active
        );
        if (donateToDeveloper) {
            return donateToDeveloper.id;
        }
        const firstActiveCharity = charities.find((charity) => charity.is_active);
        return firstActiveCharity?.id ?? "";
    }, [charities]);
    const defaultsSnapshot = useMemo(
        () =>
            JSON.stringify({
                defaultPomoDurationMinutes,
                defaultEventDurationMinutes,
                defaultFailureCostEuros,
                effectiveDefaultVoucherId,
                deadlineOneHourWarningEnabled,
                deadlineFinalWarningEnabled,
                voucherCanViewActiveTasksEnabled,
                defaultRequiresProofForAllTasks,
                mobileNotificationsEnabled,
                currency,
                timeZone,
                timeZoneUserSet,
                charityEnabled,
                selectedCharityId,
            }),
        [
            defaultPomoDurationMinutes,
            defaultEventDurationMinutes,
            defaultFailureCostEuros,
            effectiveDefaultVoucherId,
            deadlineOneHourWarningEnabled,
            deadlineFinalWarningEnabled,
            voucherCanViewActiveTasksEnabled,
            defaultRequiresProofForAllTasks,
            mobileNotificationsEnabled,
            currency,
            timeZone,
            timeZoneUserSet,
            charityEnabled,
            selectedCharityId,
        ]
    );

    const {
        refreshRelationshipsAndSearch,
        handleSendFriendRequest,
        handleAcceptFriendRequest,
        handleRejectFriendRequest,
        handleWithdrawFriendRequest,
        handleRemoveFriend,
        handleBlockRelationshipUser,
        handleUnblockUser,
    } = useSettingsRelationships({
        profile,
        defaultVoucherId,
        friendSearchQuery,
        setDefaultVoucherId,
        setFriends,
        setRelationshipFriends,
        setIncomingRequests,
        setOutgoingRequests,
        setRelationshipsLoading,
        setRelationshipsError,
        setRelationshipSuccess,
        setRelationshipInFlight,
        setFriendSearchResults,
        setFriendSearchError,
        setBlockedUsers,
        setBlockedUsersLoading,
        setBlockedUsersError,
        setUnblockingUserId,
    });

    async function handleAiFriendToggle(nextEnabled: boolean) {
        if (isAiFriendLoading) return;

        const previousEnabled = aiFriendEnabled;
        setAiFriendEnabled(nextEnabled);
        setIsAiFriendLoading(true);
        setAiFriendError(null);
        setAiFriendSuccess(null);

        try {
            const result = await setAiAsFriendEnabled(nextEnabled);

            if (result.error) {
                setAiFriendEnabled(previousEnabled);
                setAiFriendError(result.error);
                return;
            }

            const resolvedEnabled = result.enabled ?? nextEnabled;
            setAiFriendEnabled(resolvedEnabled);
            if (!resolvedEnabled && defaultVoucherId === AI_PROFILE_ID) {
                setDefaultVoucherId(profile.id);
            }
            setAiFriendSuccess(
                resolvedEnabled
                    ? `${AI_VOUCHER_DISPLAY_NAME} added as a friend.`
                    : `${AI_VOUCHER_DISPLAY_NAME} removed from your friends.`
            );
            await refreshRelationshipsAndSearch();
        } catch (error) {
            console.error(error);
            setAiFriendEnabled(previousEnabled);
            setAiFriendError("Failed to update AI friend setting.");
        } finally {
            setIsAiFriendLoading(false);
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

    function handleTimeZoneChange(value: string) {
        setTimeZone(value);
        setTimeZoneUserSet(true);
    }

    function handleCharityToggle(nextEnabled: boolean) {
        setCharityEnabled(nextEnabled);
        if (!nextEnabled) {
            setSelectedCharityId("");
            setIsCharitySelectOpen(false);
            return;
        }
        if (!selectedCharityId || !selectedCharity || !selectedCharity.is_active) {
            setSelectedCharityId(defaultCharityId);
        }
        setIsCharitySelectOpen(true);
    }

    function handleCharitySelect(value: string) {
        if (value === "__none__") {
            setSelectedCharityId("");
            setCharityEnabled(false);
            return;
        }
        setSelectedCharityId(value);
        if (!charityEnabled) {
            setCharityEnabled(true);
        }
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
            const existing = await registration.pushManager.getSubscription();
            if (existing) {
                await existing.unsubscribe();
            }
            let applicationServerKey: Uint8Array;
            try {
                applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
            } catch {
                setMobileNotificationsError(
                    "NEXT_PUBLIC_VAPID_PUBLIC_KEY is malformed. Regenerate VAPID keys and redeploy."
                );
                return;
            }
            if (!isLikelyValidVapidPublicKey(applicationServerKey)) {
                setMobileNotificationsError(
                    "NEXT_PUBLIC_VAPID_PUBLIC_KEY is invalid (expected a 65-byte uncompressed key)."
                );
                return;
            }

            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey as BufferSource,
            });

            const serialized = JSON.parse(JSON.stringify(subscription));
            const result = await saveSubscription(serialized);
            if (!result.success) {
                setMobileNotificationsError(result.error ?? "Could not save push subscription.");
                return;
            }

            setMobileNotificationsEnabled(true);
        } catch (error) {
            console.error(error);
            if (error instanceof DOMException && error.name === "AbortError") {
                setMobileNotificationsError(
                    "Push registration failed. Check VAPID key pair/environment variables and browser push service availability."
                );
                return;
            }
            setMobileNotificationsError(
                error instanceof Error && error.message
                    ? error.message
                    : "Could not update web push notification setting."
            );
        } finally {
            setIsMobileNotificationsLoading(false);
        }
    }

    async function handleSendTestPush() {
        if (isTestPushLoading) return;

        setIsTestPushLoading(true);
        setTestPushStatusMessage(null);
        setTestPushStatusKind(null);

        try {
            const result = await sendTestPushNotification();
            if (!result.success) {
                setTestPushStatusKind("error");
                setTestPushStatusMessage(result.error ?? "Could not send test notification.");
                return;
            }

            setTestPushStatusKind("success");
            setTestPushStatusMessage("Test notification sent.");
        } catch (error) {
            console.error(error);
            setTestPushStatusKind("error");
            setTestPushStatusMessage(
                error instanceof Error && error.message
                    ? error.message
                    : "Could not send test notification."
            );
        } finally {
            setIsTestPushLoading(false);
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
        if (timeZoneUserSet) return;
        if (!deviceTimeZone || deviceTimeZone === timeZone) return;
        if (!timeZoneOptions.includes(deviceTimeZone)) return;
        setTimeZone(deviceTimeZone);
    }, [deviceTimeZone, timeZone, timeZoneOptions, timeZoneUserSet]);

    useEffect(() => {
        if (!charityEnabled) return;
        if (!selectedCharityId || !selectedCharity || !selectedCharity.is_active) {
            if (defaultCharityId) {
                setSelectedCharityId(defaultCharityId);
                return;
            }
            setCharityEnabled(false);
            setSelectedCharityId("");
        }
    }, [charityEnabled, defaultCharityId, selectedCharity, selectedCharityId]);

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

        const validationError = validateDefaultsState({
            defaultPomoDurationMinutes,
            defaultEventDurationMinutes,
            defaultFailureCostEuros,
            currency,
            currencySymbol,
            timeZone,
            timeZoneOptions,
            charityEnabled,
            selectedCharityId,
            selectedCharity,
        });
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
            const result = await updateUserDefaults(
                buildDefaultsFormData({
                    defaultPomoDurationMinutes,
                    defaultEventDurationMinutes,
                    defaultFailureCostEuros,
                    effectiveDefaultVoucherId,
                    deadlineOneHourWarningEnabled,
                    deadlineFinalWarningEnabled,
                    voucherCanViewActiveTasksEnabled,
                    defaultRequiresProofForAllTasks,
                    mobileNotificationsEnabled,
                    currency,
                    timeZone,
                    timeZoneUserSet,
                    charityEnabled,
                    selectedCharityId,
                })
            );

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

    const {
        handleGoogleConnectionToggle,
        handleGoogleRefreshCalendars,
        handleGoogleCalendarSelection,
        handleGoogleAppToGoogleToggle,
    } = useSettingsGoogleCalendar({
        googleConnected,
        isGoogleActionLoading,
        googleCalendars,
        setGoogleConnected,
        setGoogleSyncAppToGoogleEnabled,
        setGoogleAccountEmail,
        setGoogleSelectedCalendarId,
        setGoogleSelectedCalendarSummary,
        setGoogleCalendars,
        setGoogleLastError,
        setGoogleActionSuccess,
        setIsGoogleActionLoading,
    });

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
                </div>
                <div className="flex items-center gap-2">
                    <HardRefreshButton />
                    <SignOutMenuForm variant="nav" />
                </div>
            </div>
            <section className="space-y-6 border-b border-slate-900 pb-8">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-white">Friends</h2>
                </div>
                <div className="space-y-3">
                    <Input
                        id="friendSearch"
                        type="text"
                        placeholder="Search friends with their email or username"
                        value={friendSearchQuery}
                        onChange={(e) => setFriendSearchQuery(e.target.value)}
                        className="bg-slate-800/40 border-slate-700 text-white"
                    />
                </div>

                {relationshipsError && <p className="text-sm text-red-400">{relationshipsError}</p>}
                {blockedUsersError && <p className="text-sm text-red-400">{blockedUsersError}</p>}
                {relationshipSuccess && <p className="text-sm text-green-400">{relationshipSuccess}</p>}

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
                                    {friend.id === AI_PROFILE_ID ? (
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

            </section>

            <section className="space-y-4 border-b border-slate-900 pb-8">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-white">Blocked Users</h2>
                </div>
                {blockedUsersLoading ? null : blockedUsers.length === 0 ? (
                    null
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
	                    <h2 className="text-xl font-semibold text-white">Defaults</h2>
	                </div>

	                <div className="space-y-4">
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

                    <div className="space-y-2">
                        <Label htmlFor="timezone" className="text-slate-200">
                            Timezone
                        </Label>
                        <Select value={timeZone} onValueChange={handleTimeZoneChange}>
                            <SelectTrigger
                                id="timezone"
                                className="bg-slate-800/40 border-slate-700 text-white w-full"
                            >
                                <SelectValue placeholder="Select timezone" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-900 border-slate-800 text-white max-h-80">
                                {timeZoneOptions.map((zone) => (
                                    <SelectItem key={zone} value={zone}>
                                        {formatTimeZoneLabel(zone)}
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

                    <div className="py-3 border-b border-slate-900">
                        <div className="flex items-center gap-4">
                            <div className="flex-1 min-w-0 space-y-1">
                                <Label htmlFor="deadlineOneHourWarningEnabled" className="text-slate-200">
                                    Deadline warning (1 hour before deadline)
                                </Label>
                            </div>
                            <GlassToggle
                                id="deadlineOneHourWarningEnabled"
                                checked={deadlineOneHourWarningEnabled}
                                onChange={setDeadlineOneHourWarningEnabled}
                            />
                        </div>
                    </div>

                    <div className="py-3 border-b border-slate-900">
                        <div className="flex items-center gap-4">
                            <div className="flex-1 min-w-0 space-y-1">
                                <Label htmlFor="deadlineFinalWarningEnabled" className="flex items-center gap-2 cursor-pointer font-medium text-slate-200">
                                    Final deadline warning (10 minutes before deadline)
                                </Label>
                            </div>
                            <GlassToggle
                                id="deadlineFinalWarningEnabled"
                                checked={deadlineFinalWarningEnabled}
                                onChange={setDeadlineFinalWarningEnabled}
                            />
                        </div>
                    </div>

                    <div className="py-3 border-b border-slate-900">
                        <div className="flex items-center gap-4">
                            <div className="flex-1 min-w-0 space-y-1">
                                <Label htmlFor="defaultRequiresProofForAllTasks" className="text-slate-200">
                                    Require proof for all new tasks
                                </Label>
                            </div>
                            <GlassToggle
                                id="defaultRequiresProofForAllTasks"
                                checked={defaultRequiresProofForAllTasks}
                                onChange={setDefaultRequiresProofForAllTasks}
                            />
                        </div>
                    </div>

                    <div className="py-3 border-b border-slate-900">
                        <div className="flex items-center gap-4">
                            <div className="flex-1 min-w-0 space-y-1">
                                <Label htmlFor="voucherCanViewActiveTasksEnabled" className="text-slate-200">
                                    Allow vouchers to view my active tasks
                                </Label>
                            </div>
                            <GlassToggle
                                id="voucherCanViewActiveTasksEnabled"
                                checked={voucherCanViewActiveTasksEnabled}
                                onChange={setVoucherCanViewActiveTasksEnabled}
                            />
                        </div>
                    </div>

                    <div className="py-3">
                        <div className="flex items-center gap-4">
                            <div className="flex-1 min-w-0 space-y-1">
                                <Label htmlFor="mobileNotificationsEnabled" className="text-slate-200">
                                    Enable web push notifications
                                </Label>
                                {mobileNotificationsError && (
                                    <p className="text-xs text-red-400">{mobileNotificationsError}</p>
                                )}
                                <div className="pt-2 flex items-center gap-3">
                                    <Button
                                        type="button"
                                        onClick={handleSendTestPush}
                                        disabled={
                                            isTestPushLoading ||
                                            isMobileNotificationsLoading ||
                                            !mobileNotificationsEnabled
                                        }
                                        className="h-8 px-3 text-xs bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-60"
                                    >
                                        {isTestPushLoading ? "Sending..." : "Send test push"}
                                    </Button>
                                    {testPushStatusMessage && (
                                        <p
                                            className={`text-xs ${
                                                testPushStatusKind === "success"
                                                    ? "text-green-400"
                                                    : "text-red-400"
                                            }`}
                                        >
                                            {testPushStatusMessage}
                                        </p>
                                    )}
                                </div>
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
                </div>
                <div className="py-3">
                    <div className="flex items-center gap-4">
                        <div className="flex-1 min-w-0 space-y-1">
                            <Label htmlFor="aiFriendEnabled" className="text-slate-200">
                                Add AI as a friend
                            </Label>
                        </div>
                        <GlassToggle
                            id="aiFriendEnabled"
                            checked={aiFriendEnabled}
                            disabled={isAiFriendLoading}
                            onChange={handleAiFriendToggle}
                        />
                    </div>
                </div>
                {aiFriendError && <p className="text-sm text-red-400">{aiFriendError}</p>}
                {aiFriendSuccess && <p className="text-sm text-green-400">{aiFriendSuccess}</p>}
            </section>

            <section className="space-y-4 border-b border-slate-900 pb-8">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-white">Google Calendar</h2>
                </div>

                <div className="space-y-4">
                    <div className="py-3">
                        <div className="flex items-center gap-4">
                            <div className="flex-1 min-w-0 space-y-1">
                                <Label htmlFor="googleConnectedToggle" className="text-slate-200">
                                    Connect Google
                                </Label>
                            </div>
                            <GlassToggle
                                id="googleConnectedToggle"
                                checked={googleConnected}
                                disabled={isGoogleActionLoading}
                                onChange={handleGoogleConnectionToggle}
                            />
                        </div>
                    </div>

                    {googleConnected && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={handleGoogleRefreshCalendars}
                                disabled={isGoogleActionLoading}
                                className="border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                            >
                                {isGoogleActionLoading ? "Working..." : "Refresh Calendars"}
                            </Button>
                        </div>
                    )}

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
                            </div>

                            <div className="border-b border-slate-900 py-3">
                                <div className="flex items-center gap-4">
                                    <div className="flex-1 min-w-0 space-y-1">
                                        <Label htmlFor="googleSyncAppToGoogleEnabled" className="text-slate-200">
                                            Sync Vouch -&gt; Google Calendar
                                        </Label>
                                    </div>
                                    <GlassToggle
                                        id="googleSyncAppToGoogleEnabled"
                                        checked={googleSyncAppToGoogleEnabled}
                                        disabled={!googleSelectedCalendarId || isGoogleActionLoading}
                                        onChange={handleGoogleAppToGoogleToggle}
                                    />
                                </div>
                            </div>

                        </>
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

            <section className="space-y-4 border-b border-red-950 pb-8">
                <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-red-300">Danger Zone</h2>
                </div>
                <div className="space-y-2">
                    <Button
                        type="button"
                        onClick={handleExportData}
                        disabled={isExporting}
                        className="bg-sky-700 hover:bg-sky-600 text-white font-semibold"
                    >
                        {isExporting ? "Exporting..." : "Export my data as a JSON"}
                    </Button>
                    {exportError && (
                        <p className="text-sm text-red-400">{exportError}</p>
                    )}
                </div>
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
                    <h2 className="text-xl font-semibold text-white">Charity Choice</h2>
                </div>
                <div className="border-b border-slate-900 py-3">
                    <div className="flex items-center gap-4">
                        <div className="flex-1 min-w-0 space-y-1">
                            <Label htmlFor="charityEnabled" className="text-slate-200">
                                Enable charity mode
                            </Label>
                        </div>
                        <GlassToggle
                            id="charityEnabled"
                            checked={charityEnabled}
                            onChange={handleCharityToggle}
                        />
                    </div>
                </div>
                {charityEnabled ? (
                    <div className="space-y-2">
                        <Label htmlFor="selectedCharityId" className="text-slate-200">
                            Charity
                        </Label>
                        <Select
                            value={selectedCharityId || "__none__"}
                            onValueChange={handleCharitySelect}
                            open={isCharitySelectOpen}
                            onOpenChange={setIsCharitySelectOpen}
                        >
                            <SelectTrigger
                                id="selectedCharityId"
                                className="bg-slate-800/40 border-slate-700 text-white w-full"
                            >
                                <SelectValue placeholder="Select one charity" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-900 border-slate-800 text-white">
                                <SelectItem value="__none__">No charity selected</SelectItem>
                                {charities.map((charity) => (
                                    <SelectItem key={charity.id} value={charity.id} disabled={!charity.is_active}>
                                        {charity.name}{charity.is_active ? "" : " (Unavailable)"}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}
            </section>

            <DeleteAccountModal
                open={showDeleteModal}
                voucherConflicts={voucherConflicts}
                isDeletingAccount={isDeletingAccount}
                onCancel={() => setShowDeleteModal(false)}
                onConfirm={handleDeleteAccountConfirm}
            />

        </div>
    );
}
