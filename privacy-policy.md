# Privacy Policy for Vouch (TAS)

Effective date: March 23, 2026

This Privacy Policy explains how Vouch (also labeled TAS, Task Accountability System) collects, uses, stores, and shares data when you use our web app, PWA, and mobile app wrappers.

## 1. What We Collect

We collect data you provide directly, data created while using the app, and limited technical data needed to run the service.

### Account and profile data
- Email address
- Username
- Account ID and creation timestamp
- App preferences (for example: default voucher, default failure cost, currency, reminder toggles, push setting, strict Pomodoro, visibility toggles)

### Social and accountability data
- Friend relationships
- Voucher relationships (who vouches for whom)
- Limited friend activity status (active/paused Pomodoro status) for connected friends
- Reputation and accountability metrics derived from task outcomes

### Task and commitment data
- Task titles, descriptions, deadlines, status history, reminders, subtasks, recurrence settings
- Pomodoro session data (duration, elapsed time, status)
- Commitment records (name, description, date range, linked tasks/rules, status)
- Ledger records related to task outcomes and rectifications
- Task event logs (audit history)

### Proof media data
- Optional proof photos/videos uploaded for voucher review
- Proof metadata (media type, size, duration, upload status, optional timestamp text)

### Notification data
- Web push subscription data (endpoint and keys)
- Notification preference settings
- Email notification content and delivery metadata

### Optional Google Calendar integration data
- Google account email returned by OAuth
- Encrypted Google tokens used for sync
- Selected calendar ID/summary
- Google event link metadata, sync timestamps, and sync errors

### Optional AI voucher data (Orca)
- If you opt in to Orca and assign Orca as voucher, proof media and relevant task context (such as task title/deadline) are processed by Google Gemini for approval/denial.
- AI decision records and rationale are stored with task history.
- For video proofs, media may be uploaded to Gemini's File API for processing and then removed by Google on its File API retention schedule (currently up to about 48 hours).

### Technical and security data
- Authentication/session cookies required for sign-in
- Short-lived OAuth state cookie for Google connection flow
- Rate-limit identifiers (for abuse prevention)
- Basic server logs and error logs

## 2. How We Use Data

We use data to:
- Create and secure your account
- Run core accountability features (tasks, vouchers, reminders, commitments, ledger)
- Deliver notifications (push/email)
- Sync with Google Calendar when enabled
- Process AI voucher decisions when Orca is enabled
- Prevent abuse and keep the service reliable
- Improve and debug the product

## 3. How Data Is Shared

We share data only as needed to run the service:

- With other users you choose to involve:
  - Your assigned voucher can view your assigned tasks and related proof during review windows.
  - Connected friends can see limited activity status where features require it.
  - Account lookup/social features may expose your profile details (including email/username) to authenticated users.
- With infrastructure/service providers:
  - Supabase (database, auth, storage, realtime)
  - Trigger.dev (background jobs)
  - Resend (email delivery)
  - Web push providers via browser/device push infrastructure
  - Google APIs (Calendar integration, if connected)
  - Google Generative AI / Gemini (Orca proof evaluation, if enabled)
  - Upstash Redis (rate limiting, when configured)
- If required by law, regulation, legal process, or to protect rights and safety.

We do not sell your personal data.

## 4. Data Retention

- Account, task, reminder, commitment, and ledger data are retained while your account is active.
- Proof media is permanently deleted and cannot be recovered once removed. Deletion occurs when: (a) the user manually removes the proof, or (b) the task the proof is attached to reaches a final state (Accepted, Denied, or Missed). Deletion removes the file from storage immediately and permanently — there is no way to retrieve it after this point.
- Google Calendar connection data is removed when you use "Disconnect & Forget" (including local sync link/outbox data).
- Push subscriptions remain until you disable notifications, unsubscribe on device, or delete your account.
- AI voucher decision records remain as part of task history unless account/task data is deleted.

When you delete your account, we attempt to remove associated profile/task data and proof media from app storage, then delete your auth user.

## 5. Permissions and Device Access

Depending on platform/features you enable, the app may request:
- Camera (capture proof media)
- Photo/video library access (attach proof media)
- Microphone (record proof videos)
- Notification permission (push alerts)

These permissions are optional but some features will not work without them.

## 6. Cookies and Similar Technologies

We use essential cookies for authentication/session continuity and security flows. We do not currently use third-party advertising trackers in app code.

## 7. Security

We use reasonable safeguards, including access controls, row-level database policies, encrypted Google token storage, signed upload flows, and security headers. No method of transmission or storage is 100% secure.

## 8. International Processing

Our primary database and authentication infrastructure runs on Supabase, hosted in the EU (Ireland, AWS eu-west-1). User account data, task data, and proof media are stored in this EU region.

Other service providers (such as Trigger.dev, Resend, and Google APIs) may process data in additional countries. By using Vouch, you understand that some data may be transferred and processed outside your country by these providers.

## 9. Your Choices and Rights

Inside the app, you can:
- Update profile and notification preferences
- Manage friends and voucher visibility settings
- Connect/disconnect Google Calendar
- Opt in/out of Orca AI voucher features
- Delete your account

Depending on where you live, you may also have legal rights to access, correct, delete, or restrict processing of your personal data.

## 10. Children's Privacy

Vouch is not intended for children under 13 (or the minimum age required in your jurisdiction). If you believe a child provided personal data, contact us so we can remove it.

## 11. Changes to This Policy

We may update this Privacy Policy from time to time. We will update the effective date above and post the latest version in the app/repository.

## 12. Contact

For privacy requests or questions, contact the Vouch team using your official project support channel.
