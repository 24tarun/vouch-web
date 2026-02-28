"use client";

import { useEffect, useRef, useState } from "react";
import { deleteAccount, updateUserDefaults, updateUsername } from "@/actions/auth";
import { addFriend, getFriends, removeFriend } from "@/actions/friends";
import {
    disconnectGoogleCalendar,
    listGoogleCalendarsForSettings,
    setGoogleCalendarCalendar,
    setGoogleCalendarSyncEnabled,
    startGoogleCalendarConnect,
    type GoogleCalendarIntegrationState,
} from "@/actions/google-calendar";
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
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PushInitializer } from "@/components/PushInitializer";
import { SignOutMenuForm } from "@/components/SignOutMenuForm";
import { HardRefreshButton } from "@/components/HardRefreshButton";
import type { Profile } from "@/lib/types";
import {
    getFailureCostBounds,
    getCurrencySymbol,
    normalizeCurrency,
    SUPPORTED_CURRENCIES,
    type SupportedCurrency,
} from "@/lib/currency";
import {
    DEFAULT_FAILURE_COST_CENTS,
    DEFAULT_POMO_DURATION_MINUTES,
} from "@/lib/constants";

interface SettingsClientProps {
    profile: Profile;
    friends: Profile[];
    googleCalendarIntegration: GoogleCalendarIntegrationState;
}

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

    const [friends, setFriends] = useState<Profile[]>(initialFriends);
    const [friendEmail, setFriendEmail] = useState("");
    const [isFriendsLoading, setIsFriendsLoading] = useState(false);
    const [friendsError, setFriendsError] = useState<string | null>(null);
    const [friendsSuccess, setFriendsSuccess] = useState<string | null>(null);

    const [username, setUsername] = useState(profile.username);
    const [isUsernameLoading, setIsUsernameLoading] = useState(false);
    const [usernameError, setUsernameError] = useState<string | null>(null);
    const [usernameSuccess, setUsernameSuccess] = useState(false);

    const [defaultPomoDurationMinutes, setDefaultPomoDurationMinutes] = useState(
        String(profile.default_pomo_duration_minutes ?? DEFAULT_POMO_DURATION_MINUTES)
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
    const [currency, setCurrency] = useState<SupportedCurrency>(initialCurrency);
    const [isDefaultsLoading, setIsDefaultsLoading] = useState(false);
    const [defaultsError, setDefaultsError] = useState<string | null>(null);
    const [defaultsSuccess, setDefaultsSuccess] = useState(false);
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);
    const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
    const [deleteAccountSuccess, setDeleteAccountSuccess] = useState(false);
    const [googleConnected, setGoogleConnected] = useState(googleCalendarIntegration.connected);
    const [googleSyncEnabled, setGoogleSyncEnabled] = useState(googleCalendarIntegration.syncEnabled);
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
    const saveRequestIdRef = useRef(0);
    const hasValidDefaultVoucher =
        !!defaultVoucherId &&
        (defaultVoucherId === profile.id || friends.some((friend) => friend.id === defaultVoucherId));
    const effectiveDefaultVoucherId = hasValidDefaultVoucher ? (defaultVoucherId as string) : profile.id;
    const currencySymbol = getCurrencySymbol(currency);
    const failureCostBounds = getFailureCostBounds(currency);

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
        formData.append("defaultFailureCost", defaultFailureCostEuros);
        formData.append("defaultVoucherId", effectiveDefaultVoucherId ?? "");
        formData.append("strictPomoEnabled", String(strictPomoEnabled));
        formData.append("deadlineOneHourWarningEnabled", String(deadlineOneHourWarningEnabled));
        formData.append("deadlineFinalWarningEnabled", String(deadlineFinalWarningEnabled));
        formData.append("voucherCanViewActiveTasksEnabled", String(voucherCanViewActiveTasksEnabled));
        formData.append("currency", currency);
        return formData;
    };

    /*
     * This validation helper prevents invalid intermediate values from triggering server writes while
     * the user is actively typing.
     *
     * Validation order:
     * 1) Check default pomodoro duration is an integer within 1..720.
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
            parsedPomo > 720
        ) {
            return "Default Pomodoro duration must be an integer between 1 and 720.";
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
        setFriends((updatedFriends as Profile[]) || []);
    }

    async function handleAddFriend(e: React.FormEvent) {
        e.preventDefault();
        setIsFriendsLoading(true);
        setFriendsError(null);
        setFriendsSuccess(null);

        try {
            const formData = new FormData();
            formData.append("email", friendEmail);
            const result = await addFriend(formData);

            if (result.error) {
                setFriendsError(result.error);
                return;
            }

            setFriendsSuccess("Friend added successfully.");
            setFriendEmail("");
            await refreshFriendsList();
        } catch (error) {
            console.error(error);
            setFriendsError("Failed to add friend.");
        } finally {
            setIsFriendsLoading(false);
        }
    }

    async function handleRemoveFriend(friendId: string) {
        setIsFriendsLoading(true);
        setFriendsError(null);
        setFriendsSuccess(null);

        try {
            const result = await removeFriend(friendId);

            if (result.error) {
                setFriendsError(result.error);
                return;
            }

            if (defaultVoucherId === friendId) {
                setDefaultVoucherId(profile.id);
            }

            await refreshFriendsList();
        } catch (error) {
            console.error(error);
            setFriendsError("Failed to remove friend.");
        } finally {
            setIsFriendsLoading(false);
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
        defaultPomoDurationMinutes,
        defaultFailureCostEuros,
        effectiveDefaultVoucherId,
        strictPomoEnabled,
        deadlineOneHourWarningEnabled,
        deadlineFinalWarningEnabled,
        voucherCanViewActiveTasksEnabled,
        currency,
    ]);

    useEffect(() => {
        if (!googleConnected) return;
        setIsGoogleCalendarsLoading(true);
        listGoogleCalendarsForSettings()
            .then((result) => {
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
            setGoogleSyncEnabled(false);
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

    async function handleGoogleSyncToggle(enabled: boolean) {
        if (isGoogleActionLoading) return;
        setIsGoogleActionLoading(true);
        setGoogleActionSuccess(null);
        setGoogleLastError(null);

        try {
            const result = await setGoogleCalendarSyncEnabled(enabled);
            if (result.error) {
                setGoogleLastError(result.error);
                return;
            }

            setGoogleSyncEnabled(enabled);
            setGoogleLastSyncAt(new Date().toISOString());
            setGoogleActionSuccess(enabled ? "Google Calendar sync enabled." : "Google Calendar sync disabled.");
        } catch (error) {
            console.error(error);
            setGoogleLastError("Could not update sync setting.");
        } finally {
            setIsGoogleActionLoading(false);
        }
    }

    async function handleDeleteAccount() {
        if (isDeletingAccount || deleteAccountSuccess) return;

        const confirmed = window.confirm(
            "This permanently deletes your account and all associated data. This action cannot be undone. Continue?"
        );
        if (!confirmed) return;

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

    return (
        <div className="max-w-3xl mx-auto space-y-8 pb-20 mt-12 px-4 md:px-0">
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

            <PushInitializer />

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Friends</CardTitle>
                    <CardDescription className="text-slate-400">
                        Add or remove friends used for vouchers and activity visibility
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <form onSubmit={handleAddFriend} className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1 min-w-0">
                            <Label htmlFor="friendEmail" className="sr-only">
                                Friend Email
                            </Label>
                            <Input
                                id="friendEmail"
                                type="email"
                                placeholder="name@domain.com"
                                value={friendEmail}
                                onChange={(e) => setFriendEmail(e.target.value)}
                                required
                                className="bg-slate-800/40 border-slate-700 text-white"
                            />
                        </div>
                        <Button
                            type="submit"
                            disabled={isFriendsLoading}
                            className="bg-slate-100 text-slate-950 hover:bg-white font-semibold"
                        >
                            {isFriendsLoading ? "Adding..." : "Add Friend"}
                        </Button>
                    </form>

                    {friendsError && (
                        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
                            {friendsError}
                        </p>
                    )}
                    {friendsSuccess && (
                        <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded px-3 py-2">
                            {friendsSuccess}
                        </p>
                    )}

                    {friends.length === 0 ? (
                        <p className="text-sm text-slate-500">No friends yet.</p>
                    ) : (
                        <div className="space-y-2">
                            {friends.map((friend) => (
                                <div
                                    key={friend.id}
                                    className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-950/50 px-3 py-3"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Avatar className="h-8 w-8 border border-slate-800">
                                            <AvatarFallback className="bg-slate-900 text-slate-400 text-[10px] font-mono">
                                                {friend.username?.slice(0, 2).toUpperCase() || "??"}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-white truncate">{friend.username}</p>
                                            <p className="text-xs text-slate-500 truncate">{friend.email}</p>
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRemoveFriend(friend.id)}
                                        disabled={isFriendsLoading}
                                        className="text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}

                    <p className="text-xs text-slate-500">
                        Friends can only be removed if they are not an active voucher for your pending tasks.
                    </p>
                </CardContent>
            </Card>

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Profile</CardTitle>
                    <CardDescription className="text-slate-400">
                        Update your username
                    </CardDescription>
                </CardHeader>
                <CardContent>
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
                </CardContent>
            </Card>

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Defaults</CardTitle>
                    <CardDescription className="text-slate-400">
                        Choose default values for new tasks and Pomodoro sessions
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="defaultPomoDurationMinutes" className="text-slate-200">
                                Default Pomodoro Duration (minutes)
                            </Label>
                            <Input
                                id="defaultPomoDurationMinutes"
                                type="number"
                                min="1"
                                max="720"
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

                        {isDefaultsLoading && (
                            <p className="text-sm text-slate-300">Saving...</p>
                        )}

                        <div className="rounded-lg border border-slate-700/70 bg-slate-800/30 px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="space-y-1">
                                    <Label htmlFor="strictPomoEnabled" className="text-slate-200">
                                        Strict Pomodoro
                                    </Label>
                                    <p className="text-xs text-slate-400">
                                        When enabled, newly started pomodoros cannot be paused and only timer-completed sessions count.
                                    </p>
                                </div>
                                <input
                                    id="strictPomoEnabled"
                                    type="checkbox"
                                    checked={strictPomoEnabled}
                                    onChange={(e) => setStrictPomoEnabled(e.target.checked)}
                                    className="h-4 w-4 accent-cyan-400"
                                />
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-700/70 bg-slate-800/30 px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="space-y-1">
                                    <Label htmlFor="deadlineOneHourWarningEnabled" className="text-slate-200">
                                        Deadline warning (1 hour before deadline)
                                    </Label>
                                    <p className="text-xs text-slate-400">
                                        Auto-adds a 1-hour reminder to each task. You can remove it per task in task details.
                                    </p>
                                </div>
                                <input
                                    id="deadlineOneHourWarningEnabled"
                                    type="checkbox"
                                    checked={deadlineOneHourWarningEnabled}
                                    onChange={(e) => setDeadlineOneHourWarningEnabled(e.target.checked)}
                                    className="h-4 w-4 accent-cyan-400"
                                />
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-700/70 bg-slate-800/30 px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="space-y-1">
                                    <Label htmlFor="deadlineFinalWarningEnabled" className="text-slate-200">
                                        Final deadline warning (5 minutes before deadline)
                                    </Label>
                                    <p className="text-xs text-slate-400">
                                        Auto-adds a 5-minute reminder to each task. You can remove it per task in task details.
                                    </p>
                                </div>
                                <input
                                    id="deadlineFinalWarningEnabled"
                                    type="checkbox"
                                    checked={deadlineFinalWarningEnabled}
                                    onChange={(e) => setDeadlineFinalWarningEnabled(e.target.checked)}
                                    className="h-4 w-4 accent-cyan-400"
                                />
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-700/70 bg-slate-800/30 px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="space-y-1">
                                    <Label htmlFor="voucherCanViewActiveTasksEnabled" className="text-slate-200">
                                        Allow vouchers to view my active tasks
                                    </Label>
                                    <p className="text-xs text-slate-400">
                                        Controls whether selected vouchers can see your tasks in CREATED or POSTPONED status.
                                    </p>
                                </div>
                                <input
                                    id="voucherCanViewActiveTasksEnabled"
                                    type="checkbox"
                                    checked={voucherCanViewActiveTasksEnabled}
                                    onChange={(e) => setVoucherCanViewActiveTasksEnabled(e.target.checked)}
                                    className="h-4 w-4 accent-cyan-400"
                                />
                            </div>
                        </div>

                        {defaultsError && <p className="text-sm text-red-400">{defaultsError}</p>}
                        {defaultsSuccess && (
                            <p className="text-sm text-green-400">Defaults updated!</p>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Google Calendar</CardTitle>
                    <CardDescription className="text-slate-400">
                        Optional two-way calendar event sync. Use -event when creating a task to sync it with Google Calendar.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
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
                                    variant="outline"
                                    onClick={handleGoogleRefreshCalendars}
                                    disabled={isGoogleActionLoading}
                                    className="border-slate-700 text-slate-200 hover:bg-slate-800"
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

                            <div className="rounded-lg border border-slate-700/70 bg-slate-800/30 px-3 py-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="googleSyncEnabled" className="text-slate-200">
                                            Enable Google Calendar sync
                                        </Label>
                                        <p className="text-xs text-slate-400">
                                            Uses your default voucher and default failure cost for Google-created tasks.
                                        </p>
                                    </div>
                                    <input
                                        id="googleSyncEnabled"
                                        type="checkbox"
                                        checked={googleSyncEnabled}
                                        disabled={!googleSelectedCalendarId || isGoogleActionLoading}
                                        onChange={(e) => handleGoogleSyncToggle(e.target.checked)}
                                        className="h-4 w-4 accent-cyan-400"
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {googleLastSyncAt && (
                        <p className="text-xs text-slate-500">
                            Last sync: {new Date(googleLastSyncAt).toLocaleString()}
                        </p>
                    )}

                    {googleLastError && (
                        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
                            {googleLastError}
                        </p>
                    )}
                    {googleActionSuccess && (
                        <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded px-3 py-2">
                            {googleActionSuccess}
                        </p>
                    )}
                </CardContent>
            </Card>

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Account</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="text-slate-400">Member since</span>
                        <span className="text-white">
                            {new Date(profile.created_at).toLocaleDateString()}
                        </span>
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-red-950/20 border-red-900/60">
                <CardHeader>
                    <CardTitle className="text-red-300">Danger Zone</CardTitle>
                    <CardDescription className="text-red-200/80">
                        Permanently delete your account and associated data.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-red-100/90">
                        This action is irreversible. Your profile, tasks, reminders, friendships, and related records will be deleted.
                    </p>
                    {deleteAccountError && (
                        <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
                            {deleteAccountError}
                        </p>
                    )}
                    {deleteAccountSuccess && (
                        <p className="text-sm text-green-300 bg-green-500/10 border border-green-500/30 rounded px-3 py-2">
                            Account successfully deleted. Redirecting...
                        </p>
                    )}
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={handleDeleteAccount}
                        disabled={isDeletingAccount || deleteAccountSuccess}
                        className="bg-red-700 hover:bg-red-600 text-white"
                    >
                        {deleteAccountSuccess ? "Account Deleted" : isDeletingAccount ? "Deleting Account..." : "Delete Account"}
                    </Button>
                </CardContent>
            </Card>

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-white">Charity Preferences</CardTitle>
                    <CardDescription className="text-slate-400">
                        Coming soon
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-slate-400">
                        You&apos;ll be able to select your preferred charity for donations
                        here. For now, all contributions will go to a placeholder charity.
                    </p>
                </CardContent>
            </Card>

        </div>
    );
}
