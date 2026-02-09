"use client";

import { isNative } from "@/lib/platform";

const dynamicImport = (specifier: string): Promise<any> => {
    const importer = new Function("s", "return import(s);") as (s: string) => Promise<any>;
    return importer(specifier);
};

function base64ToUint8Array(base64: string): Uint8Array {
    const cleaned = base64.includes(",") ? base64.split(",").pop() || "" : base64;
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export async function pickProofFileFromNativeUi(): Promise<File | null> {
    if (!isNative()) return null;

    try {
        const useCamera = window.confirm(
            "Tap OK to open camera. Tap Cancel to choose an image or video from gallery."
        );

        if (useCamera) {
            const cameraModule = await dynamicImport("@capacitor/camera");
            const { Camera, CameraResultType, CameraSource } = cameraModule;
            const photo = await Camera.getPhoto({
                quality: 85,
                resultType: CameraResultType.Uri,
                source: CameraSource.Prompt,
            });

            const webPath = photo.webPath || photo.path;
            if (!webPath) return null;

            const response = await fetch(webPath);
            const blob = await response.blob();
            const ext = (photo.format || "jpg").replace(/[^a-z0-9]/gi, "");
            const mimeType = blob.type || "image/jpeg";
            return new File([blob], `proof-${Date.now()}.${ext}`, { type: mimeType });
        }

        const { FilePicker } = await dynamicImport("@capawesome/capacitor-file-picker");
        const picked = await FilePicker.pickFiles({
            limit: 1,
            readData: true,
            types: ["image/*", "video/*"],
        });

        const pickedFile = picked.files?.[0];
        if (!pickedFile) return null;

        const mimeType = pickedFile.mimeType || "application/octet-stream";
        const filename = pickedFile.name || `proof-${Date.now()}`;

        if (pickedFile.data) {
            const bytes = base64ToUint8Array(pickedFile.data);
            const normalizedBytes = Uint8Array.from(bytes);
            const blob = new Blob([normalizedBytes.buffer], { type: mimeType });
            return new File([blob], filename, { type: mimeType });
        }

        if (pickedFile.path) {
            const response = await fetch(pickedFile.path);
            const blob = await response.blob();
            return new File([blob], filename, { type: blob.type || mimeType });
        }

        return null;
    } catch (error) {
        console.error("Native proof picker failed, falling back to file input:", error);
        return null;
    }
}
