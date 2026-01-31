"use client";

import { useState } from "react";
import { updateUsername } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import type { Profile } from "@/lib/types";

interface SettingsClientProps {
    profile: Profile;
}

export default function SettingsClient({ profile }: SettingsClientProps) {
    const [username, setUsername] = useState(profile.username);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setSuccess(false);

        const formData = new FormData();
        formData.append("username", username);

        const result = await updateUsername(formData);

        if (result.error) {
            setError(result.error);
        } else {
            setSuccess(true);
        }

        setIsLoading(false);
    }

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-white">Settings</h1>
                <p className="text-slate-400 mt-1">Manage your account</p>
            </div>

            {/* Profile Settings */}
            <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                    <CardTitle className="text-white">Profile</CardTitle>
                    <CardDescription className="text-slate-400">
                        Update your username
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email" className="text-slate-200">
                                Email
                            </Label>
                            <Input
                                id="email"
                                value={profile.email}
                                disabled
                                className="bg-slate-700/30 border-slate-600 text-slate-400"
                            />
                        </div>

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
                                className="bg-slate-700/50 border-slate-600 text-white"
                            />
                            <p className="text-xs text-slate-500">
                                Your friends can find you by this username
                            </p>
                        </div>

                        {error && <p className="text-sm text-red-400">{error}</p>}
                        {success && (
                            <p className="text-sm text-green-400">Username updated!</p>
                        )}

                        <Button
                            type="submit"
                            disabled={isLoading || username === profile.username}
                            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                        >
                            {isLoading ? "Saving..." : "Save Changes"}
                        </Button>
                    </form>
                </CardContent>
            </Card>

            {/* Account Info */}
            <Card className="bg-slate-800/50 border-slate-700">
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
            <Card className="bg-slate-800/50 border-slate-700">
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
