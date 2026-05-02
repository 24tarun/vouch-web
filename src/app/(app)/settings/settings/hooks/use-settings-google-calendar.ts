import { useCallback } from "react";
import {
    disconnectGoogleCalendar,
    listGoogleCalendarsForSettings,
    setGoogleCalendarCalendar,
    setGoogleCalendarAppToGoogleEnabled,
    startGoogleCalendarConnect,
} from "@/actions/google-calendar";

interface CalendarOption {
    id: string;
    summary: string;
    primary?: boolean;
}

interface UseSettingsGoogleCalendarArgs {
    googleConnected: boolean;
    isGoogleActionLoading: boolean;
    googleCalendars: CalendarOption[];
    setGoogleConnected: (value: boolean) => void;
    setGoogleSyncAppToGoogleEnabled: (value: boolean) => void;
    setGoogleAccountEmail: (value: string | null) => void;
    setGoogleSelectedCalendarId: (value: string) => void;
    setGoogleSelectedCalendarSummary: (value: string | null) => void;
    setGoogleCalendars: (value: CalendarOption[]) => void;
    setGoogleLastError: (value: string | null) => void;
    setGoogleActionSuccess: (value: string | null) => void;
    setIsGoogleActionLoading: (value: boolean) => void;
}

export function useSettingsGoogleCalendar({
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
}: UseSettingsGoogleCalendarArgs) {
    const handleGoogleConnect = useCallback(async () => {
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
    }, [isGoogleActionLoading, setGoogleActionSuccess, setGoogleLastError, setIsGoogleActionLoading]);

    const handleGoogleDisconnect = useCallback(async () => {
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
            setGoogleAccountEmail(null);
            setGoogleSelectedCalendarId("");
            setGoogleSelectedCalendarSummary(null);
            setGoogleCalendars([]);
            setGoogleLastError(null);
            setGoogleActionSuccess("Google Calendar disconnected and forgotten.");
        } catch (error) {
            console.error(error);
            setGoogleLastError("Failed to disconnect and forget Google Calendar.");
        } finally {
            setIsGoogleActionLoading(false);
        }
    }, [
        isGoogleActionLoading,
        setGoogleActionSuccess,
        setGoogleAccountEmail,
        setGoogleCalendars,
        setGoogleConnected,
        setGoogleLastError,
        setGoogleSelectedCalendarId,
        setGoogleSelectedCalendarSummary,
        setGoogleSyncAppToGoogleEnabled,
        setIsGoogleActionLoading,
    ]);

    const handleGoogleConnectionToggle = useCallback(async (enabled: boolean) => {
        if (enabled) {
            if (googleConnected) return;
            await handleGoogleConnect();
            return;
        }

        if (!googleConnected) return;
        await handleGoogleDisconnect();
    }, [googleConnected, handleGoogleConnect, handleGoogleDisconnect]);

    const handleGoogleRefreshCalendars = useCallback(async () => {
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
    }, [isGoogleActionLoading, setGoogleActionSuccess, setGoogleCalendars, setGoogleLastError, setIsGoogleActionLoading]);

    const handleGoogleCalendarSelection = useCallback(async (nextCalendarId: string) => {
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
    }, [
        googleCalendars,
        isGoogleActionLoading,
        setGoogleActionSuccess,
        setGoogleLastError,
        setGoogleSelectedCalendarId,
        setGoogleSelectedCalendarSummary,
        setIsGoogleActionLoading,
    ]);

    const handleGoogleAppToGoogleToggle = useCallback(async (enabled: boolean) => {
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
    }, [
        isGoogleActionLoading,
        setGoogleActionSuccess,
        setGoogleLastError,
        setGoogleSyncAppToGoogleEnabled,
        setIsGoogleActionLoading,
    ]);

    return {
        handleGoogleConnect,
        handleGoogleConnectionToggle,
        handleGoogleDisconnect,
        handleGoogleRefreshCalendars,
        handleGoogleCalendarSelection,
        handleGoogleAppToGoogleToggle,
    };
}
