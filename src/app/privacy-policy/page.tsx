export const metadata = {
    title: "Privacy Policy | Vouch",
};

const sections = [
    {
        title: "What Vouch Collects",
        body: [
            "When you use Vouch, we collect the account details needed to run the app, such as your email address, username, profile settings, friendships, voucher preferences, tasks, deadlines, proof requests, proof uploads, pomo activity, ledger entries, and app settings.",
            "If you connect Google Calendar, Vouch stores the tokens and calendar sync preferences needed to create, update, or remove the calendar events you requested.",
        ],
    },
    {
        title: "How Vouch Uses Data",
        body: [
            "Vouch uses your data to create and manage tasks, assign vouchers, show friend activity when you enable it, process proof and voucher decisions, calculate app stats, send reminders, and keep your devices in sync.",
            "We do not sell your personal data.",
        ],
    },
    {
        title: "Friend And Voucher Visibility",
        body: [
            "Friends and vouchers may see task information that is necessary for the social accountability features you choose to use. This can include task titles, task status, task deadlines, voucher deadlines, proof request state, and active-task visibility when you enable that setting.",
            "You can update friend, voucher, and active-task visibility settings from the app settings screen.",
        ],
    },
    {
        title: "Proof Media",
        body: [
            "If you upload proof photos, videos, or related media, Vouch stores that media so the assigned voucher or permitted reviewer can evaluate the task.",
            "Camera, microphone, and photo library access are only used when you choose to capture or attach proof media.",
        ],
    },
    {
        title: "Data Storage And Providers",
        body: [
            "Vouch uses service providers such as Supabase for authentication, database storage, realtime updates, and file storage. These providers process data only as needed to operate the app.",
            "Some app features may use email, push notification, calendar, or background job providers to deliver the functionality you enable.",
        ],
    },
    {
        title: "Your Choices",
        body: [
            "You can update your profile, settings, friendships, voucher preferences, Google Calendar sync, and notification preferences in the app.",
            "You can request account deletion from settings. When deletion is completed, Vouch removes or anonymizes account-linked data according to the app's deletion flow and any records that must be kept for security, abuse prevention, or operational integrity.",
        ],
    },
    {
        title: "Contact",
        body: [
            "For privacy questions or deletion requests that cannot be completed inside the app, contact the Vouch maintainer through the support channel provided with the app.",
        ],
    },
];

export default function PrivacyPolicyPage() {
    return (
        <main className="min-h-dvh bg-slate-950 px-5 py-10 text-slate-50">
            <article className="mx-auto max-w-3xl space-y-8">
                <header className="space-y-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">Vouch</p>
                    <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Privacy Policy</h1>
                    <p className="text-sm text-slate-400">Last updated: June 11, 2026</p>
                </header>

                <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-5 leading-7 text-slate-300">
                    <p>
                        This Privacy Policy explains how Vouch handles information when you use the app. Vouch is built
                        around tasks, vouchers, proof, friend activity, and optional integrations, so the app stores the
                        information needed to make those features work.
                    </p>
                </section>

                <div className="space-y-7">
                    {sections.map((section) => (
                        <section key={section.title} className="space-y-3">
                            <h2 className="text-xl font-semibold text-slate-100">{section.title}</h2>
                            <div className="space-y-3 leading-7 text-slate-300">
                                {section.body.map((paragraph) => (
                                    <p key={paragraph}>{paragraph}</p>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </article>
        </main>
    );
}
