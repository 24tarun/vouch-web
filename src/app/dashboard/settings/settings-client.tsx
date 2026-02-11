"use client";

import { useState } from "react";
import { updateUserDefaults, updateUsername } from "@/actions/auth";
import { addFriend, getFriends, removeFriend } from "@/actions/friends";
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
import { HardRefreshButton } from "@/components/HardRefreshButton";
import type { Profile } from "@/lib/types";
import {
    DEFAULT_FAILURE_COST_CENTS,
    DEFAULT_POMO_DURATION_MINUTES,
} from "@/lib/constants";

interface SettingsClientProps {
    profile: Profile;
    friends: Profile[];
}

const NONE_VOUCHER_VALUE = "__none__";

export default function SettingsClient({ profile, friends: initialFriends }: SettingsClientProps) {
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
        ((profile.default_failure_cost_cents ?? DEFAULT_FAILURE_COST_CENTS) / 100).toFixed(2)
    );
    const [defaultVoucherId, setDefaultVoucherId] = useState<string | null>(
        profile.default_voucher_id ?? null
    );
    const [strictPomoEnabled, setStrictPomoEnabled] = useState(
        profile.strict_pomo_enabled ?? false
    );
    const [deadlineFinalWarningEnabled, setDeadlineFinalWarningEnabled] = useState(
        profile.deadline_final_warning_enabled ?? true
    );
    const [isDefaultsLoading, setIsDefaultsLoading] = useState(false);
    const [defaultsError, setDefaultsError] = useState<string | null>(null);
    const [defaultsSuccess, setDefaultsSuccess] = useState(false);
    const hasValidDefaultVoucher =
        !!defaultVoucherId && friends.some((friend) => friend.id === defaultVoucherId);
    const effectiveDefaultVoucherId = hasValidDefaultVoucher ? defaultVoucherId : null;

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
                setDefaultVoucherId(null);
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

    async function handleDefaultsSubmit(e: React.FormEvent) {
        e.preventDefault();
        setIsDefaultsLoading(true);
        setDefaultsError(null);
        setDefaultsSuccess(false);

        const formData = new FormData();
        formData.append("defaultPomoDurationMinutes", defaultPomoDurationMinutes);
        formData.append("defaultFailureCost", defaultFailureCostEuros);
        formData.append("defaultVoucherId", effectiveDefaultVoucherId ?? "");
        formData.append("strictPomoEnabled", String(strictPomoEnabled));
        formData.append("deadlineFinalWarningEnabled", String(deadlineFinalWarningEnabled));

        const result = await updateUserDefaults(formData);

        if (result.error) {
            setDefaultsError(result.error);
        } else {
            setDefaultsSuccess(true);
        }

        setIsDefaultsLoading(false);
    }

    return (
        <div className="max-w-3xl mx-auto space-y-8 pb-20 mt-12 px-4 md:px-0">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-bold text-white">Settings</h1>
                    <p className="text-slate-400 mt-1">Manage your profile and task defaults</p>
                    <p className="text-xs text-slate-500 font-mono mt-2">
                        Signed in as <span className="text-slate-300">{profile.email}</span>
                    </p>
                </div>
                <HardRefreshButton />
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
                    <CardTitle className="text-white">Task Defaults</CardTitle>
                    <CardDescription className="text-slate-400">
                        Choose default values for new tasks and Pomodoro sessions
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleDefaultsSubmit} className="space-y-4">
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
                                Default Failure Cost (€)
                            </Label>
                            <Input
                                id="defaultFailureCost"
                                type="number"
                                min="0.01"
                                max="100"
                                step="0.01"
                                value={defaultFailureCostEuros}
                                onChange={(e) => setDefaultFailureCostEuros(e.target.value)}
                                className="bg-slate-800/40 border-slate-700 text-white"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="defaultVoucherId" className="text-slate-200">
                                Default Voucher
                            </Label>
                            <Select
                                value={effectiveDefaultVoucherId ?? NONE_VOUCHER_VALUE}
                                onValueChange={(value) =>
                                    setDefaultVoucherId(value === NONE_VOUCHER_VALUE ? null : value)
                                }
                            >
                                <SelectTrigger
                                    id="defaultVoucherId"
                                    className="bg-slate-800/40 border-slate-700 text-white w-full"
                                >
                                    <SelectValue placeholder="No default voucher" />
                                </SelectTrigger>
                                <SelectContent className="bg-slate-900 border-slate-800 text-white">
                                    <SelectItem value={NONE_VOUCHER_VALUE}>No default voucher</SelectItem>
                                    {friends.map((friend) => (
                                        <SelectItem key={friend.id} value={friend.id}>
                                            {friend.username} ({friend.email})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

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
                                    <Label htmlFor="deadlineFinalWarningEnabled" className="text-slate-200">
                                        Final deadline warning (5 minutes before deadline)
                                    </Label>
                                    <p className="text-xs text-slate-400">
                                        Sends a push notification 5 minutes before deadline. This does not affect the 1-hour warning.
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

                        {defaultsError && <p className="text-sm text-red-400">{defaultsError}</p>}
                        {defaultsSuccess && (
                            <p className="text-sm text-green-400">Defaults updated!</p>
                        )}

                        <Button
                            type="submit"
                            disabled={isDefaultsLoading}
                            className="bg-slate-100 text-slate-950 hover:bg-white font-semibold"
                        >
                            {isDefaultsLoading ? "Saving..." : "Save Defaults"}
                        </Button>
                    </form>
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
