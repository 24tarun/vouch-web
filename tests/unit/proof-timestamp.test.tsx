import test from "node:test";
import assert from "node:assert/strict";
import { TextDecoder, TextEncoder } from "node:util";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { ProofMedia } from "../../src/components/ProofMedia";
import {
    extractProofTimestampTextFromJpegBuffer,
    extractProofTimestampTextFromVideoBuffer,
    formatProofTimestampParts,
    normalizeProofTimestampText,
} from "../../src/lib/proof-timestamp";
import { PROOF_TIMESTAMP_PLACEHOLDER } from "../../src/lib/task-proof-shared";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });

const globalAny = globalThis as typeof globalThis & {
    window: Window & typeof globalThis;
    document: Document;
    navigator: Navigator;
    HTMLElement: typeof HTMLElement;
    HTMLVideoElement: typeof HTMLVideoElement;
    Node: typeof Node;
    TextEncoder: typeof TextEncoder;
    TextDecoder: typeof TextDecoder;
    IS_REACT_ACT_ENVIRONMENT: boolean;
};

globalAny.window = dom.window as unknown as Window & typeof globalThis;
globalAny.document = dom.window.document;
Object.defineProperty(globalAny, "navigator", {
    value: dom.window.navigator,
    configurable: true,
});
globalAny.HTMLElement = dom.window.HTMLElement;
globalAny.HTMLVideoElement = dom.window.HTMLVideoElement;
globalAny.Node = dom.window.Node;
globalAny.TextEncoder = TextEncoder as unknown as typeof globalAny.TextEncoder;
globalAny.TextDecoder = TextDecoder as unknown as typeof globalAny.TextDecoder;
globalAny.IS_REACT_ACT_ENVIRONMENT = true;

test.afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
});

function concatBytes(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }

    return combined;
}

