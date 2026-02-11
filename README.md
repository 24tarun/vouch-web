# Vouch

This README documents the steps to run the **Vouch** application locally.

## Prerequisites

- **Node.js** (v18 or higher recommended)
- **pnpm** (preferred) or npm
- **Supabase Account** & Project
- **Resend Account** (for emails)
- **Trigger.dev Account** (for background jobs)

## 1. Environment Setup

Create a `.env.local` file in the root directory:

```bash
cp .env.local.example .env.local
```

Populate it with your keys:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Resend (Emails)
RESEND_API_KEY=re_123456789

# Web Push (VAPID)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key
VAPID_SUBJECT=mailto:you@yourdomain.com

# Trigger.dev (Background Jobs)
TRIGGER_SECRET_KEY=tr_dev_123456789
NEXT_PUBLIC_TRIGGER_PUBLIC_API_KEY=tr_pub_123456789
TRIGGER_API_URL=https://api.trigger.dev # Optional, defaults to cloud
```

## 2. Install Dependencies

```bash
npm install
# or
pnpm install
```

## 3. Database Setup (Supabase)

1.  Run the migrations in the `supabase/migrations` folder against your Supabase project (using the Supabase Dashboard SQL Editor or CLI).
2.  Ensure your database schema matches the types expected by the application.

## 4. Run Development Server

Start the Next.js development server:

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

## 5. Run Trigger.dev (Background Jobs)

To test background jobs (like task reminders and deadline warnings) locally:

1.  Login to Trigger.dev CLI:
    ```bash
    npx trigger.dev@latest login
    ```
2.  Run the dev command to forward runs to your local machine:
    ```bash
    npx trigger.dev@latest dev
    ```

This will start a tunnel and allow your local Trigger.dev tasks to execute.

## 6. Deploying Trigger.dev Tasks to Production

When you make changes to trigger files (`src/trigger/*`) or environment variables:

### Deploy Tasks

```bash
npx trigger.dev@latest deploy
```

### Set Environment Variables in Trigger.dev Dashboard

1. Go to [Trigger.dev Dashboard](https://cloud.trigger.dev)
2. Navigate to your project → **Settings** → **Environment Variables**
3. Add the following variables for **production**:
   - `NEXT_PUBLIC_SUPABASE_URL` = Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = Your Supabase secret/service role key
   - `RESEND_API_KEY` = Your Resend API key
   - `NEXT_PUBLIC_APP_URL` = Your production URL (e.g., `https://tas.tarunh.com`)
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = Your VAPID public key
   - `VAPID_PRIVATE_KEY` = Your VAPID private key
   - `VAPID_SUBJECT` = Mailto/contact subject, e.g. `mailto:you@yourdomain.com`

### Test Your Tasks

1. Go to Trigger.dev Dashboard → **Tasks**
2. Find your task (e.g., `task-reminder-notify`, `monthly-settlement`)
3. Click **"Test"** to manually trigger it
4. Check **Runs** tab for execution logs

**Scheduled Tasks:**
- `task-reminder-notify`: Runs every minute (sends due custom reminders, a default 1-hour warning, and an optional default 5-minute final warning based on user settings)
- `voucher-deadline-warning`: Runs at 09:00, 12:00, 15:00, 18:00, 21:00 UTC (daily digest of pending vouch requests, max once per voucher per UTC day)
- `voucher-timeout`: Runs every hour (auto-accepts overdue awaiting-voucher tasks, adds €0.30 voucher timeout penalty, and cleans proof media)
- `monthly-settlement`: Runs on 1st of each month at 9am (sends ledger settlement emails)

Voucher review window:
- Vouchers have 7 days to respond after task submission.
- No immediate push/email is sent at submission time.



VISIT tas.tarunh.com to see the app
