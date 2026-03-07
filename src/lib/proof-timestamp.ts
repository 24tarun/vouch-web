import { PROOF_TIMESTAMP_PLACEHOLDER } from "@/lib/task-proof-shared";

const PROOF_TIMESTAMP_REGEX = /^(?:\d{2}:\d{2} \d{2}\/\d{2}\/\d{2}|\?\?:\?\? \?\?\/\?\?\/\?\?)$/;
const JPEG_SOI = 0xffd8;
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const WEBP_RIFF = "RIFF";
const WEBP_FILE_TYPE = "WEBP";
const MP4_EPOCH_OFFSET_MS = Date.UTC(1904, 0, 1, 0, 0, 0, 0);

interface ProofTimestampParts {
    year: number;
    month: number;
    day: number;
    hours: number;
    minutes: number;
}

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

function hasValidParts(parts: ProofTimestampParts): boolean {
    return (
        Number.isInteger(parts.year) &&
        Number.isInteger(parts.month) &&
        Number.isInteger(parts.day) &&
        Number.isInteger(parts.hours) &&
        Number.isInteger(parts.minutes) &&
        parts.month >= 1 &&
        parts.month <= 12 &&
        parts.day >= 1 &&
        parts.day <= 31 &&
        parts.hours >= 0 &&
        parts.hours <= 23 &&
        parts.minutes >= 0 &&
        parts.minutes <= 59
    );
}

export function formatProofTimestampParts(parts: ProofTimestampParts): string {
    if (!hasValidParts(parts)) return PROOF_TIMESTAMP_PLACEHOLDER;

    return `${pad2(parts.hours)}:${pad2(parts.minutes)} ${pad2(parts.day)}/${pad2(parts.month)}/${pad2(parts.year % 100)}`;
}

export function normalizeProofTimestampText(value: unknown): string {
    if (typeof value !== "string") return PROOF_TIMESTAMP_PLACEHOLDER;
    const trimmed = value.trim();
    return PROOF_TIMESTAMP_REGEX.test(trimmed) ? trimmed : PROOF_TIMESTAMP_PLACEHOLDER;
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
    return String.fromCharCode(...bytes.slice(start, start + length));
}

function parseExifDateTime(text: string): ProofTimestampParts | null {
    const match = text.trim().match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return null;

    const parts = {
        year: Number.parseInt(match[1], 10),
        month: Number.parseInt(match[2], 10),
        day: Number.parseInt(match[3], 10),
        hours: Number.parseInt(match[4], 10),
        minutes: Number.parseInt(match[5], 10),
    };

    return hasValidParts(parts) ? parts : null;
}

function parseIfdAsciiEntry(
    view: DataView,
    littleEndian: boolean,
    tiffStart: number,
    entryOffset: number
): string | null {
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    if (type !== 2 || count === 0) return null;

    const valueOffset = count <= 4
        ? entryOffset + 8
        : tiffStart + view.getUint32(entryOffset + 8, littleEndian);
    const bytes = new Uint8Array(view.buffer, valueOffset, count);
    return new TextDecoder("ascii").decode(bytes).replace(/\0+$/, "").trim() || null;
}

function parseExifIfd(
    view: DataView,
    littleEndian: boolean,
    tiffStart: number,
    ifdRelativeOffset: number,
    preferredTags: number[]
): { value?: string; exifIfdOffset?: number } {
    const ifdOffset = tiffStart + ifdRelativeOffset;
    if (ifdOffset + 2 > view.byteLength) return {};

    const entryCount = view.getUint16(ifdOffset, littleEndian);
    let exifIfdOffset: number | undefined;

    for (let index = 0; index < entryCount; index += 1) {
        const entryOffset = ifdOffset + 2 + (index * 12);
        if (entryOffset + 12 > view.byteLength) break;

        const tag = view.getUint16(entryOffset, littleEndian);
        if (tag === 0x8769) {
            exifIfdOffset = view.getUint32(entryOffset + 8, littleEndian);
        }

        if (!preferredTags.includes(tag)) continue;
        const value = parseIfdAsciiEntry(view, littleEndian, tiffStart, entryOffset);
        if (value) return { value, exifIfdOffset };
    }

    return { exifIfdOffset };
}

