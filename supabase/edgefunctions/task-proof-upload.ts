import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  CAPTURE_UPLOAD_WINDOW_MS,
  COMPLETION_EDIT_LOCKED_ERROR,
  canMarkProofUploadFailed,
  isCaptureStartWithinLicense,
  isCompletionEditingLocked,
  wasProofStagedBeforeCompletionLock,
} from './task-proof-deadline.ts';

const TASK_PROOFS_BUCKET = 'task-proofs';
const PROOF_TIMESTAMP_PLACEHOLDER = '??:?? ??/??/??';
const MAX_TASK_PROOF_VIDEO_DURATION_MS = 15_000;
const MAX_TASK_PROOF_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TASK_PROOF_VIDEO_BYTES = 30 * 1024 * 1024;
// Ordinary mobile latency should never cost a user a task they finished on
// time, so the online begin-capture call is forgiven a wide transport window.
const CAPTURE_ATTESTATION_TRANSPORT_GRACE_MS = 60_000;
const CAPTURE_ATTESTATION_MAX_CLOCK_SKEW_MS = 30_000;
const CAPTURE_ATTESTATION_TTL_MS = 10 * 60 * 1000;

// A capture license is fetched while the device still has connectivity and lets
// it start a qualifying capture later with no network at all. The license
// carries server-signed bounds; the exact instant inside them is the device's
// claim. Its expiry is additionally clamped to the task's own deadline, so a
// license can never authorize a capture the deadline would have refused.
const CAPTURE_LICENSE_TTL_MS = 2 * 60 * 60 * 1000;

const ALLOWED_PROOF_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

const ATTACHABLE_PROOF_STATUSES = new Set([
  'ACTIVE',
  'POSTPONED',
  'MARKED_COMPLETE',
  'AWAITING_VOUCHER',
  'AWAITING_AI',
  'AWAITING_USER',
  'ESCALATED',
  'AWAITING_RECTIFICATION',
]);
const CAPTURE_DEADLINE_STATUSES = new Set([
  'ACTIVE',
  'POSTPONED',
  'MARKED_COMPLETE',
  'AWAITING_VOUCHER',
  'AWAITING_AI',
]);

const FINAL_TASK_STATUSES = new Set([
  'ACCEPTED',
  'AUTO_ACCEPTED',
  'AI_ACCEPTED',
  'DENIED',
  'MISSED',
  'SURRENDERED',
  'RECTIFIED',
  'SETTLED',
  'DELETED',
]);
const PROOF_TIMESTAMP_REGEX = /^(?:\d{2}:\d{2} \d{2}\/\d{2}\/\d{2}|\?\?:\?\? \?\?\/\?\?\/\?\?)$/;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type MediaKind = 'image' | 'video';

function maxProofBytes(mediaKind: MediaKind): number {
  return mediaKind === 'video' ? MAX_TASK_PROOF_VIDEO_BYTES : MAX_TASK_PROOF_IMAGE_BYTES;
}

function proofSizeLabel(mediaKind: MediaKind): string {
  return mediaKind === 'video' ? '30 MB' : '4 MB';
}

interface ProofIntent {
  mediaKind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number | null;
  overlayTimestampText?: string | null;
  proofOrigin?: 'CAMERA' | 'LIBRARY' | 'UNKNOWN';
  proofTimestampAt?: string | null;
  proofTimestampSource?:
    | 'CAMERA_CAPTURE'
    | 'EXIF'
    | 'EMBEDDED_METADATA'
    | 'FILE_CREATION'
    | 'FILE_MODIFICATION'
    | 'ATTACHED'
    | 'UNKNOWN';
  proofTimezone?: string | null;
  captureAttestation?: string | null;
  captureLicense?: string | null;
}

interface ProofMeta extends ProofIntent {
  bucket: string;
  objectPath: string;
}

interface FinalizeProofAtomicResult {
  success: boolean;
  error: string | null;
}

interface AiQuotaReservationResult {
  allowed: boolean;
  error_code: string | null;
  account_tier: 'free' | 'paid';
  used: number;
  pending: number;
  monthly_limit: number | null;
  remaining: number | null;
  resets_at: string;
  reservation_created: boolean;
}

interface InitRequestBody {
  action: 'init';
  taskId: string;
  proofIntent: ProofIntent;
}

interface BeginCaptureRequestBody {
  action: 'begin-capture';
  taskId: string;
  mediaKind: MediaKind;
  startedAt: string;
}

interface IssueCaptureLicenseRequestBody {
  action: 'issue-capture-license';
  taskId: string;
}

interface FinalizeRequestBody {
  action: 'finalize';
  taskId: string;
  proofMeta: ProofMeta;
}

interface FailRequestBody {
  action: 'fail';
  taskId: string;
  proofMeta?: {
    bucket?: string;
    objectPath?: string;
  };
}

interface PurgeFinalRequestBody {
  action: 'purge-final';
  taskId: string;
}

interface RemoveCurrentRequestBody {
  action: 'remove-current';
  taskId: string;
}

interface QueueAiEvalRequestBody {
  action: 'queue-ai-eval';
  taskId: string;
}

interface CompleteTaskCommandRequestBody {
  action: 'complete-task-command';
  taskId: string;
  clientActionAt: string;
  actorUserClientInstanceId?: string | null;
}

interface SubmitAiAppealCommandRequestBody {
  action: 'submit-ai-appeal-command';
  taskId: string;
  actorUserClientInstanceId?: string | null;
}

interface QueueAiRectificationEvalRequestBody {
  action: 'queue-rectification-ai-eval';
  taskId: string;
  requestId: string;
}

interface QueueRectificationNotificationRequestBody {
  action: 'queue-rectification-notification';
  taskId: string;
  requestId?: string;
  kind: 'REQUESTED' | 'UPDATED' | 'CANCELLED' | 'PROOF_REQUESTED' | 'PROOF_UPLOADED' | 'ESCALATED' | 'APPROVED' | 'DECLINED' | 'DIRECT_APPROVED';
}

type RequestBody =
  | BeginCaptureRequestBody
  | IssueCaptureLicenseRequestBody
  | InitRequestBody
  | FinalizeRequestBody
  | FailRequestBody
  | PurgeFinalRequestBody
  | RemoveCurrentRequestBody
  | QueueAiEvalRequestBody
  | CompleteTaskCommandRequestBody
  | SubmitAiAppealCommandRequestBody
  | QueueAiRectificationEvalRequestBody
  | QueueRectificationNotificationRequestBody;

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

