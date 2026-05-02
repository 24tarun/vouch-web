import { useCallback } from "react";
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
    unblockRelationshipUser,
    withdrawOutgoingFriendRequest,
    type BlockedUserOption,
    type IncomingFriendRequest,
    type OutgoingFriendRequest,
    type SearchCandidate,
} from "@/actions/friends";
import type { FriendProfile, Profile } from "@/lib/types";

type RelationshipTarget = SearchCandidate | IncomingFriendRequest["sender"] | OutgoingFriendRequest["receiver"] | FriendProfile;

interface UseSettingsRelationshipsArgs {
    profile: Profile;
    defaultVoucherId: string | null;
    friendSearchQuery: string;
    setDefaultVoucherId: (value: string | null) => void;
    setFriends: (value: FriendProfile[] | ((prev: FriendProfile[]) => FriendProfile[])) => void;
    setRelationshipFriends: (value: Array<IncomingFriendRequest["sender"]>) => void;
    setIncomingRequests: (value: IncomingFriendRequest[]) => void;
    setOutgoingRequests: (value: OutgoingFriendRequest[]) => void;
    setRelationshipsLoading: (value: boolean) => void;
    setRelationshipsError: (value: string | null) => void;
    setRelationshipSuccess: (value: string | null) => void;
    setRelationshipInFlight: (value: Record<string, string | null> | ((prev: Record<string, string | null>) => Record<string, string | null>)) => void;
    setFriendSearchResults: (value: SearchCandidate[]) => void;
    setFriendSearchError: (value: string | null) => void;
    setBlockedUsers: (value: BlockedUserOption[]) => void;
    setBlockedUsersLoading: (value: boolean) => void;
    setBlockedUsersError: (value: string | null) => void;
    setUnblockingUserId: (value: string | null) => void;
}

export function useSettingsRelationships({
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
}: UseSettingsRelationshipsArgs) {
    const refreshFriendsList = useCallback(async () => {
        const updatedFriends = await getFriends();
        setFriends((updatedFriends as FriendProfile[]) || []);
    }, [setFriends]);

    const updateRelationshipInFlight = useCallback((key: string, action: string | null) => {
        setRelationshipInFlight((prev) => ({ ...prev, [key]: action }));
    }, [setRelationshipInFlight]);

    const refreshRelationshipsAndSearch = useCallback(async () => {
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
    }, [
        friendSearchQuery,
        refreshFriendsList,
        setBlockedUsers,
        setBlockedUsersError,
        setBlockedUsersLoading,
        setFriendSearchError,
        setFriendSearchResults,
        setIncomingRequests,
        setOutgoingRequests,
        setRelationshipFriends,
        setRelationshipsError,
        setRelationshipsLoading,
    ]);

    const handleSendFriendRequest = useCallback(async (candidate: SearchCandidate) => {
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
    }, [refreshRelationshipsAndSearch, setRelationshipSuccess, setRelationshipsError, updateRelationshipInFlight]);

    const handleAcceptFriendRequest = useCallback(async (request: IncomingFriendRequest) => {
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
    }, [refreshRelationshipsAndSearch, setRelationshipSuccess, setRelationshipsError, updateRelationshipInFlight]);

    const handleRejectFriendRequest = useCallback(async (request: IncomingFriendRequest) => {
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
    }, [refreshRelationshipsAndSearch, setRelationshipSuccess, setRelationshipsError, updateRelationshipInFlight]);

    const handleWithdrawFriendRequest = useCallback(async (request: OutgoingFriendRequest) => {
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
    }, [refreshRelationshipsAndSearch, setRelationshipSuccess, setRelationshipsError, updateRelationshipInFlight]);

    const handleRemoveFriend = useCallback(async (friend: IncomingFriendRequest["sender"]) => {
        const key = `friend:${friend.id}:remove`;
        updateRelationshipInFlight(key, "remove");
        setRelationshipSuccess(null);
        try {
            const result = await removeFriendById(friend.id);
            if (result.error) {
                setRelationshipsError(result.error);
                return;
            }
            if (defaultVoucherId === friend.id) setDefaultVoucherId(profile.id);
            setRelationshipSuccess(`Removed @${friend.username}.`);
            await refreshRelationshipsAndSearch();
        } finally {
            updateRelationshipInFlight(key, null);
        }
    }, [defaultVoucherId, profile.id, refreshRelationshipsAndSearch, setDefaultVoucherId, setRelationshipSuccess, setRelationshipsError, updateRelationshipInFlight]);

    const handleBlockRelationshipUser = useCallback(async (target: RelationshipTarget, sourceKey: string) => {
        updateRelationshipInFlight(sourceKey, "block");
        setRelationshipSuccess(null);
        try {
            const result = await blockRelationshipUser(target.id);
            if (result.error) {
                setRelationshipsError(result.error);
                return;
            }
            if (defaultVoucherId === target.id) setDefaultVoucherId(profile.id);
            setRelationshipSuccess(`Blocked @${target.username}.`);
            await refreshRelationshipsAndSearch();
        } finally {
            updateRelationshipInFlight(sourceKey, null);
        }
    }, [defaultVoucherId, profile.id, refreshRelationshipsAndSearch, setDefaultVoucherId, setRelationshipSuccess, setRelationshipsError, updateRelationshipInFlight]);

    const handleUnblockUser = useCallback(async (userId: string, username: string) => {
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
    }, [refreshRelationshipsAndSearch, setBlockedUsersError, setRelationshipSuccess, setUnblockingUserId]);

    return {
        refreshRelationshipsAndSearch,
        handleSendFriendRequest,
        handleAcceptFriendRequest,
        handleRejectFriendRequest,
        handleWithdrawFriendRequest,
        handleRemoveFriend,
        handleBlockRelationshipUser,
        handleUnblockUser,
    };
}