function buildAsciiBytes(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function buildAtom(type: string, body: Uint8Array): Uint8Array {
    const atom = new Uint8Array(8 + body.length);
    const view = new DataView(atom.buffer);
    view.setUint32(0, atom.length);
    atom.set(buildAsciiBytes(type), 4);
    atom.set(body, 8);
    return atom;
}

function buildExifJpegBuffer(dateText: string): ArrayBuffer {
    const exifDateBytes = buildAsciiBytes(`${dateText}\0`);
    const tiffBytes = new Uint8Array(26 + exifDateBytes.length);
    const tiffView = new DataView(tiffBytes.buffer);

    tiffBytes[0] = 0x49;
    tiffBytes[1] = 0x49;
    tiffView.setUint16(2, 42, true);
    tiffView.setUint32(4, 8, true);
    tiffView.setUint16(8, 1, true);
    tiffView.setUint16(10, 0x0132, true);
    tiffView.setUint16(12, 2, true);
    tiffView.setUint32(14, exifDateBytes.length, true);
    tiffView.setUint32(18, 26, true);
    tiffView.setUint32(22, 0, true);
    tiffBytes.set(exifDateBytes, 26);

    const exifPayload = concatBytes([
        buildAsciiBytes("Exif"),
        new Uint8Array([0, 0]),
        tiffBytes,
    ]);

    const app1Segment = new Uint8Array(4 + exifPayload.length);
    const app1View = new DataView(app1Segment.buffer);
    app1Segment[0] = 0xff;
    app1Segment[1] = 0xe1;
    app1View.setUint16(2, exifPayload.length + 2);
    app1Segment.set(exifPayload, 4);

    return concatBytes([
        new Uint8Array([0xff, 0xd8]),
        app1Segment,
        new Uint8Array([0xff, 0xd9]),
    ]).buffer as ArrayBuffer;
}

function buildQuickTimeVideoBuffer(date: Date): ArrayBuffer {
    const creationSeconds = Math.floor((date.getTime() - Date.UTC(1904, 0, 1, 0, 0, 0, 0)) / 1000);
    const mvhdBody = new Uint8Array(20);
    const mvhdView = new DataView(mvhdBody.buffer);

    mvhdBody[0] = 0;
    mvhdView.setUint32(4, creationSeconds);

    return buildAtom("moov", buildAtom("mvhd", mvhdBody)).buffer as ArrayBuffer;
}

test("proof timestamp formatting zero-pads valid values and rejects invalid text", () => {
    /*
     * What and why this test checks:
     * This checks the shared formatter and normalizer that every proof overlay path now relies on.
     * If these helpers drift, extracted timestamps and stored overlay text can render inconsistently.
     *
     * Passing scenario:
     * Valid numeric parts render exactly as HH:MM DD/MM/YY with leading zeroes, while malformed text falls back.
     *
     * Failing scenario:
     * If zero-padding breaks or invalid strings are allowed through, users and vouchers could see mismatched or malformed overlays.
     */
    assert.equal(
        formatProofTimestampParts({
            year: 2026,
            month: 3,
            day: 7,
            hours: 8,
            minutes: 4,
        }),
        "08:04 07/03/26"
    );
    assert.equal(normalizeProofTimestampText("08:04 07/03/26"), "08:04 07/03/26");
    assert.equal(normalizeProofTimestampText("not-a-timestamp"), PROOF_TIMESTAMP_PLACEHOLDER);
});

test("JPEG EXIF extraction reads the original capture timestamp from metadata", () => {
    /*
     * What and why this test checks:
     * This verifies the client-side image metadata path that should surface the original EXIF capture time on proof previews.
     *
     * Passing scenario:
     * A JPEG buffer with a valid EXIF DateTime entry returns the exact formatted overlay string.
     *
     * Failing scenario:
     * If EXIF parsing regresses, real photos would lose their source timestamp and fall back to the placeholder.
     */
    const buffer = buildExifJpegBuffer("2026:03:07 08:14:59");

    assert.equal(extractProofTimestampTextFromJpegBuffer(buffer), "08:14 07/03/26");
});

test("missing or unreadable image metadata normalizes to the placeholder overlay", () => {
    /*
     * What and why this test checks:
     * This covers the fallback path for files that do not expose a usable embedded timestamp.
     *
     * Passing scenario:
     * A non-EXIF buffer yields no extracted timestamp and normalizes to the exact placeholder text.
     *
     * Failing scenario:
     * If unsupported files produce garbage text or throw unexpectedly, proof previews become unreliable instead of predictable.
     */
    const invalidBuffer = new Uint8Array([0x00, 0x11, 0x22, 0x33]).buffer;

    assert.equal(
        normalizeProofTimestampText(extractProofTimestampTextFromJpegBuffer(invalidBuffer)),
        PROOF_TIMESTAMP_PLACEHOLDER
    );
});

test("QuickTime video extraction formats mvhd creation time in the uploader timezone fallback", () => {
    /*
     * What and why this test checks:
     * This verifies the lightweight video metadata parser and the timezone fallback rule the app uses when no explicit media timezone is available.
     *
     * Passing scenario:
     * A QuickTime-style mvhd creation timestamp is converted into the uploader timezone and rendered in the exact overlay format.
     *
     * Failing scenario:
     * If atom parsing or timezone formatting breaks, videos will show the wrong local capture time or lose the overlay entirely.
     */
    const buffer = buildQuickTimeVideoBuffer(new Date("2026-03-07T09:14:00.000Z"));

    assert.equal(
        extractProofTimestampTextFromVideoBuffer(buffer, "Europe/Berlin"),
        "10:14 07/03/26"
    );
});

test("ProofMedia renders the stored overlay text on image previews", () => {
    /*
     * What and why this test checks:
     * This validates the shared proof viewer wrapper that owner and voucher image previews now both use.
     *
     * Passing scenario:
     * Rendering an image proof shows the media element and the stored overlay text in the DOM together.
     *
     * Failing scenario:
     * If the wrapper drops the overlay or hides it from the shared view layer, one side of the app could stop showing proof timestamps.
     */
    const view = render(
        <ProofMedia
            mediaKind="image"
            src="/proof.jpg"
            alt="Proof image"
            overlayTimestampText="08:14 07/03/26"
            imageClassName="proof-image"
        />
    );

    assert.ok(view.getByRole("img", { name: "Proof image" }));
    assert.ok(view.getByText("08:14 07/03/26"));
});

test("ProofMedia normalizes invalid overlay text to the placeholder on video previews", () => {
    /*
     * What and why this test checks:
     * This covers the shared fallback rendering path so malformed proof rows still display a deterministic timestamp string.
     *
     * Passing scenario:
     * Rendering a video proof with invalid overlay text shows the video element and the placeholder overlay.
     *
     * Failing scenario:
     * If invalid values leak through unchanged, users and vouchers could see broken or inconsistent timestamp text across previews.
     */
    const view = render(
        <ProofMedia
            mediaKind="video"
            src="/proof.mp4"
            alt="Proof video"
            overlayTimestampText="bad-value"
            videoClassName="proof-video"
        />
    );

    assert.ok(view.container.querySelector("video"));
    assert.ok(view.getByText(PROOF_TIMESTAMP_PLACEHOLDER));
});
