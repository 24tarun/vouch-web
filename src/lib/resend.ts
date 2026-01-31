import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;

export const resend = apiKey ? new Resend(apiKey) : null;

if (!apiKey && process.env.NODE_ENV !== "production") {
    console.warn("⚠️ RESEND_API_KEY is missing. Emails will not be sent.");
}
