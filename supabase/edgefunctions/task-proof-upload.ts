import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const TASK_PROOFS_BUCKET = 'task-proofs';
const PROOF_TIMESTAMP_PLACEHOLDER = '??:?? ??/??/??';
const MAX_TASK_PROOF_VIDEO_DURATION_MS = 15_000;

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
]);

const FINAL_TASK_STATUSES = new Set([
  'ACCEPTED',
  'AUTO_ACCEPTED',
  'AI_ACCEPTED',
  'DENIED',
  'MISSED',
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

interface ProofIntent {
  mediaKind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number | null;
  overlayTimestampText?: string | null;
}

interface ProofMeta extends ProofIntent {
  bucket: string;
  objectPath: string;
}

interface FinalizeProofAtomicResult {
  success: boolean;
  error: string | null;
}

interface InitRequestBody {
  action: 'init';
  taskId: string;
  proofIntent: ProofIntent;
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

type RequestBody =
  | InitRequestBody
  | FinalizeRequestBody
  | FailRequestBody
  | PurgeFinalRequestBody
  | RemoveCurrentRequestBody;

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function normalizeProofTimestampText(value: unknown): string {
  if (typeof value !== 'string') return PROOF_TIMESTAMP_PLACEHOLDER;
  const trimmed = value.trim();
  return PROOF_TIMESTAMP_REGEX.test(trimmed) ? trimmed : PROOF_TIMESTAMP_PLACEHOLDER;
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

  if (!mediaKind || !mimeType || !ALLOWED_PROOF_MIME_TYPES.has(mimeType)) {
    return { error: 'Please use JPG, PNG, WEBP, HEIC, MP4, MOV, or WEBM.' };
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { error: 'Selected media size is invalid.' };
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
    .select('id, user_id, voucher_id, status')
    .eq('id', taskId)
    .single();

  if (taskError || !task) {
    return json(404, { success: false, error: 'Task not found.' });
  }

  if ((task as { user_id: string }).user_id !== user.id) {
    const isVoucher = (task as { voucher_id: string }).voucher_id === user.id;
    if (!(action === 'purge-final' && isVoucher)) {
      return json(403, { success: false, error: 'You can only upload proof for your own tasks.' });
    }
  }

  if (
    (action === 'init' || action === 'finalize')
    && !ATTACHABLE_PROOF_STATUSES.has((task as { status: string }).status)
  ) {
    return json(400, { success: false, error: 'Proof can only be attached to active or awaiting tasks.' });
  }

  if (action === 'init') {
    const parsed = normalizeProofIntent((body as InitRequestBody).proofIntent);
    if (parsed.error || !parsed.value) {
      return json(400, { success: false, error: parsed.error || 'Invalid proof payload.' });
    }

    const proofIntent = parsed.value;

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
        upload_state: 'PENDING',
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
      .select('id, bucket, object_path, owner_id')
      .eq('task_id', taskId)
      .eq('owner_id', user.id)
      .maybeSingle();

    if (proofFetchError) {
      return json(400, { success: false, error: proofFetchError.message });
    }

    if (!proofRow) {
      return json(400, { success: false, error: 'Proof record not found.' });
    }

    if (
      (proofRow as { bucket: string; object_path: string }).bucket !== proofMeta.bucket ||
      (proofRow as { bucket: string; object_path: string }).object_path !== proofMeta.objectPath
    ) {
      return json(400, { success: false, error: 'Proof upload target mismatch.' });
    }

    const { data: finalizeData, error: finalizeError } = await adminClient
      .rpc('finalize_task_proof_atomic', {
        p_task_id: taskId,
        p_owner_id: user.id,
        p_bucket: proofMeta.bucket,
        p_object_path: proofMeta.objectPath,
        p_media_kind: proofMeta.mediaKind,
        p_mime_type: proofMeta.mimeType,
        p_size_bytes: proofMeta.sizeBytes,
        p_duration_ms: proofMeta.durationMs ?? null,
        p_overlay_timestamp_text: proofMeta.overlayTimestampText,
        p_task_status: (task as { status: string }).status,
      });

    if (finalizeError) {
      return json(400, { success: false, error: finalizeError.message });
    }

    const finalizeRow = Array.isArray(finalizeData)
      ? (finalizeData[0] as FinalizeProofAtomicResult | undefined)
      : (finalizeData as FinalizeProofAtomicResult | null);

    if (!finalizeRow?.success) {
      return json(400, { success: false, error: finalizeRow?.error || 'Could not finalize proof upload.' });
    }

    const AI_PROFILE_ID = '00000000-0000-0000-0000-000000000001';
    if ((task as { voucher_id: string }).voucher_id === AI_PROFILE_ID) {
      const triggerSecretKey = Deno.env.get('TRIGGER_SECRET_KEY');
      if (triggerSecretKey) {
        await fetch('https://api.trigger.dev/api/v3/tasks/ai-voucher-evaluate/trigger', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${triggerSecretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ payload: { taskId } }),
        }).catch((err) => console.error('Failed to queue AI voucher evaluation:', err));
      } else {
        console.error('TRIGGER_SECRET_KEY not set — AI voucher evaluation will not run');
      }
    }

    return json(200, { success: true });
  }

  if (action === 'fail') {
    const proofMeta = (body as FailRequestBody).proofMeta;
    const bucket = typeof proofMeta?.bucket === 'string' && proofMeta.bucket.trim()
      ? proofMeta.bucket.trim()
      : TASK_PROOFS_BUCKET;
    const objectPath = typeof proofMeta?.objectPath === 'string' ? proofMeta.objectPath.trim() : '';

    await adminClient
      .from('task_completion_proofs')
      .update({
        upload_state: 'FAILED',
        updated_at: new Date().toISOString(),
      })
      .eq('task_id', taskId)
      .eq('owner_id', user.id);

    await adminClient
      .from('tasks')
      .update({
        has_proof: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .eq('user_id', user.id);

    if (objectPath) {
      await adminClient.storage.from(bucket).remove([objectPath]);
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

  return json(400, { success: false, error: 'Invalid proof action.' });
});