interface CaptureAttestationPayload {
  version: 1;
  taskId: string;
  ownerId: string;
  mediaKind: MediaKind;
  startedAt: string;
  expiresAt: string;
}

/**
 * Server-signed permission to start a capture offline.
 *
 * Issued while the device is online, then presented at upload time alongside
 * the capture start the device recorded locally. The signature makes the
 * *window* trustworthy — a capture cannot be claimed before the license was
 * issued or after it expired — while the precise instant within that window is
 * the device's word. `notAfter` is clamped to the task deadline at issue time,
 * so a valid license can never smuggle a capture past the deadline.
 */
interface CaptureLicensePayload {
  version: 1;
  kind: 'capture-license';
  taskId: string;
  ownerId: string;
  notBefore: string;
  notAfter: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmacSha256(value: string, secret: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

async function signToken(payload: unknown, secret: string): Promise<string> {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = base64UrlEncode(await hmacSha256(encodedPayload, secret));
  return `${encodedPayload}.${signature}`;
}

async function verifyToken<T>(token: string, secret: string): Promise<T | null> {
  try {
    const [encodedPayload, suppliedSignature, extra] = token.split('.');
    if (!encodedPayload || !suppliedSignature || extra) return null;
    const expectedSignature = await hmacSha256(encodedPayload, secret);
    const suppliedBytes = base64UrlDecode(suppliedSignature);
    if (expectedSignature.length !== suppliedBytes.length) return null;
    let mismatch = 0;
    for (let index = 0; index < expectedSignature.length; index += 1) {
      mismatch |= expectedSignature[index] ^ suppliedBytes[index];
    }
    if (mismatch !== 0) return null;
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as T;
  } catch {
    return null;
  }
}

async function signCaptureAttestation(payload: CaptureAttestationPayload, secret: string): Promise<string> {
  return signToken(payload, secret);
}

async function signCaptureLicense(payload: CaptureLicensePayload, secret: string): Promise<string> {
  return signToken(payload, secret);
}

async function verifyCaptureAttestation(
  token: string,
  secret: string,
): Promise<CaptureAttestationPayload | null> {
  try {
    const payload = await verifyToken<CaptureAttestationPayload>(token, secret);
    if (!payload) return null;
    if (payload.version !== 1 || new Date(payload.expiresAt).getTime() <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Validates an offline capture claim against its license.
 *
 * Returns the accepted capture instant, or null when the license is forged,
 * for another task or user, or the claimed capture falls outside the window
 * the license authorized.
 */
async function verifyLicensedCaptureStart(input: {
  token: string;
  secret: string;
  taskId: string;
  ownerId: string;
  claimedStartedAtMs: number;
}): Promise<string | null> {
  const payload = await verifyToken<CaptureLicensePayload>(input.token, input.secret);
  if (!payload) return null;
  if (payload.version !== 1 || payload.kind !== 'capture-license') return null;
  if (payload.taskId !== input.taskId || payload.ownerId !== input.ownerId) return null;

  if (!isCaptureStartWithinLicense(payload, input.claimedStartedAtMs)) return null;

  return new Date(input.claimedStartedAtMs).toISOString();
}

function normalizeProofTimestampText(value: unknown): string {
  if (typeof value !== 'string') return PROOF_TIMESTAMP_PLACEHOLDER;
  const trimmed = value.trim();
  return PROOF_TIMESTAMP_REGEX.test(trimmed) ? trimmed : PROOF_TIMESTAMP_PLACEHOLDER;
}

const PROOF_ORIGINS = new Set(['CAMERA', 'LIBRARY', 'UNKNOWN']);
const PROOF_TIMESTAMP_SOURCES = new Set([
  'CAMERA_CAPTURE',
  'EXIF',
  'EMBEDDED_METADATA',
  'FILE_CREATION',
  'FILE_MODIFICATION',
  'ATTACHED',
  'UNKNOWN',
]);

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function formatProofTimestamp(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return `${map.hour}:${map.minute} ${map.day}/${map.month}/${map.year}`;
}

function normalizeProofTimestampMetadata(candidate: Record<string, unknown>, overlayTimestampText: string): {
  value?: {
    proofOrigin: 'CAMERA' | 'LIBRARY' | 'UNKNOWN';
    proofTimestampAt: string | null;
    proofTimestampSource: ProofIntent['proofTimestampSource'];
    proofTimezone: string | null;
  };
  error?: string;
} {
  const rawOrigin = typeof candidate.proofOrigin === 'string' ? candidate.proofOrigin.trim().toUpperCase() : 'UNKNOWN';
  const rawSource = typeof candidate.proofTimestampSource === 'string'
    ? candidate.proofTimestampSource.trim().toUpperCase()
    : 'UNKNOWN';
  const rawTimestamp = typeof candidate.proofTimestampAt === 'string' ? candidate.proofTimestampAt.trim() : '';
  const rawTimezone = typeof candidate.proofTimezone === 'string' ? candidate.proofTimezone.trim() : '';

  if (!PROOF_ORIGINS.has(rawOrigin) || !PROOF_TIMESTAMP_SOURCES.has(rawSource)) {
    return { error: 'Invalid proof timestamp metadata.' };
  }

  if (rawSource === 'UNKNOWN') {
    if (rawTimestamp || rawTimezone) return { error: 'Incomplete proof timestamp metadata.' };
    return {
      value: {
        proofOrigin: 'UNKNOWN',
        proofTimestampAt: null,
        proofTimestampSource: 'UNKNOWN',
        proofTimezone: null,
      },
    };
  }

  const timestampDate = new Date(rawTimestamp);
  if (!rawTimestamp || Number.isNaN(timestampDate.getTime()) || !rawTimezone || !isValidTimeZone(rawTimezone)) {
    return { error: 'Invalid proof timestamp metadata.' };
  }
  if (rawSource === 'CAMERA_CAPTURE' && rawOrigin !== 'CAMERA') {
    return { error: 'Camera proof timestamp metadata is inconsistent.' };
  }
  if (overlayTimestampText !== formatProofTimestamp(timestampDate, rawTimezone)) {
    return { error: 'Proof timestamp does not match its visible overlay.' };
  }

  return {
    value: {
      proofOrigin: rawOrigin as 'CAMERA' | 'LIBRARY' | 'UNKNOWN',
      proofTimestampAt: timestampDate.toISOString(),
      proofTimestampSource: rawSource as ProofIntent['proofTimestampSource'],
      proofTimezone: rawTimezone,
    },
  };
}

function inferExtensionFromMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('heic')) return 'heic';
  if (normalized.includes('heif')) return 'heif';
  if (normalized.includes('mp4')) return 'mp4';
  if (normalized.includes('quicktime')) return 'mov';
  if (normalized.includes('webm')) return 'webm';
  return 'bin';
}

function normalizeExt(value: string): string {
  const ext = value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return ext ? ext.slice(0, 12) : 'bin';
}

function buildTaskProofObjectPath(ownerId: string, taskId: string, mimeType: string): string {
  const ext = normalizeExt(inferExtensionFromMime(mimeType));
  return `${ownerId}/${taskId}/${crypto.randomUUID()}.${ext}`;
}

function normalizeProofIntent(raw: unknown): { value?: ProofIntent; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Invalid proof payload.' };

  const candidate = raw as Record<string, unknown>;
  const mediaKind = candidate.mediaKind === 'video' ? 'video' : candidate.mediaKind === 'image' ? 'image' : null;
  const mimeType = typeof candidate.mimeType === 'string' ? candidate.mimeType.trim().toLowerCase() : '';
  const sizeBytes = Number(candidate.sizeBytes);
  const durationMsRaw = candidate.durationMs == null ? null : Number(candidate.durationMs);
  const overlayTimestampText = normalizeProofTimestampText(candidate.overlayTimestampText);
  const captureLicense = typeof candidate.captureLicense === 'string'
    ? candidate.captureLicense.trim()
    : '';
  const captureAttestation = typeof candidate.captureAttestation === 'string'
    ? candidate.captureAttestation.trim()
    : null;
  const timestampMetadata = normalizeProofTimestampMetadata(candidate, overlayTimestampText);

  if (timestampMetadata.error || !timestampMetadata.value) {
    return { error: timestampMetadata.error || 'Invalid proof timestamp metadata.' };
  }

  if (!mediaKind || !mimeType || !ALLOWED_PROOF_MIME_TYPES.has(mimeType)) {
    return { error: 'Please use JPG, PNG, WEBP, HEIC, MP4, MOV, or WEBM.' };
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { error: 'Selected media size is invalid.' };
  }

  if (sizeBytes > maxProofBytes(mediaKind)) {
    return { error: `${mediaKind === 'video' ? 'Video' : 'Image'} proof must be under ${proofSizeLabel(mediaKind)}.` };
  }

  if (mediaKind === 'video') {
    if (!Number.isFinite(durationMsRaw) || !durationMsRaw || durationMsRaw <= 0) {
      return { error: 'Could not read video duration. Try another clip.' };
    }

    if (durationMsRaw > MAX_TASK_PROOF_VIDEO_DURATION_MS) {
      return { error: 'Video proof must be 15 seconds or less.' };
    }
  }

  return {
    value: {
      mediaKind,
      mimeType,
      sizeBytes: Math.round(sizeBytes),
      durationMs: mediaKind === 'video' ? Math.round(Number(durationMsRaw)) : null,
      overlayTimestampText,
      captureAttestation: captureAttestation || null,
      captureLicense: captureLicense || null,
      ...timestampMetadata.value,
    },
  };
}

function normalizeProofMeta(raw: unknown): { value?: ProofMeta; error?: string } {
  const normalized = normalizeProofIntent(raw);
  if (normalized.error || !normalized.value) return { error: normalized.error || 'Invalid proof payload.' };

  const candidate = raw as Record<string, unknown>;
  const bucket = typeof candidate.bucket === 'string' ? candidate.bucket.trim() : '';
  const objectPath = typeof candidate.objectPath === 'string' ? candidate.objectPath.trim() : '';

  if (!bucket || !objectPath) {
    return { error: 'Proof upload target mismatch.' };
  }

  if (bucket !== TASK_PROOFS_BUCKET) {
    return { error: 'Unsupported proof bucket.' };
  }

  return {
    value: {
      ...normalized.value,
      bucket,
      objectPath,
    },
  };
}

function getSupabaseEnv() {
  const url = Deno.env.get('PROJECT_URL')
    || Deno.env.get('URL')
    || Deno.env.get('SUPABASE_URL')
    || Deno.env.get('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = Deno.env.get('PUBLISHABLE_KEY')
    || Deno.env.get('ANON_KEY')
    || Deno.env.get('SUPABASE_ANON_KEY')
    || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
    || Deno.env.get('SUPABASE_PUBLISHABLE_DEFAULT_KEY')
    || Deno.env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    || Deno.env.get('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY');
  const serviceRoleKey = Deno.env.get('SECRET_KEY')
    || Deno.env.get('SERVICE_ROLE_KEY')
    || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    || Deno.env.get('SUPABASE_SECRET_KEY');

  if (!url || !anonKey || !serviceRoleKey) return null;
  return { url, anonKey, serviceRoleKey };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json(405, { success: false, error: 'Method not allowed.' });
  }

  const env = getSupabaseEnv();
  if (!env) {
    return json(500, {
      success: false,
      error: 'Missing function configuration. Set URL/PROJECT_URL plus PUBLISHABLE_KEY/ANON_KEY and SECRET_KEY/SERVICE_ROLE_KEY.',
    });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return json(401, { success: false, error: 'Missing authorization header.' });
  }

  const userClient = createClient(env.url, env.anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const adminClient = createClient(env.url, env.serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return json(401, { success: false, error: 'Please sign in again and retry.' });
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: 'Invalid request body.' });
  }

  if (!body || typeof body !== 'object' || typeof (body as { action?: unknown }).action !== 'string') {
    return json(400, { success: false, error: 'Invalid proof action.' });
  }

  const action = (body as { action: string }).action;
  const taskId = typeof (body as { taskId?: unknown }).taskId === 'string'
    ? (body as { taskId: string }).taskId.trim()
    : '';

  if (!taskId) {
    return json(400, { success: false, error: 'Task not found.' });
  }

  const { data: task, error: taskError } = await adminClient
    .from('tasks')
    .select('id, user_id, voucher_id, status, deadline')
    .eq('id', taskId)
    .single();

  if (taskError || !task) {
    return json(404, { success: false, error: 'Task not found.' });
  }

  if ((task as { user_id: string }).user_id !== user.id) {
    const isVoucher = (task as { voucher_id: string }).voucher_id === user.id;
    if (!(action === 'purge-final' && isVoucher) && action !== 'queue-rectification-notification') {
      return json(403, { success: false, error: 'You can only upload proof for your own tasks.' });
    }
  }

  if (
    (action === 'begin-capture' || action === 'issue-capture-license' || action === 'init' || action === 'finalize')
    && !ATTACHABLE_PROOF_STATUSES.has((task as { status: string }).status)
  ) {
    return json(400, { success: false, error: 'Proof can only be attached to active or awaiting tasks.' });
  }

  const taskStatus = (task as { status: string }).status;
  const taskDeadline = (task as { deadline?: string | null }).deadline;
  if (
    action === 'remove-current'
    && taskStatus !== 'AWAITING_RECTIFICATION'
    && isCompletionEditingLocked(taskStatus, taskDeadline)
  ) {
    return json(409, { success: false, error: COMPLETION_EDIT_LOCKED_ERROR });
  }

  let taskCommandResult: Record<string, unknown> | null = null;
  if (action === 'complete-task-command') {
    const commandBody = body as CompleteTaskCommandRequestBody;
    const { data: commandData, error: commandError } = await userClient.rpc('complete_task_v2', {
      p_task_id: taskId,
      p_client_action_at: commandBody.clientActionAt,
      p_actor_user_client_instance_id: commandBody.actorUserClientInstanceId ?? null,
    });
    if (commandError) return json(400, { success: false, code: 'QUEUE_FAILED', error: commandError.message });
    taskCommandResult = commandData as Record<string, unknown>;
    if (!taskCommandResult?.success) {
      return json(409, {
        ...taskCommandResult,
        error: String(taskCommandResult?.message ?? 'Task could not be completed.'),
      });
    }
    if (taskCommandResult.toStatus !== 'AWAITING_AI') return json(200, taskCommandResult);
    (task as { status: string }).status = 'AWAITING_AI';
  }

  if (action === 'submit-ai-appeal-command') {
    const commandBody = body as SubmitAiAppealCommandRequestBody;
    const { data: commandData, error: commandError } = await userClient.rpc('submit_ai_appeal_v2', {
      p_task_id: taskId,
      p_actor_user_client_instance_id: commandBody.actorUserClientInstanceId ?? null,
    });
    if (commandError) return json(400, { success: false, code: 'QUEUE_FAILED', error: commandError.message });
    taskCommandResult = commandData as Record<string, unknown>;
    if (!taskCommandResult?.success) {
      return json(409, {
        ...taskCommandResult,
        error: String(taskCommandResult?.message ?? 'AI appeal could not be submitted.'),
      });
    }
    (task as { status: string }).status = 'AWAITING_AI';
  }

  // Fetched while the device still has connectivity so a capture can be started
  // later with no network at all. Cheap and idempotent — the client refreshes it
  // opportunistically for tasks whose deadline is approaching.
  if (action === 'issue-capture-license') {
    const issuedAtMs = Date.now();
    let notAfterMs = issuedAtMs + CAPTURE_LICENSE_TTL_MS;

    if (CAPTURE_DEADLINE_STATUSES.has(taskStatus)) {
      const deadlineMs = taskDeadline ? new Date(taskDeadline).getTime() : NaN;
      const cutoffMs = deadlineMs + 60_000;
      if (!Number.isFinite(deadlineMs) || issuedAtMs >= cutoffMs) {
        return json(409, { success: false, error: COMPLETION_EDIT_LOCKED_ERROR });
      }
      // Clamp to the deadline so a valid license can never authorize a capture
      // the deadline itself would have refused.
      notAfterMs = Math.min(notAfterMs, cutoffMs - 1);
    }

    return json(200, {
      success: true,
      captureLicense: await signCaptureLicense({
        version: 1,
        kind: 'capture-license',
        taskId,
        ownerId: user.id,
        notBefore: new Date(issuedAtMs).toISOString(),
        notAfter: new Date(notAfterMs).toISOString(),
      }, env.serviceRoleKey),
      expiresAt: new Date(notAfterMs).toISOString(),
    });
  }

  if (action === 'begin-capture') {
    const candidate = body as BeginCaptureRequestBody;
    const mediaKind = candidate.mediaKind === 'image' || candidate.mediaKind === 'video'
      ? candidate.mediaKind
      : null;
    const startedAt = new Date(candidate.startedAt);
    const startedAtMs = startedAt.getTime();
    const receivedAtMs = Date.now();
    if (!mediaKind || !Number.isFinite(startedAtMs)) {
      return json(400, { success: false, error: 'Could not verify when proof capture started.' });
    }
    if (Math.abs(receivedAtMs - startedAtMs) > CAPTURE_ATTESTATION_MAX_CLOCK_SKEW_MS) {
      return json(400, { success: false, error: 'Your device clock could not be verified. Check Date & Time settings and retry.' });
    }

    if (CAPTURE_DEADLINE_STATUSES.has(taskStatus)) {
      const deadlineMs = taskDeadline ? new Date(taskDeadline).getTime() : NaN;
      const cutoffMs = deadlineMs + 60_000;
      if (
        !Number.isFinite(deadlineMs)
        || startedAtMs >= cutoffMs
        || receivedAtMs >= cutoffMs + CAPTURE_ATTESTATION_TRANSPORT_GRACE_MS
      ) {
        return json(409, { success: false, error: COMPLETION_EDIT_LOCKED_ERROR });
      }
    }

    const payload: CaptureAttestationPayload = {
      version: 1,
      taskId,
      ownerId: user.id,
      mediaKind,
      startedAt: startedAt.toISOString(),
      expiresAt: new Date(receivedAtMs + CAPTURE_ATTESTATION_TTL_MS).toISOString(),
    };
    return json(200, {
      success: true,
      captureAttestation: await signCaptureAttestation(payload, env.serviceRoleKey),
    });
  }

  if (action === 'init') {
    const parsed = normalizeProofIntent((body as InitRequestBody).proofIntent);
    if (parsed.error || !parsed.value) {
      return json(400, { success: false, error: parsed.error || 'Invalid proof payload.' });
    }

    const proofIntent = parsed.value;
    let deadlineAttestedAt: string | null = null;
    if (proofIntent.captureAttestation) {
      const attestation = await verifyCaptureAttestation(proofIntent.captureAttestation, env.serviceRoleKey);
      const proofTimestampMs = proofIntent.proofTimestampAt
        ? new Date(proofIntent.proofTimestampAt).getTime()
        : NaN;
      const attestedTimestampMs = attestation ? new Date(attestation.startedAt).getTime() : NaN;
      if (
        !attestation
        || attestation.taskId !== taskId
        || attestation.ownerId !== user.id
        || attestation.mediaKind !== proofIntent.mediaKind
        || proofIntent.proofOrigin !== 'CAMERA'
        || proofIntent.proofTimestampSource !== 'CAMERA_CAPTURE'
        || !Number.isFinite(proofTimestampMs)
        || Math.abs(proofTimestampMs - attestedTimestampMs) > 1_000
      ) {
        return json(400, { success: false, error: 'Proof capture timing could not be verified.' });
      }
      deadlineAttestedAt = attestation.startedAt;
    } else if (proofIntent.captureLicense) {
      // Offline path: the device had no connectivity to obtain a server
      // attestation at capture time, so it presents the license it fetched
      // earlier plus the start time it recorded locally.
      if (
        proofIntent.proofOrigin !== 'CAMERA'
        || proofIntent.proofTimestampSource !== 'CAMERA_CAPTURE'
      ) {
        return json(400, { success: false, error: 'Proof capture timing could not be verified.' });
      }

      const licensedStartedAt = await verifyLicensedCaptureStart({
        token: proofIntent.captureLicense,
        secret: env.serviceRoleKey,
        taskId,
        ownerId: user.id,
        claimedStartedAtMs: proofIntent.proofTimestampAt
          ? new Date(proofIntent.proofTimestampAt).getTime()
          : NaN,
      });

      if (!licensedStartedAt) {
        return json(400, { success: false, error: 'Proof capture timing could not be verified.' });
      }
      deadlineAttestedAt = licensedStartedAt;
    }

    if (
      CAPTURE_DEADLINE_STATUSES.has(taskStatus)
      && isCompletionEditingLocked(taskStatus, taskDeadline)
      && !deadlineAttestedAt
    ) {
      return json(409, { success: false, error: COMPLETION_EDIT_LOCKED_ERROR });
    }

    const { data: existingProof, error: existingProofError } = await adminClient
      .from('task_completion_proofs')
      .select('bucket, object_path')
      .eq('task_id', taskId)
      .maybeSingle();

    if (existingProofError) {
      return json(400, { success: false, error: existingProofError.message });
    }

    const bucketName = ((existingProof as { bucket?: string } | null)?.bucket || TASK_PROOFS_BUCKET);
    const existingObjectPath = ((existingProof as { object_path?: string } | null)?.object_path || '').trim();
    // object_path is immutable at DB level; keep the same path for replacements.
    const objectPath = existingObjectPath || buildTaskProofObjectPath(user.id, taskId, proofIntent.mimeType);

    if (existingObjectPath) {
      await adminClient
        .storage
        .from(bucketName)
        .remove([existingObjectPath]);
    }

    const { error: upsertError } = await adminClient
      .from('task_completion_proofs')
      .upsert({
        task_id: taskId,
        owner_id: user.id,
        voucher_id: (task as { voucher_id: string }).voucher_id,
        bucket: bucketName,
        object_path: objectPath,
        media_kind: proofIntent.mediaKind,
        mime_type: proofIntent.mimeType,
        size_bytes: proofIntent.sizeBytes,
        duration_ms: proofIntent.durationMs ?? null,
        overlay_timestamp_text: proofIntent.overlayTimestampText,
        proof_origin: proofIntent.proofOrigin,
        proof_timestamp_at: proofIntent.proofTimestampAt,
        proof_timestamp_source: proofIntent.proofTimestampSource,
        proof_timezone: proofIntent.proofTimezone,
        upload_state: 'PENDING',
        updated_at: deadlineAttestedAt || new Date().toISOString(),
      }, { onConflict: 'task_id' });

    if (upsertError) {
      return json(400, { success: false, error: upsertError.message });
    }

    const { data: signedUpload, error: signedUploadError } = await adminClient
      .storage
      .from(bucketName)
      .createSignedUploadUrl(objectPath);

    if (signedUploadError || !signedUpload?.token) {
      await adminClient
        .from('task_completion_proofs')
        .update({
          upload_state: 'FAILED',
          updated_at: new Date().toISOString(),
        })
        .eq('task_id', taskId)
        .eq('owner_id', user.id);

      return json(400, { success: false, error: signedUploadError?.message || 'Could not create proof upload session.' });
    }

    return json(200, {
      success: true,
      proofUploadTarget: {
        bucket: bucketName,
        objectPath,
        uploadToken: signedUpload.token,
      },
    });
  }

  if (action === 'finalize') {
    const parsed = normalizeProofMeta((body as FinalizeRequestBody).proofMeta);
    if (parsed.error || !parsed.value) {
      return json(400, { success: false, error: parsed.error || 'Invalid proof payload.' });
    }

    const proofMeta = parsed.value;

    const { data: proofRow, error: proofFetchError } = await adminClient
      .from('task_completion_proofs')
      .select('id, bucket, object_path, owner_id, proof_origin, proof_timestamp_at, proof_timestamp_source, proof_timezone, created_at, updated_at')
      .eq('task_id', taskId)
      .eq('owner_id', user.id)
      .maybeSingle();

    if (proofFetchError) {
      return json(400, { success: false, error: proofFetchError.message });
    }

    if (!proofRow) {
      return json(400, { success: false, error: 'Proof record not found.' });
    }

    const storedProofBucket = String((proofRow as { bucket?: string }).bucket || TASK_PROOFS_BUCKET);
    const storedProofObjectPath = String((proofRow as { object_path?: string }).object_path || '');
    const proofStagedAt = String(
      (proofRow as { updated_at?: string | null }).updated_at
      || (proofRow as { created_at?: string | null }).created_at
      || '',
    );
    const discardPendingProof = async () => {
      let failQuery = adminClient
        .from('task_completion_proofs')
        .update({ upload_state: 'FAILED', updated_at: new Date().toISOString() })
        .eq('id', String((proofRow as { id: string }).id))
        .eq('owner_id', user.id)
        .eq('upload_state', 'PENDING');
      if (proofStagedAt) failQuery = failQuery.eq('updated_at', proofStagedAt);

      const { data: failedProof, error: failError } = await failQuery
        .select('id')
        .maybeSingle();
      if (failError) {
        console.error(`Could not mark rejected proof failed for task ${taskId}:`, failError);
        return;
      }
      // If finalization committed or another upload replaced this one, do not
      // remove the shared immutable object path.
      if (!failedProof) return;

      if (storedProofObjectPath) {
        const { error: removeError } = await adminClient.storage
          .from(storedProofBucket)
          .remove([storedProofObjectPath]);
        if (removeError) {
          console.error(`Could not remove rejected proof object for task ${taskId}:`, removeError);
        }
      }

      const { error: taskProofError } = await adminClient
        .from('tasks')
        .update({ has_proof: false, updated_at: new Date().toISOString() })
        .eq('id', taskId)
        .eq('user_id', user.id);
      if (taskProofError) {
        console.error(`Could not clear rejected proof state for task ${taskId}:`, taskProofError);
      }
    };

    if (
      isCompletionEditingLocked(taskStatus, taskDeadline)
      && !wasProofStagedBeforeCompletionLock(taskDeadline, proofStagedAt)
    ) {
      await discardPendingProof();
      return json(409, { success: false, error: COMPLETION_EDIT_LOCKED_ERROR });
    }

    // A capture attested as on-time carries the upload past the deadline, but
    // not indefinitely — otherwise a staged proof could be redeemed hours later.
    // The window is wide enough for a large video on a poor connection or an
    // upload resumed after the app was killed.
    if (isCompletionEditingLocked(taskStatus, taskDeadline)) {
      const stagedAtMs = proofStagedAt ? new Date(proofStagedAt).getTime() : NaN;
      if (!Number.isFinite(stagedAtMs) || Date.now() - stagedAtMs > CAPTURE_UPLOAD_WINDOW_MS) {
        await discardPendingProof();
        return json(409, { success: false, error: COMPLETION_EDIT_LOCKED_ERROR });
      }
    }

    if (
      (proofRow as { bucket: string; object_path: string }).bucket !== proofMeta.bucket ||
      (proofRow as { bucket: string; object_path: string }).object_path !== proofMeta.objectPath
    ) {
      return json(400, { success: false, error: 'Proof upload target mismatch.' });
    }

    const storedTimestampAt = (proofRow as { proof_timestamp_at?: string | null }).proof_timestamp_at;
    if (
      (proofRow as { proof_origin?: string | null }).proof_origin !== proofMeta.proofOrigin
      || (storedTimestampAt ? new Date(storedTimestampAt).toISOString() : null) !== proofMeta.proofTimestampAt
      || (proofRow as { proof_timestamp_source?: string | null }).proof_timestamp_source !== proofMeta.proofTimestampSource
      || (proofRow as { proof_timezone?: string | null }).proof_timezone !== proofMeta.proofTimezone
    ) {
      return json(400, { success: false, error: 'Proof timestamp metadata changed during upload.' });
    }

    const pathParts = proofMeta.objectPath.split('/');
    const uploadedFileName = pathParts.pop() || '';
    const uploadedFolder = pathParts.join('/');
    const { data: uploadedFiles, error: uploadedFileError } = await adminClient.storage
      .from(proofMeta.bucket)
      .list(uploadedFolder, { search: uploadedFileName, limit: 10 });
    const uploadedFile = (uploadedFiles ?? []).find((file) => file.name === uploadedFileName);
    const actualSizeBytes = Number(uploadedFile?.metadata?.size);

    if (uploadedFileError || !uploadedFile || !Number.isFinite(actualSizeBytes) || actualSizeBytes <= 0) {
      return json(400, { success: false, error: 'Could not verify the uploaded proof.' });
    }

    if (actualSizeBytes > maxProofBytes(proofMeta.mediaKind)) {
      await adminClient.storage.from(proofMeta.bucket).remove([proofMeta.objectPath]);
      await adminClient
        .from('task_completion_proofs')
        .update({ upload_state: 'FAILED', updated_at: new Date().toISOString() })
        .eq('task_id', taskId)
        .eq('owner_id', user.id);
      return json(400, {
        success: false,
        error: `${proofMeta.mediaKind === 'video' ? 'Video' : 'Image'} proof must be under ${proofSizeLabel(proofMeta.mediaKind)}.`,
      });
    }

    const { data: finalizeData, error: finalizeError } = await adminClient
      .rpc('finalize_task_proof_atomic', {
        p_task_id: taskId,
        p_owner_id: user.id,
        p_bucket: proofMeta.bucket,
        p_object_path: proofMeta.objectPath,
        p_media_kind: proofMeta.mediaKind,
        p_mime_type: proofMeta.mimeType,
        p_size_bytes: Math.round(actualSizeBytes),
        p_duration_ms: proofMeta.durationMs ?? null,
        p_overlay_timestamp_text: proofMeta.overlayTimestampText,
        p_task_status: (task as { status: string }).status,
      });

    if (finalizeError) {
      await discardPendingProof();
      return json(400, { success: false, error: finalizeError.message });
    }

    const finalizeRow = Array.isArray(finalizeData)
      ? (finalizeData[0] as FinalizeProofAtomicResult | undefined)
      : (finalizeData as FinalizeProofAtomicResult | null);

    if (!finalizeRow?.success) {
      await discardPendingProof();
      const error = finalizeRow?.error || 'Could not finalize proof upload.';
      return json(error === COMPLETION_EDIT_LOCKED_ERROR ? 409 : 400, { success: false, error });
    }

    return json(200, { success: true });
  }

  if (action === 'fail') {
    const proofMeta = (body as FailRequestBody).proofMeta;
    const bucket = typeof proofMeta?.bucket === 'string' && proofMeta.bucket.trim()
      ? proofMeta.bucket.trim()
      : TASK_PROOFS_BUCKET;
    const objectPath = typeof proofMeta?.objectPath === 'string' ? proofMeta.objectPath.trim() : '';

    const { data: pendingProof, error: pendingProofError } = await adminClient
      .from('task_completion_proofs')
      .select('bucket, object_path, upload_state')
      .eq('task_id', taskId)
      .eq('owner_id', user.id)
      .maybeSingle();

    if (pendingProofError) {
      return json(400, { success: false, error: pendingProofError.message });
    }
    if (!pendingProof || !canMarkProofUploadFailed((pendingProof as { upload_state?: string }).upload_state)) {
      return json(400, { success: false, error: 'Only a pending proof upload can be marked failed.' });
    }

    const pendingBucket = String((pendingProof as { bucket?: string }).bucket || TASK_PROOFS_BUCKET);
    const pendingObjectPath = String((pendingProof as { object_path?: string }).object_path || '');
    if (objectPath && (bucket !== pendingBucket || objectPath !== pendingObjectPath)) {
      return json(400, { success: false, error: 'Proof upload target mismatch.' });
    }

    const { error: failUpdateError } = await adminClient
      .from('task_completion_proofs')
      .update({
        upload_state: 'FAILED',
        updated_at: new Date().toISOString(),
      })
      .eq('task_id', taskId)
      .eq('owner_id', user.id)
      .eq('upload_state', 'PENDING');

    if (failUpdateError) {
      return json(400, { success: false, error: failUpdateError.message });
    }

    await adminClient
      .from('tasks')
      .update({
        has_proof: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .eq('user_id', user.id);

    if (pendingObjectPath) {
      await adminClient.storage.from(pendingBucket).remove([pendingObjectPath]);
    }

    return json(200, { success: true });
  }

  if (action === 'purge-final') {
    const taskStatus = (task as { status: string }).status;
    if (!FINAL_TASK_STATUSES.has(taskStatus)) {
      return json(400, { success: false, error: 'Proof can only be purged for final task states.' });
    }

    const { data: proofRow, error: proofRowError } = await adminClient
      .from('task_completion_proofs')
      .select('id, bucket, object_path')
      .eq('task_id', taskId)
      .maybeSingle();

    if (proofRowError) {
      return json(400, { success: false, error: proofRowError.message });
    }

    if (proofRow?.object_path) {
      await adminClient.storage
        .from(((proofRow as { bucket?: string }).bucket || TASK_PROOFS_BUCKET))
        .remove([String((proofRow as { object_path: string }).object_path)]);
    }

    if (proofRow?.id) {
      const { error: deleteError } = await adminClient
        .from('task_completion_proofs')
        .delete()
        .eq('id', String((proofRow as { id: string }).id));

      if (deleteError) {
        return json(400, { success: false, error: deleteError.message });
      }
    }

    await adminClient
      .from('tasks')
      .update({
        has_proof: false,
        proof_request_open: false,
        proof_requested_at: null,
        proof_requested_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);

    return json(200, { success: true });
  }

  if (action === 'remove-current') {
    const { data: proofRow, error: proofRowError } = await adminClient
      .from('task_completion_proofs')
      .select('id, bucket, object_path')
      .eq('task_id', taskId)
      .eq('owner_id', user.id)
      .maybeSingle();

    if (proofRowError) {
      return json(400, { success: false, error: proofRowError.message });
    }

    if (proofRow?.object_path) {
      await adminClient.storage
        .from(((proofRow as { bucket?: string }).bucket || TASK_PROOFS_BUCKET))
        .remove([String((proofRow as { object_path: string }).object_path)]);
    }

    if (proofRow?.id) {
      const { error: deleteError } = await adminClient
        .from('task_completion_proofs')
        .delete()
        .eq('id', String((proofRow as { id: string }).id))
        .eq('owner_id', user.id);

      if (deleteError) {
        return json(400, { success: false, error: deleteError.message });
      }
    }

    await adminClient
      .from('tasks')
      .update({
        has_proof: false,
        proof_request_open: false,
        proof_requested_at: null,
        proof_requested_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .eq('user_id', user.id);

    return json(200, { success: true });
  }

  if (action === 'queue-ai-eval' || action === 'complete-task-command' || action === 'submit-ai-appeal-command') {
    const AI_PROFILE_ID = '11111111-1111-1111-1111-111111111111';
    const taskStatus = (task as { status: string }).status;
    const taskVoucherId = (task as { voucher_id: string }).voucher_id;

    if (taskVoucherId !== AI_PROFILE_ID) {
      return json(400, { success: false, error: 'Task is not assigned to AI voucher.' });
    }

    if (taskStatus !== 'AWAITING_AI') {
      return json(400, { success: false, error: `Task must be in AWAITING_AI status to queue evaluation (currently ${taskStatus}).` });
    }

    const compensateFailedQueue = async (reason: string) => {
      const { data: rolledBack, error: rollbackError } = await adminClient.rpc('rollback_ai_voucher_submission', {
        p_user_id: user.id,
        p_task_id: taskId,
        p_reason: reason,
      });
      if (rollbackError || !rolledBack) {
        console.error('Atomic AI queue compensation failed for task', taskId, rollbackError);
      }
    };

    const { data: reservationData, error: reservationError } = await adminClient
      .rpc('reserve_ai_voucher_credit', {
        p_user_id: user.id,
        p_task_id: taskId,
      });

    if (reservationError) {
      console.error('AI voucher quota reservation failed for task', taskId, reservationError);
      await compensateFailedQueue('AI_QUOTA_RESERVATION_FAILED');
      return json(500, { success: false, error: 'Could not check AI voucher credits.' });
    }

    const reservation = (Array.isArray(reservationData)
      ? reservationData[0]
      : reservationData) as AiQuotaReservationResult | null;

    if (!reservation?.allowed) {
      await compensateFailedQueue('AI_QUOTA_EXHAUSTED');
      return json(429, {
        success: false,
        code: reservation?.error_code || 'AI_QUOTA_EXHAUSTED',
        error: 'Monthly AI voucher credits exhausted.',
        quota: reservation ? {
          accountTier: reservation.account_tier,
          used: reservation.used,
          pending: reservation.pending,
          limit: reservation.monthly_limit,
          remaining: reservation.remaining,
          resetsAt: reservation.resets_at,
          canStartReview: false,
        } : null,
      });
    }

    const triggerSecretKey = Deno.env.get('TRIGGER_SECRET_KEY');
    if (!triggerSecretKey) {
      console.error('TRIGGER_SECRET_KEY not set — AI voucher evaluation will not run');
      await compensateFailedQueue('AI_EVALUATION_NOT_CONFIGURED');
      return json(500, { success: false, error: 'AI evaluation service not configured.' });
    }

    const triggerRes = await fetch('https://api.trigger.dev/api/v1/tasks/ai-voucher-evaluate/trigger', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${triggerSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: { taskId } }),
    }).catch((err) => {
      console.error('AI voucher evaluation: network error for task', taskId, err);
      return null;
    });

    if (!triggerRes) {
      await compensateFailedQueue('AI_EVALUATION_UNAVAILABLE');
      return json(500, { success: false, error: 'AI evaluation service unavailable.' });
    }

    if (!triggerRes.ok) {
      const responseBody = await triggerRes.text().catch(() => '');
      console.error(`AI voucher evaluation: HTTP ${triggerRes.status} for task ${taskId}:`, responseBody);
      await compensateFailedQueue('AI_EVALUATION_TRIGGER_FAILED');
      return json(500, { success: false, error: `AI evaluation trigger failed (HTTP ${triggerRes.status}).` });
    }

    console.log('AI voucher evaluation queued for task', taskId);
    return json(200, taskCommandResult ?? { success: true });
  }

  if (action === 'queue-rectification-ai-eval') {
    const requestId = typeof (body as QueueAiRectificationEvalRequestBody).requestId === 'string'
      ? (body as QueueAiRectificationEvalRequestBody).requestId.trim()
      : '';
    if (!requestId || taskStatus !== 'AWAITING_RECTIFICATION') {
      return json(400, { success: false, error: 'Rectification request is not ready for AI review.' });
    }
    const { data: rectification } = await adminClient
      .from('rectification_requests')
      .select('id, owner_id, task_id, target_type, state')
      .eq('id', requestId)
      .eq('task_id', taskId)
      .eq('owner_id', user.id)
      .maybeSingle();
    if (!rectification || rectification.target_type !== 'AI' || rectification.state !== 'PENDING_AI') {
      return json(400, { success: false, error: 'AI rectification request is no longer pending.' });
    }
    const { data: uploadedProof } = await adminClient
      .from('task_completion_proofs')
      .select('id')
      .eq('task_id', taskId)
      .eq('owner_id', user.id)
      .eq('upload_state', 'UPLOADED')
      .maybeSingle();
    if (!uploadedProof) {
      return json(400, { success: false, error: 'Proof is required for AI rectification.' });
    }
    const triggerSecretKey = Deno.env.get('TRIGGER_SECRET_KEY');
    if (!triggerSecretKey) return json(500, { success: false, error: 'AI evaluation service not configured.' });
    const triggerRes = await fetch('https://api.trigger.dev/api/v1/tasks/ai-rectification-evaluate/trigger', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${triggerSecretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { requestId } }),
    }).catch(() => null);
    if (!triggerRes?.ok) {
      return json(500, { success: false, error: 'AI rectification evaluation could not be queued.' });
    }
    return json(200, { success: true });
  }

  if (action === 'queue-rectification-notification') {
    const notificationBody = body as QueueRectificationNotificationRequestBody;
    const requestId = typeof notificationBody.requestId === 'string' ? notificationBody.requestId.trim() : '';
    const kind = notificationBody.kind;
    const eventTypeByKind: Record<QueueRectificationNotificationRequestBody['kind'], string> = {
      REQUESTED: 'RECTIFICATION_REQUESTED',
      UPDATED: 'RECTIFICATION_UPDATED',
      CANCELLED: 'RECTIFICATION_CANCELLED',
      PROOF_REQUESTED: 'RECTIFICATION_PROOF_REQUESTED',
      PROOF_UPLOADED: 'RECTIFICATION_PROOF_UPLOADED',
      ESCALATED: 'RECTIFICATION_ESCALATED',
      APPROVED: 'RECTIFICATION_APPROVED',
      DECLINED: 'RECTIFICATION_DECLINED',
      DIRECT_APPROVED: 'RECTIFICATION_APPROVED',
    };
    if (!kind || !eventTypeByKind[kind] || (kind !== 'DIRECT_APPROVED' && !requestId)) {
      return json(400, { success: false, error: 'Invalid rectification notification.' });
    }

    if (requestId) {
      const { data: rectification } = await adminClient.from('rectification_requests').select('*')
        .eq('id', requestId).eq('task_id', taskId).maybeSingle();
      if (!rectification) return json(404, { success: false, error: 'Rectification request not found.' });
      const ownerKinds = new Set(['REQUESTED', 'UPDATED', 'CANCELLED', 'PROOF_UPLOADED', 'ESCALATED']);
      const voucherKinds = new Set(['PROOF_REQUESTED', 'APPROVED', 'DECLINED']);
      const allowed = (ownerKinds.has(kind) && rectification.owner_id === user.id)
        || (voucherKinds.has(kind) && rectification.target_voucher_id === user.id && rectification.target_type === 'ORIGINAL_VOUCHER');
      if (!allowed) return json(403, { success: false, error: 'Not authorized for this rectification notification.' });
    } else if (kind !== 'DIRECT_APPROVED' || (task as { voucher_id: string }).voucher_id !== user.id) {
      return json(403, { success: false, error: 'Not authorized for this rectification notification.' });
    }

    const { data: recentEvents } = await adminClient.from('task_events')
      .select('metadata').eq('task_id', taskId).eq('event_type', eventTypeByKind[kind])
      .eq('actor_id', user.id).order('created_at', { ascending: false }).limit(10);
    const matchingEvent = (recentEvents || []).some((event: { metadata?: Record<string, unknown> | null }) => (
      kind === 'DIRECT_APPROVED'
        ? event.metadata?.direct === true
        : event.metadata?.request_id === requestId
    ));
    if (!matchingEvent) return json(409, { success: false, error: 'Rectification event is not committed yet.' });

    const triggerSecretKey = Deno.env.get('TRIGGER_SECRET_KEY');
    if (!triggerSecretKey) return json(500, { success: false, error: 'Notification service not configured.' });
    const triggerRes = await fetch('https://api.trigger.dev/api/v1/tasks/rectification-notification/trigger', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${triggerSecretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: { taskId, requestId: requestId || undefined, kind },
        options: { idempotencyKey: `rectification-${requestId || taskId}-${kind}` },
      }),
    }).catch(() => null);
    if (!triggerRes?.ok) return json(500, { success: false, error: 'Rectification notification could not be queued.' });
    return json(200, { success: true });
  }

  return json(400, { success: false, error: 'Invalid proof action.' });
});
