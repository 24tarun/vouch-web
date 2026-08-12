export type PomoOwnerSummary = {
  id?: string | null;
  platform?: string | null;
  client_name?: string | null;
  device_label?: string | null;
} | null;

export type PomoConflictSummary = {
  id: string;
  status: "ACTIVE" | "PAUSED";
  task?: { title?: string | null } | null;
  owner?: PomoOwnerSummary;
};

function browserName(userAgent: string): string | null {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/OPR\//.test(userAgent)) return "Opera";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Chrome\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return null;
}

function operatingSystem(userAgent: string): string | null {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS";
  if (/Android/.test(userAgent)) return "Android";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Linux/.test(userAgent)) return "Linux";
  return null;
}

export function describePomoOwner(owner: PomoOwnerSummary): string {
  const label = owner?.device_label?.trim();
  switch (owner?.platform) {
    case "macos":
      return label ? `Vouch Pomo Buddy on ${label}` : "Vouch Pomo Buddy for Mac";
    case "ios":
      return label || "the Vouch iOS app";
    case "android":
      return label || "the Vouch Android app";
    case "web": {
      if (!label) return "Vouch Web";
      const browser = browserName(label);
      const os = operatingSystem(label);
      if (browser && os) return `${browser} on ${os}`;
      return browser || os || "Vouch Web";
    }
    default:
      return label || "another Vouch client";
  }
}

export function describePomoConflict(conflict: PomoConflictSummary): string {
  const title = conflict.task?.title?.trim() || "another task";
  const state = conflict.status === "PAUSED" ? "paused" : "running";
  return `A Pomodoro for “${title}” is already ${state} on ${describePomoOwner(conflict.owner ?? null)}. End it there before starting another.`;
}