function parseTiffTimestamp(view: DataView, tiffStart: number): string | null {
    if (tiffStart + 8 > view.byteLength) return null;

    const byteOrder = readAscii(new Uint8Array(view.buffer), tiffStart, 2);
    const littleEndian = byteOrder === "II";
    if (!littleEndian && byteOrder !== "MM") return null;
    if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return null;

    const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
    const primary = parseExifIfd(view, littleEndian, tiffStart, firstIfdOffset, [0x9003, 0x0132]);
    const primaryParts = primary.value ? parseExifDateTime(primary.value) : null;
    if (primaryParts) {
        return formatProofTimestampParts(primaryParts);
    }

    if (primary.exifIfdOffset != null) {
        const exif = parseExifIfd(view, littleEndian, tiffStart, primary.exifIfdOffset, [0x9003]);
        const exifParts = exif.value ? parseExifDateTime(exif.value) : null;
        if (exifParts) {
            return formatProofTimestampParts(exifParts);
        }
    }

    return null;
}

export function extractProofTimestampTextFromJpegBuffer(buffer: ArrayBuffer): string | null {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== JPEG_SOI) return null;

    let offset = 2;
    while (offset + 4 <= view.byteLength) {
        if (view.getUint8(offset) !== 0xff) break;
        const marker = view.getUint8(offset + 1);
        if (marker === 0xda || marker === 0xd9) break;

        const segmentLength = view.getUint16(offset + 2);
        const segmentStart = offset + 4;
        const segmentEnd = offset + 2 + segmentLength;
        if (segmentEnd > view.byteLength) break;

        if (
            marker === 0xe1 &&
            segmentEnd - segmentStart >= 6 &&
            readAscii(new Uint8Array(buffer), segmentStart, 6) === "Exif\0\0"
        ) {
            return parseTiffTimestamp(view, segmentStart + 6);
        }

        offset = segmentEnd;
    }

    return null;
}

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array, start = 0): boolean {
    if (bytes.length - start < prefix.length) return false;
    for (let index = 0; index < prefix.length; index += 1) {
        if (bytes[start + index] !== prefix[index]) return false;
    }
    return true;
}

function extractProofTimestampTextFromPngBuffer(buffer: ArrayBuffer): string | null {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    if (!hasPrefix(bytes, PNG_SIGNATURE)) return null;

    let offset = 8;
    while (offset + 12 <= view.byteLength) {
        const chunkLength = view.getUint32(offset);
        const chunkType = readAscii(bytes, offset + 4, 4);
        const chunkDataOffset = offset + 8;
        const chunkEnd = chunkDataOffset + chunkLength;
        if (chunkEnd + 4 > view.byteLength) break;

        if (chunkType === "tIME" && chunkLength === 7) {
            return formatProofTimestampParts({
                year: view.getUint16(chunkDataOffset),
                month: view.getUint8(chunkDataOffset + 2),
                day: view.getUint8(chunkDataOffset + 3),
                hours: view.getUint8(chunkDataOffset + 4),
                minutes: view.getUint8(chunkDataOffset + 5),
            });
        }

        if (chunkType === "eXIf") {
            return parseTiffTimestamp(view, chunkDataOffset);
        }

        offset = chunkEnd + 4;
    }

    return null;
}

function extractProofTimestampTextFromWebpBuffer(buffer: ArrayBuffer): string | null {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    if (view.byteLength < 12) return null;
    if (readAscii(bytes, 0, 4) !== WEBP_RIFF || readAscii(bytes, 8, 4) !== WEBP_FILE_TYPE) return null;

    let offset = 12;
    while (offset + 8 <= view.byteLength) {
        const chunkType = readAscii(bytes, offset, 4);
        const chunkLength = view.getUint32(offset + 4, true);
        const chunkDataOffset = offset + 8;
        const paddedLength = chunkLength + (chunkLength % 2);
        const nextOffset = chunkDataOffset + paddedLength;
        if (nextOffset > view.byteLength) break;

        if (chunkType === "EXIF") {
            const chunkBytes = bytes.slice(chunkDataOffset, chunkDataOffset + chunkLength);
            const chunkText = readAscii(chunkBytes, 0, Math.min(6, chunkBytes.length));
            const tiffOffset = chunkText === "Exif\0\0" ? 6 : 0;
            return parseTiffTimestamp(new DataView(chunkBytes.buffer, chunkBytes.byteOffset, chunkBytes.byteLength), tiffOffset);
        }

        offset = nextOffset;
    }

    return null;
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
    try {
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone,
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
            hour12: false,
        }).formatToParts(date);

        const map: Record<string, string> = {};
        for (const part of parts) {
            if (part.type !== "literal") {
                map[part.type] = part.value;
            }
        }

        return normalizeProofTimestampText(`${map.hour}:${map.minute} ${map.day}/${map.month}/${map.year}`);
    } catch {
        return PROOF_TIMESTAMP_PLACEHOLDER;
    }
}

