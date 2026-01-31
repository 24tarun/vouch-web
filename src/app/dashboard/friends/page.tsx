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

export default function FriendsPage() {
    const [friends, setFriends] = useState<Profile[]>([]);
    const [email, setEmail] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    useEffect(() => {
        loadFriends();
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

        const formData = new FormData();
        formData.append("email", email);

        const result = await addFriend(formData);

        if (result.error) {
            setError(result.error);
        } else {
            setSuccess("Friend added successfully!");
            setEmail("");
            loadFriends();
        }

        setIsLoading(false);
    }

    async function handleRemoveFriend(friendId: string) {
        setIsLoading(true);
        setError(null);

        const result = await removeFriend(friendId);

        if (result.error) {
            setError(result.error);
        } else {
            loadFriends();
        }

        setIsLoading(false);
    }

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-white">Friends</h1>
                <p className="text-slate-400 mt-1">
                    Add friends to assign them as vouchers for your tasks
                </p>
            </div>

            {/* Add Friend Form */}
            <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                    <CardTitle className="text-white">Add Friend</CardTitle>
                    <CardDescription className="text-slate-400">
                        Enter your friend&apos;s email address to add them
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleAddFriend} className="flex gap-3">
                        <div className="flex-1">
                            <Label htmlFor="email" className="sr-only">
                                Email
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="friend@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400"
                            />
                        </div>
                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                        >
                            {isLoading ? "Adding..." : "Add Friend"}
                        </Button>
                    </form>

                    {error && (
                        <p className="mt-3 text-sm text-red-400">{error}</p>
                    )}
                    {success && (
                        <p className="mt-3 text-sm text-green-400">{success}</p>
                    )}
                </CardContent>
            </Card>

            {/* Friends List */}
            <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                    <CardTitle className="text-white">Your Friends</CardTitle>
                    <CardDescription className="text-slate-400">
                        {friends.length} friend{friends.length !== 1 ? "s" : ""}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {friends.length === 0 ? (
                        <p className="text-slate-400 text-center py-8">
                            No friends added yet. Add a friend to start creating tasks!
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {friends.map((friend) => (
                                <div
                                    key={friend.id}
                                    className="flex items-center justify-between p-3 rounded-lg bg-slate-700/30"
                                >
                                    <div className="flex items-center gap-3">
                                        <Avatar className="h-10 w-10 border border-slate-600">
                                            <AvatarFallback className="bg-gradient-to-br from-purple-600 to-pink-600 text-white text-sm">
                                                {friend.username?.slice(0, 2).toUpperCase() || "??"}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div>
                                            <p className="text-white font-medium">{friend.username}</p>
                                            <p className="text-sm text-slate-400">{friend.email}</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRemoveFriend(friend.id)}
                                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
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
            <Card className="bg-slate-800/30 border-slate-700/50">
                <CardContent className="py-4">
                    <p className="text-sm text-slate-400 text-center">
                        💡 Friends can only be removed if they are not currently an active
                        voucher for any of your pending tasks.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
