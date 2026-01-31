import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-slate-900/50 backdrop-blur-sm border-b border-slate-700/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <span className="text-sm font-bold text-white">V</span>
            </div>
            <span className="text-lg font-semibold text-white">Vouch</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login">
              <Button
                variant="ghost"
                className="text-slate-300 hover:text-white"
              >
                Sign In
              </Button>
            </Link>
            <Link href="/login">
              <Button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
                Get Started
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-block mb-6 px-4 py-1 rounded-full bg-purple-500/20 border border-purple-500/30">
            <span className="text-sm text-purple-300">
              💜 Failure helps the world
            </span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
            Accountability with{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
              Real Stakes
            </span>
          </h1>
          <p className="text-xl text-slate-400 mb-8 max-w-2xl mx-auto">
            Set commitments. Assign vouchers. Face consequences. When you fail,
            your money goes to charity instead of your pocket.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login">
              <Button
                size="lg"
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-lg px-8"
              >
                Start Your First Task
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-12">
            How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center p-6 rounded-2xl bg-slate-800/30 border border-slate-700/50">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-2xl">
                1
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">
                Create a Task
              </h3>
              <p className="text-slate-400">
                Set your commitment, deadline, and financial stake (€0.01 - €100)
              </p>
            </div>
            <div className="text-center p-6 rounded-2xl bg-slate-800/30 border border-slate-700/50">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-2xl">
                2
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">
                Assign a Voucher
              </h3>
              <p className="text-slate-400">
                Your friend verifies completion. No one can lie to themselves.
              </p>
            </div>
            <div className="text-center p-6 rounded-2xl bg-slate-800/30 border border-slate-700/50">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center text-2xl">
                3
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">
                Complete or Donate
              </h3>
              <p className="text-slate-400">
                Succeed and celebrate. Fail and donate to charity. Win-win.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4 bg-slate-900/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-12">
            Built for Real Accountability
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-6 rounded-2xl bg-slate-800/30 border border-slate-700/50">
              <h3 className="text-lg font-semibold text-white mb-2">
                ⏰ Irreversible Deadlines
              </h3>
              <p className="text-slate-400">
                Once activated, deadlines cannot be extended. One postponement
                (max 1 hour) per task. That&apos;s it.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-slate-800/30 border border-slate-700/50">
              <h3 className="text-lg font-semibold text-white mb-2">
                👥 Social Verification
              </h3>
              <p className="text-slate-400">
                Friends as vouchers. They decide if you actually completed the
                task. No self-reporting.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-slate-800/30 border border-slate-700/50">
              <h3 className="text-lg font-semibold text-white mb-2">
                💰 Real Financial Stakes
              </h3>
              <p className="text-slate-400">
                Stake €0.01 to €100 per task. Monthly ledger tracks your
                accountability.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-slate-800/30 border border-slate-700/50">
              <h3 className="text-lg font-semibold text-white mb-2">
                🔄 Limited Safety Nets
              </h3>
              <p className="text-slate-400">
                5 rectify passes per month. 1 force majeure. Use them wisely.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-white mb-4">
            Ready to Hold Yourself Accountable?
          </h2>
          <p className="text-xl text-slate-400 mb-8">
            The worst case: you donate to charity and make the world better.
          </p>
          <Link href="/login">
            <Button
              size="lg"
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-lg px-8"
            >
              Get Started Free
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-700/50 py-8 px-4">
        <div className="max-w-6xl mx-auto text-center text-slate-500 text-sm">
          <p>© 2026 Vouch. Built for accountability, not profit.</p>
        </div>
      </footer>
    </div>
  );
}
