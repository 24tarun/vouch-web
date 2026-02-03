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
      <section className="pt-32 pb-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-block mb-6 px-4 py-1 rounded bg-slate-900 border border-slate-800">
            <span className="text-xs text-slate-400 uppercase tracking-widest font-medium">
              TASK ACCOUNTABILITY SYSTEM by{" "}
              <a
                href="#footer"
                className="hover:text-white transition-colors"
              >
                Tarun Hariharan
              </a>
            </span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight tracking-tighter">
            Accountability with <br />
            <span className="text-slate-400">Real Stakes.</span>
          </h1>
          <p className="text-lg text-slate-400 mb-10 max-w-xl mx-auto leading-relaxed">
            Set commitments. Assign vouchers. Face consequences. When you fail,
            your money goes to charity. Pure accountability.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login?mode=signup">
              <Button
                size="lg"
                className="bg-slate-200 hover:bg-white text-slate-900 font-bold text-base px-8 py-6 rounded"
              >
                Sign Up Now
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-16 tracking-tight">
            How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-12">
            <div className="text-left">
              <div className="text-slate-500 font-mono text-sm mb-4">01.</div>
              <h3 className="text-lg font-bold text-white mb-3">
                Create a Task
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Set your commitment, deadline, and failure cost (€0.01 - €100).
              </p>
            </div>
            <div className="text-left">
              <div className="text-slate-500 font-mono text-sm mb-4">02.</div>
              <h3 className="text-lg font-bold text-white mb-3">
                Add friends and assign them as vouchers for any of your tasks
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                A voucher verifies completion. You prove it through whatever means, just convince them you have done it. They can either accept or deny.
              </p>
            </div>
            <div className="text-left">
              <div className="text-slate-500 font-mono text-sm mb-4">03.</div>
              <h3 className="text-lg font-bold text-white mb-3">
                If you fail the deadline or if your vouchers deny your task, failure costs you the failure cost that you set
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                At the end of the month, your total failure costs are donated to a charity of your choice.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4 border-y border-slate-900 bg-slate-950/50">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12">
            <div>
              <h3 className="text-lg font-bold text-white mb-2">
                Irreversible Deadlines
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Once activated, deadlines are final. No extensions. No excuses. One 60-minute postponement per task.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white mb-2">
                Social Verification
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Trust but verify. Your vouchers decide the outcome. Peer-to-peer accountability.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white mb-2">
                Real Financial Stakes
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                The sting of loss is a powerful motivator. Stake what you can afford to lose.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white mb-2">
                Limited Safety Nets
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                5x Rectify passes and 1x Force majeure per month. Use them wisely.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer id="footer" className="py-12 px-4 border-t border-slate-900">
        <div className="max-w-5xl mx-auto flex flex-col items-center justify-center gap-4 text-slate-500">
          <p className="text-sm text-slate-400 mb-2">Reach out to me via:</p>
          <div className="flex items-center justify-center gap-6">
            <a
              href="mailto:tarun2k01@gmail.com"
              className="hover:text-white transition-colors"
              aria-label="Email"
            >
              <Mail size={20} />
            </a>
            <a
              href="https://www.linkedin.com/in/tarun2k01"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
              aria-label="LinkedIn"
            >
              <Linkedin size={20} />
            </a>
            <a
              href="https://tarunh.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
              aria-label="Personal Website"
            >
              <Globe size={20} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

