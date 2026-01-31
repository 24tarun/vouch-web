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

To test background jobs (like deadline warnings) locally:

1.  Login to Trigger.dev CLI:
    ```bash
    npx trigger.dev@latest login
    ```
2.  Run the dev command to forward runs to your local machine:
    ```bash
    npx trigger.dev@latest dev
    ```

This will start a tunnel and allow your local Trigger.dev tasks to execute.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **Emails**: Resend
- **Jobs**: Trigger.dev
- **Styling**: Tailwind CSS
