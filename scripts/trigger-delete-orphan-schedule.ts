/**
 * One-off script: list Trigger.dev schedules and delete any matching an orphan task id
 * (e.g. a schedule whose code/file was already removed).
 *
 * Usage:
 *   npx tsx scripts/trigger-delete-orphan-schedule.ts [task-id]
 *
 * Example (delete the old google-tasks-sync-sweeper schedule):
 *   npx tsx scripts/trigger-delete-orphan-schedule.ts google-tasks-sync-sweeper
 *
 * Requires TRIGGER_SECRET_KEY in the environment (from Trigger.dev dashboard → API Keys).
 */

const ORPHAN_TASK_ID = process.argv[2] ?? "google-tasks-sync-sweeper";
const BASE = "https://api.trigger.dev";

async function main() {
  const secretKey = process.env.TRIGGER_SECRET_KEY;
  if (!secretKey?.startsWith("tr_")) {
    console.error("Set TRIGGER_SECRET_KEY (starts with tr_dev_ or tr_prod_) and run again.");
    process.exit(1);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  };

  // List schedules (paginate if needed)
  const schedules: { id: string; task: string; type: string }[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await fetch(`${BASE}/api/v1/schedules?page=${page}&perPage=50`, { headers });
    if (!res.ok) {
      console.error("List schedules failed:", res.status, await res.text());
      process.exit(1);
    }
    const data = await res.json();
    schedules.push(...(data.data ?? []));
    totalPages = data.pagination?.totalPages ?? 1;
    page++;
  } while (page <= totalPages);

  const matching = schedules.filter((s) => s.task === ORPHAN_TASK_ID);
  if (matching.length === 0) {
    console.log(`No schedules found for task id "${ORPHAN_TASK_ID}".`);
    console.log("Current schedules:", schedules.map((s) => `${s.task} (${s.id}, ${s.type})`).join("\n  "));
    return;
  }

  for (const s of matching) {
    const delRes = await fetch(`${BASE}/api/v1/schedules/${s.id}`, {
      method: "DELETE",
      headers,
    });
    if (delRes.ok) {
      console.log(`Deleted schedule ${s.id} (task: ${s.task}, type: ${s.type}).`);
    } else {
      const body = await delRes.text();
      console.warn(`Could not delete ${s.id}: ${delRes.status} ${body}`);
      console.warn("  (Delete may only be allowed for IMPERATIVE schedules in the dashboard.)");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
