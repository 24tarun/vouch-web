"use client";

import { useState } from "react";
import { updateUserDefaults, updateUsername } from "@/actions/auth";
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

export default function SettingsClient({ profile, friends }: SettingsClientProps) {
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
    const [isDefaultsLoading, setIsDefaultsLoading] = useState(false);
    const [defaultsError, setDefaultsError] = useState<string | null>(null);
    const [defaultsSuccess, setDefaultsSuccess] = useState(false);
    const hasValidDefaultVoucher =
        !!defaultVoucherId && friends.some((friend) => friend.id === defaultVoucherId);
    const effectiveDefaultVoucherId = hasValidDefaultVoucher ? defaultVoucherId : null;

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

            {/* Profile Settings */}
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

            {/* Account Info */}
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

            {/* Charity Placeholder */}
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
