import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Linkedin, Mail, Globe } from "lucide-react";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-slate-950/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded bg-slate-200 flex items-center justify-center">
              <span className="text-xs font-bold text-slate-900">TAS</span>
            </div>
            <span className="text-lg font-bold tracking-tight text-white">TAS</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login">
              <Button
                variant="ghost"
                className="text-slate-400 hover:text-white"
              >
                Sign In
              </Button>
            </Link>
            <Link href="/login?mode=signup">
              <Button className="bg-slate-200 hover:bg-white text-slate-900 font-semibold border-none">
                Sign Up
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-6 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex flex-wrap items-center justify-center gap-3 mb-6 px-3 sm:px-4 py-1">
            <span className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-widest font-medium">
              TASK ACCOUNTABILITY SYSTEM by{" "}
              <span className="text-slate-300">Tarun Hariharan</span>
            </span>
            <div className="flex items-center gap-3 text-slate-400">
              <a
                href="mailto:tarun2k01@gmail.com"
                className="hover:text-white transition-colors"
                aria-label="Email"
              >
                <Mail size={25} />
              </a>
              <a
                href="https://www.linkedin.com/in/tarun2k01"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
                aria-label="LinkedIn"
              >
                <Linkedin size={25} />
              </a>
              <a
                href="https://tarunh.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
                aria-label="Personal Website"
              >
                <Globe size={25} />
              </a>
            </div>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight tracking-tighter px-4">
            Accountability with <br />
            <span className="text-slate-400">Real Stakes.</span>
          </h1>
          <p className="text-base sm:text-lg text-slate-400 mb-4 max-w-xl mx-auto leading-relaxed px-4">
            A system that costs you money when you fail to complete your tasks. Studies show that introducing financial stakes significantly increases the likelihood of task completion.
          </p>
        </div>
      </section>

      {/* Unified System Section */}
      <section className="pt-2 pb-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-xl sm:text-2xl font-bold text-white text-center mb-6 sm:mb-8 tracking-tight">
            System Overview
          </h2>

          <div className="space-y-5 sm:space-y-6">
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 sm:p-6">
              <h3 className="text-base sm:text-lg font-bold text-white mb-4 tracking-tight">
                How It Works
              </h3>
              <ol className="space-y-2 text-sm sm:text-[15px] font-mono text-slate-300">
                <li>1. Create a task, set deadline,failure_cost,repitions,voucher</li>
                <li>2. Use the VFD clock inspired pomodoro timer to focus</li>
                <li>3. submit your task for verification and prove to your voucher that you have done it</li>
                <li>4. voucher accepts or denies</li>
                <li>5. if denied you get fined your preset failure cost for that task</li>
                <li>6. end of month ledger is calculated</li>
                <li>7. TODO : automatic debit towards a charity of choice.</li>
              </ol>
            </div>

            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 sm:p-6">
              <h3 className="text-base sm:text-lg font-bold text-white mb-4 tracking-tight">
                Feature List
              </h3>
              <ol className="space-y-2 text-sm sm:text-[15px] font-mono text-slate-300">
                <li>1. Symmetric and reflective friendships</li>
                <li>2. Realtime polling and publishing tables</li>
                <li>3. Pomodoro timer with session logging</li>
                <li>4. NLP Parsing of task titles</li>
              </ol>
            </div>

            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 sm:p-6">
              <h3 className="text-base sm:text-lg font-bold text-white mb-4 tracking-tight">
                Engineering Choices
              </h3>
              <ol className="space-y-2 text-sm sm:text-[15px] font-mono text-slate-300">
                <li>1. Supabase for auth and Postgres</li>
                <li>2. Client polls server for real-time updates</li>
                <li>3. cron jobs for notifications run on trigger.dev</li>
                <li>4. Email notifications using resend API</li>
                <li>5. PWA and Web Push notifications</li>
                <li>6. Deployed on Vercel, thanks to the vercel gods</li>
                <li>7. Gemini 3 Flash and Codex 5.3 for AI help</li>
              </ol>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}

