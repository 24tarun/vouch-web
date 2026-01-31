import { schedules } from "@trigger.dev/sdk/v3";
import { createAdminClient } from "@/lib/supabase/admin";
import { resend } from "@/lib/resend";

export const deadlineWarning = schedules.task({
    id: "deadline-warning",
    cron: "*/15 * * * *", // Run every 15 minutes
    run: async (payload, { ctx }) => {
        const supabase = createAdminClient();
        const now = new Date();
        const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
        const nowIso = now.toISOString();

        // Find active tasks with deadline between now and 1 hour
        const { data: tasks, error } = await supabase
            .from("tasks")
            .select(`
        *,
        user:profiles!tasks_user_id_fkey(email, username)
      `)
            .eq("status", "ACTIVE")
            .gt("deadline", nowIso)
            .lt("deadline", oneHourFromNow) as any;

        if (error) {
            console.error("Error fetching tasks:", error);
            return;
        }

        console.log(`Found ${tasks.length} tasks near deadline`);

        for (const task of tasks) {
            // Check if we already sent a warning
            const { data: events } = await supabase
                .from("task_events")
                .select("id")
                .eq("task_id", task.id)
                .eq("event_type", "DEADLINE_WARNING")
                .limit(1);

            if (events && events.length > 0) {
                // Already sent
                continue;
            }

            // Send email
            if (resend && task.user?.email) {
                try {
                    await resend.emails.send({
                        from: "Vouch <noreply@remails.tarunh.com>",
                        to: task.user.email,
                        subject: `⏰ 1 Hour Left: ${task.title}`,
                        html: `
              <h1>Task Deadline Approaching</h1>
              <p>Hi ${task.user.username},</p>
              <p>You have less than 1 hour to verify completion for: <strong>${task.title}</strong>.</p>
              <p>Deadline: ${new Date(task.deadline).toLocaleString()}</p>
              <p>Failure Cost: €${(task.failure_cost_cents / 100).toFixed(2)}</p>
              <br/>
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/tasks/${task.id}">View Task</a>
            `,
                    });
                    console.log(`Sent warning email to ${task.user.email}`);
                } catch (emailError) {
                    console.error(`Failed to send email for task ${task.id}`, emailError);
                }
            }

            // Log event
            await supabase.from("task_events").insert({
                task_id: task.id,
                event_type: "DEADLINE_WARNING",
                actor_id: null, // System event
                from_status: "ACTIVE",
                to_status: "ACTIVE",
                metadata: { deadline: task.deadline },
            } as any);
        }
    },
});
