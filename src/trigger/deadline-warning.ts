/**
 * Trigger: deadline-warning
 * Runs: Every minute (`* * * * *`).
 * Deprecated: operational deadline warning behavior has moved to `task-reminder-notify`.
 * This task remains as a no-op to avoid duplicate notifications during transition.
 */
import { schedules } from "@trigger.dev/sdk/v3";

export const deadlineWarning = schedules.task({
    id: "deadline-warning",
    cron: "* * * * *",
    run: async () => {
        console.log("deadline-warning is deprecated; use task-reminder-notify for deadline warnings.");
    },
});
