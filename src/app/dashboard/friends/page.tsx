"use client";

import { useState, useEffect } from "react";
import { addFriend, removeFriend, getFriends } from "@/actions/friends";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Profile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

export default function FriendsPage() {
    const [friends, setFriends] = useState<Profile[]>([]);
    const [email, setEmail] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    useEffect(() => {
        let subscription: any;

        const setupRealtime = async () => {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();

            if (user) {
                loadFriends();

                subscription = supabase
                    .channel('friendships-changes')
                    .on(
                        'postgres_changes',
                        {
                            event: '*',
                            schema: 'public',
                            table: 'friendships',
                            filter: `user_id=eq.${user.id}`,
                        },
                        (payload) => {
                            loadFriends();
                        }
                    )
                    .subscribe();
            }
        };

        setupRealtime();

        return () => {
            if (subscription) {
                subscription.unsubscribe();
            }
        };
    }, []);

    async function loadFriends() {
        const friendsList = await getFriends();
        setFriends(friendsList);
    }

    async function handleAddFriend(e: React.FormEvent) {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            const formData = new FormData();
            formData.append("email", email);

            const result = await addFriend(formData);

            if (result.error) {
                setError(result.error);
            } else {
                setSuccess("Friend added successfully!");
                setEmail("");
                // loadFriends() is strictly not needed if Realtime works, but good for immediate feedback if Realtime is slow
                loadFriends();
            }
        } catch (err) {
            setError("An unexpected error occurred");
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }

    async function handleRemoveFriend(friendId: string) {
        setIsLoading(true);
        setError(null);

        try {
            const result = await removeFriend(friendId);

            if (result.error) {
                setError(result.error);
            } else {
                // loadFriends(); // Handled by Realtime theoretically, but good to keep
                loadFriends();
            }
        } catch (err) {
            setError("Failed to remove friend");
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="max-w-2xl mx-auto space-y-10">
            <div>
                <h1 className="text-3xl font-bold text-white tracking-tight">Network</h1>
                <p className="text-slate-500 mt-2 text-sm leading-relaxed">
                    Connect with friends to assign them as vouchers for your tasks.
                </p>
            </div>

            {/* Add Friend Form */}
            <Card className="bg-slate-900 border-slate-800 shadow-xl">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-white">Add to Network</CardTitle>
                    <CardDescription className="text-slate-500 text-xs font-mono uppercase tracking-wider">
                        Enter email address to connect
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleAddFriend} className="flex gap-4">
                        <div className="flex-1">
                            <Label htmlFor="email" className="sr-only">
                                Email
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="name@domain.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-700 h-12 focus:ring-0 focus:border-slate-600 transition-colors"
                            />
                        </div>
                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="bg-slate-200 hover:bg-white text-slate-900 font-bold px-6 h-12 rounded"
                        >
                            {isLoading ? "Adding..." : "Add"}
                        </Button>
                    </form>

                    {error && (
                        <p className="mt-4 text-xs font-medium text-red-400 bg-red-400/10 border border-red-400/20 p-2 rounded">{error}</p>
                    )}
                    {success && (
                        <p className="mt-4 text-xs font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 p-2 rounded">{success}</p>
                    )}
                </CardContent>
            </Card>

            {/* Friends List */}
            <Card className="bg-slate-900 border-slate-800 shadow-xl">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-white">Linked Accounts</CardTitle>
                    <CardDescription className="text-slate-500 text-xs font-mono uppercase tracking-wider">
                        {friends.length} active connection{friends.length !== 1 ? "s" : ""}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {friends.length === 0 ? (
                        <p className="text-slate-600 text-center py-12 text-sm italic">
                            No connections found. Build your network to start creating tasks.
                        </p>
                    ) : (
                        <div className="grid gap-4">
                            {friends.map((friend) => (
                                <div
                                    key={friend.id}
                                    className="flex items-center justify-between p-4 rounded bg-slate-950 border border-slate-800 hover:border-slate-700 transition-colors"
                                >
                                    <div className="flex items-center gap-4">
                                        <Avatar className="h-10 w-10 border border-slate-800">
                                            <AvatarFallback className="bg-slate-900 text-slate-400 text-xs font-mono">
                                                {friend.username?.slice(0, 2).toUpperCase() || "??"}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div>
                                            <p className="text-white font-bold text-sm tracking-tight">{friend.username}</p>
                                            <p className="text-xs text-slate-500 font-mono">{friend.email}</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRemoveFriend(friend.id)}
                                        className="text-slate-500 hover:text-red-400 hover:bg-red-400/10 text-xs font-mono uppercase tracking-widest"
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Info */}
            <div className="bg-slate-950 border border-slate-900 rounded-lg p-6">
                <p className="text-xs text-slate-600 text-center leading-relaxed font-mono uppercase tracking-widest">
                    Verification Rule: Friends can only be removed if they are not currently an active
                    voucher for any of your pending tasks.
                </p>
            </div>
        </div>
    );
}
