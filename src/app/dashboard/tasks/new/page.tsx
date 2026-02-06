"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createTask } from "@/actions/tasks";
import { getFriends } from "@/actions/friends";
import { getProfile } from "@/actions/auth";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DEFAULT_FAILURE_COST_CENTS,
    DEFAULT_FAILURE_COST_EUROS,
} from "@/lib/constants";
import type { Profile } from "@/lib/types";

export default function NewTaskPage() {
    const router = useRouter();
    const [friends, setFriends] = useState<Profile[]>([]);
    const [selectedVoucherId, setSelectedVoucherId] = useState("");
    const [failureCost, setFailureCost] = useState(DEFAULT_FAILURE_COST_EUROS);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const effectiveSelectedVoucherId =
        selectedVoucherId && friends.some((friend) => friend.id === selectedVoucherId)
            ? selectedVoucherId
            : "";

    // Set default deadline to tomorrow at noon
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    const defaultDeadline = tomorrow.toISOString().slice(0, 16);

    useEffect(() => {
        async function loadData() {
            const [friendsList, profile] = await Promise.all([
                getFriends(),
                getProfile(),
            ]);
            const normalizedFriends = friendsList as Profile[];

            setFriends(normalizedFriends);

            const profileFailureCostCents = profile?.default_failure_cost_cents ?? DEFAULT_FAILURE_COST_CENTS;
            setFailureCost((profileFailureCostCents / 100).toFixed(2));

            const profileDefaultVoucher = profile?.default_voucher_id ?? null;
            const hasValidVoucher =
                !!profileDefaultVoucher &&
                normalizedFriends.some((friend) => friend.id === profileDefaultVoucher);
            setSelectedVoucherId(hasValidVoucher ? profileDefaultVoucher : "");
        }

        loadData();
    }, []);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        const formData = new FormData(e.currentTarget);
        if (!effectiveSelectedVoucherId) {
            setError("Please select a voucher.");
            setIsLoading(false);
            return;
        }

        formData.set("voucherId", effectiveSelectedVoucherId);
        formData.set("failureCost", failureCost);
        const result = await createTask(formData);

        if (result?.error) {
            setError(result.error);
            setIsLoading(false);
        }
        // Redirect handled by server action
    }

    return (
        <div className="max-w-2xl mx-auto">
            <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                    <CardTitle className="text-2xl text-white">Create New Task</CardTitle>
                    <CardDescription className="text-slate-400">
                        Set a commitment with financial consequences
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Title */}
                        <div className="space-y-2">
                            <Label htmlFor="title" className="text-slate-200">
                                Task Title *
                            </Label>
                            <Input
                                id="title"
                                name="title"
                                placeholder="e.g., Complete project proposal"
                                required
                                className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400"
                            />
                        </div>

                        {/* Description */}
                        <div className="space-y-2">
                            <Label htmlFor="description" className="text-slate-200">
                                Description (optional)
                            </Label>
                            <textarea
                                id="description"
                                name="description"
                                placeholder="Add more details about the task..."
                                rows={3}
                                className="w-full rounded-md bg-slate-700/50 border border-slate-600 text-white placeholder:text-slate-400 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                            />
                        </div>

                        {/* Deadline - Google Calendar style */}
                        <div className="space-y-2">
                            <Label htmlFor="deadline" className="text-slate-200">
                                Deadline *
                            </Label>
                            <Input
                                id="deadline"
                                name="deadline"
                                type="datetime-local"
                                defaultValue={defaultDeadline}
                                required
                                className="bg-slate-700/50 border-slate-600 text-white"
                            />
                            <p className="text-xs text-slate-500">
                                Once active, deadlines are immutable
                            </p>
                        </div>

                        {/* Failure Cost */}
                        <div className="space-y-2">
                            <Label htmlFor="failureCost" className="text-slate-200">
                                Failure Cost (€) *
                            </Label>
                            <Input
                                id="failureCost"
                                name="failureCost"
                                type="number"
                                min="0.01"
                                max="100"
                                step="0.01"
                                value={failureCost}
                                onChange={(e) => setFailureCost(e.target.value)}
                                placeholder={DEFAULT_FAILURE_COST_EUROS}
                                required
                                className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400"
                            />
                            <p className="text-xs text-slate-500">
                                €0.01 - €100.00. Donated to charity if you fail.
                            </p>
                        </div>

                        {/* Voucher Selection */}
                        <div className="space-y-2">
                            <Label htmlFor="voucherId" className="text-slate-200">
                                Select Voucher *
                            </Label>
                            {friends.length === 0 ? (
                                <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 text-sm">
                                    You need to add friends before creating a task.{" "}
                                    <a
                                        href="/dashboard/friends"
                                        className="underline hover:text-yellow-200"
                                    >
                                        Add friends →
                                    </a>
                                </div>
                            ) : (
                                <Select
                                    name="voucherId"
                                    required
                                    value={effectiveSelectedVoucherId}
                                    onValueChange={setSelectedVoucherId}
                                >
                                    <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                                        <SelectValue placeholder="Choose a friend to vouch" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-800 border-slate-700">
                                        {friends.map((friend) => (
                                            <SelectItem
                                                key={friend.id}
                                                value={friend.id}
                                                className="text-white hover:bg-slate-700"
                                            >
                                                {friend.username} ({friend.email})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                            <p className="text-xs text-slate-500">
                                Your voucher will verify task completion
                            </p>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="p-3 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 text-sm">
                                {error}
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-3 pt-4">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => router.back()}
                                className="border-slate-600 text-slate-300 hover:bg-slate-700"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={isLoading || friends.length === 0}
                                className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                            >
                                {isLoading ? "Creating..." : "🚀 Create Task"}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
