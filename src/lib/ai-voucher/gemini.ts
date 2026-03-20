/**
 * Gemini AI Integration for Proof Evaluation
 *
 * This module is SERVER-ONLY. Never import from client components.
 * Handles image and video proof evaluation using Google's Gemini 2.5 Flash-Lite API.
 */

import {
  GoogleGenerativeAI,
  SchemaType,
  type Schema,
} from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { inferExtensionFromMime } from "@/lib/task-proof-shared";

// wait is only available inside a Trigger.dev task context — imported lazily
let _triggerWait: ((opts: { seconds: number }) => Promise<void>) | null = null;
async function waitSeconds(seconds: number) {
  if (_triggerWait) {
    await _triggerWait({ seconds });
  } else {
    await new Promise((r) => setTimeout(r, seconds * 1000));
  }
}
export function setTriggerWait(fn: (opts: { seconds: number }) => Promise<void>) {
  _triggerWait = fn;
}

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

// Structured output schema — forces Gemini to return exactly this shape
const EVALUATION_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    decision: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["approved", "denied"],
      description: "Whether the proof demonstrates task completion",
    },
    reason: {
      type: SchemaType.STRING,
      description: "Plain-English explanation of denial (only on denial)",
    },
  },
  required: ["decision"],
};

/**
 * System prompt for the AI voucher.
 * Sets persona (strict but fair), context, and evaluation rules.
 */
function buildSystemPrompt(taskTitle: string, taskDeadline: string): string {
  return `You are a strict but fair accountability judge reviewing proof of task completion.

Task: ${taskTitle}
Deadline: ${taskDeadline}

The user has submitted proof. Your job is to decide whether the proof credibly demonstrates that this task was completed.

Rules:
- If the proof clearly shows the task was completed, return approved.
- If the proof is ambiguous, unconvincing, or clearly does not match the task, return denied.
- On denial, provide one plain sentence explaining why. Be direct. No softening.
- On approval, provide no reason — just approved.
- Do not be fooled by staged, partial, or irrelevant proof.
- You are the last line of accountability. Take it seriously.`;
}

export interface ProofEvaluationResult {
  decision: "approved" | "denied";
  reason?: string;
}

export interface EvaluateProofParams {
  taskTitle: string;
  taskDeadline: string;
  proofBuffer: Buffer;
  mimeType: string;
  mediaKind: "image" | "video";
}

/**
 * Evaluate proof using Gemini 2.5 Flash-Lite with structured output.
 *
 * For images: base64 inline
 * For videos: upload via File API, poll for processing, then inference
 */
export async function evaluateProofWithGemini(
  params: EvaluateProofParams
): Promise<ProofEvaluationResult> {
  const { taskTitle, taskDeadline, proofBuffer, mimeType, mediaKind } = params;

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction: buildSystemPrompt(taskTitle, taskDeadline),
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: EVALUATION_SCHEMA,
      temperature: 0, // Deterministic evaluation
    },
  });

  if (mediaKind === "image") {
    return evaluateImageProof(model, proofBuffer, mimeType);
  } else {
    return evaluateVideoProof(model, proofBuffer, mimeType);
  }
}

/**
 * Evaluate image proof via base64 inline.
 * Timeout: 30 seconds.
 */
async function evaluateImageProof(
  model: ReturnType<typeof genAI.getGenerativeModel>,
  buffer: Buffer,
  mimeType: string
): Promise<ProofEvaluationResult> {
  const base64Data = buffer.toString("base64");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const result = await Promise.race([
      model.generateContent([
        {
          inlineData: {
            mimeType: mimeType as
              | "image/jpeg"
              | "image/png"
              | "image/gif"
              | "image/webp",
            data: base64Data,
          },
        },
        {
          text: "Evaluate this proof of task completion.",
        },
      ]),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () =>
          reject(new Error("Image evaluation timeout (30s)"))
        )
      ),
    ]);

    const responseText = result.response.text();
    return JSON.parse(responseText) as ProofEvaluationResult;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Evaluate video proof via Google File API.
 * Upload → poll for processing → inference
 * Timeout: 120 seconds (including upload + processing + inference).
 */
async function evaluateVideoProof(
  model: ReturnType<typeof genAI.getGenerativeModel>,
  buffer: Buffer,
  mimeType: string
): Promise<ProofEvaluationResult> {
  let tempFilePath: string | null = null;

  const normalizedMimeType = (mimeType || "").toLowerCase();
  const uploadMimeType = normalizedMimeType.startsWith("video/")
    ? normalizedMimeType
    : "video/mp4";
  const uploadExt = inferExtensionFromMime(uploadMimeType);

  const startTime = Date.now();
  const timeout = 120000; // 120 seconds

  try {
    // Write buffer to temp file
    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `proof-${Date.now()}.${uploadExt}`);
    fs.writeFileSync(tempFilePath, buffer);

    // Upload to Gemini File API
    console.log("Uploading video to Gemini File API...");
    const uploadResult = await fileManager.uploadFile(tempFilePath, {
      mimeType: uploadMimeType,
      displayName: "task-proof",
    });

    console.log("Video uploaded, URI:", uploadResult.file.uri);

    // Poll for processing completion
    console.log("Polling for processing...");
    let file = await fileManager.getFile(uploadResult.file.name);

    while (file.state === "PROCESSING") {
      if (Date.now() - startTime > timeout) {
        throw new Error(`Video processing timeout (${timeout}ms)`);
      }

      await waitSeconds(6);
      file = await fileManager.getFile(uploadResult.file.name);
    }

    if (file.state !== "ACTIVE") {
      throw new Error(`Video processing failed: state=${file.state}`);
    }

    console.log("Video processed, state:", file.state);

    // Evaluate the processed video
    const result = await model.generateContent([
      {
        fileData: {
          mimeType: uploadMimeType,
          fileUri: file.uri,
        },
      },
      {
        text: "Evaluate this video proof of task completion.",
      },
    ]);

    const responseText = result.response.text();
    return JSON.parse(responseText) as ProofEvaluationResult;
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch {
        console.error(`Failed to clean up temp file: ${tempFilePath}`);
      }
    }

    // Note: Gemini File API automatically deletes files after 48 hours
    // We don't explicitly delete here since Google handles it
  }
}
