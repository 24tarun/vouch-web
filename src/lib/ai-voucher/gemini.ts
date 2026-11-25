
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
import {
  buildProofEvaluationSystemPrompt,
  type ProofEvaluationTimingContext,
} from "@/lib/ai-voucher/proof-evaluation-context";

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
      description: "Plain-English explanation of the decision",
    },
  },
  required: ["decision", "reason"],
};

export interface ProofEvaluationResult {
  decision: "approved" | "denied";
  reason?: string;
}

export interface EvaluateProofParams {
  taskTitle: string;
  taskDescription?: string | null;
  timing: ProofEvaluationTimingContext;
  proofBuffer: Buffer;
  mimeType: string;
  mediaKind: "image" | "video";
}

export async function evaluateProofWithGemini(
  params: EvaluateProofParams
): Promise<ProofEvaluationResult> {
  const { taskTitle, taskDescription, timing, proofBuffer, mimeType, mediaKind } = params;

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction: buildProofEvaluationSystemPrompt({
      taskTitle,
      taskDescription,
      timing,
    }),
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: EVALUATION_SCHEMA,
      temperature: 0,
    },
  });

  if (mediaKind === "image") {
    return evaluateImageProof(model, proofBuffer, mimeType);
  } else {
    return evaluateVideoProof(model, proofBuffer, mimeType);
  }
}

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
  const timeout = 120000;

  try {
    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `proof-${Date.now()}.${uploadExt}`);
    fs.writeFileSync(tempFilePath, buffer);

    console.log("Uploading video to Gemini File API...");
    const uploadResult = await fileManager.uploadFile(tempFilePath, {
      mimeType: uploadMimeType,
      displayName: "task-proof",
    });

    console.log("Video uploaded, URI:", uploadResult.file.uri);

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
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch {
        console.error(`Failed to clean up temp file: ${tempFilePath}`);
      }
    }

  }
}