function readAtomSize(view: DataView, offset: number, limit: number): { size: number; headerSize: number } | null {
    if (offset + 8 > limit) return null;
    const size32 = view.getUint32(offset);
    if (size32 === 0) {
        return { size: limit - offset, headerSize: 8 };
    }

    if (size32 === 1) {
        if (offset + 16 > limit || typeof view.getBigUint64 !== "function") return null;
        const size64 = Number(view.getBigUint64(offset + 8));
        if (!Number.isFinite(size64) || size64 < 16) return null;
        return { size: size64, headerSize: 16 };
    }

    if (size32 < 8) return null;
    return { size: size32, headerSize: 8 };
}

function findQuickTimeMvhdTimestamp(view: DataView, start: number, end: number): Date | null {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    let offset = start;

    while (offset + 8 <= end) {
        const atom = readAtomSize(view, offset, end);
        if (!atom) break;

        const atomType = readAscii(bytes, offset + 4, 4);
        const atomBodyOffset = offset + atom.headerSize;
        const atomEnd = offset + atom.size;
        if (atomEnd > end || atomBodyOffset > atomEnd) break;

        if (atomType === "mvhd") {
            if (atomBodyOffset + 8 > atomEnd) return null;

            const version = view.getUint8(atomBodyOffset);
            let creationSeconds: number;

            if (version === 1) {
                if (typeof view.getBigUint64 !== "function" || atomBodyOffset + 12 > atomEnd) {
                    return null;
                }
                creationSeconds = Number(view.getBigUint64(atomBodyOffset + 4));
            } else {
                creationSeconds = view.getUint32(atomBodyOffset + 4);
            }

            if (!Number.isFinite(creationSeconds) || creationSeconds <= 0) return null;

            const timestampMs = MP4_EPOCH_OFFSET_MS + (creationSeconds * 1000);
            const date = new Date(timestampMs);
            return Number.isNaN(date.getTime()) ? null : date;
        }

        offset = atomEnd;
    }

    return null;
}

export function extractProofTimestampTextFromVideoBuffer(buffer: ArrayBuffer, uploaderTimeZone: string): string | null {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    let offset = 0;
    while (offset + 8 <= view.byteLength) {
        const atom = readAtomSize(view, offset, view.byteLength);
        if (!atom) break;
        const atomType = readAscii(bytes, offset + 4, 4);
        const atomEnd = offset + atom.size;
        if (atomEnd > view.byteLength) break;

        if (atomType === "moov") {
            const date = findQuickTimeMvhdTimestamp(view, offset + atom.headerSize, atomEnd);
            return date ? formatDateInTimeZone(date, uploaderTimeZone) : null;
        }

        offset = atomEnd;
    }

    return null;
}

export async function extractProofTimestampText(file: File): Promise<string> {
    const uploaderTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    try {
        const mimeType = (file.type || "").toLowerCase();
        const buffer = await file.arrayBuffer();

        const extracted = mimeType === "image/jpeg" || mimeType === "image/jpg"
            ? extractProofTimestampTextFromJpegBuffer(buffer)
            : mimeType === "image/png"
                ? extractProofTimestampTextFromPngBuffer(buffer)
                : mimeType === "image/webp"
                    ? extractProofTimestampTextFromWebpBuffer(buffer)
                    : mimeType === "video/mp4" || mimeType === "video/quicktime"
                        ? extractProofTimestampTextFromVideoBuffer(buffer, uploaderTimeZone)
                        : null;

        return normalizeProofTimestampText(extracted);
    } catch {
        return PROOF_TIMESTAMP_PLACEHOLDER;
    }
}
