import Link from "next/link";
import { ArrowLeftIcon, GuardIcon, HoldIcon, SealCheckIcon } from "@/components/icons";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#050507] text-[#ededed] py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Navigation Back */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-[#a8ff35] transition-colors group"
        >
          <ArrowLeftIcon className="w-4 h-4 transition-transform duration-300 group-hover:-translate-x-1" />
          Back to D&apos;accord Platform
        </Link>

        {/* Header */}
        <div className="space-y-4 border-b border-white/10 pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider bg-white/5 border border-white/10 text-[#a8ff35]">
            <GuardIcon className="w-3.5 h-3.5" />
            Privacy
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Privacy Policy
          </h1>
          <p className="text-neutral-400 text-sm">
            Last updated: October 24, 2026
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-8 text-neutral-300 leading-relaxed text-sm sm:text-base">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <HoldIcon className="w-5 h-5 text-[#a8ff35]" />
              1. Overview
            </h2>
            <p>
              D&apos;accord is a hackathon prototype run by Dorien Van den Abbeele (hero-apps.com). It has no user accounts and no database: contracts,
              submissions and results live in your browser session and in the requests described below.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <SealCheckIcon className="w-5 h-5 text-[#a8ff35]" />
              2. What is processed
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-neutral-400">
              <li>
                <strong className="text-neutral-200">Contract text:</strong> job descriptions you type are sent to Anthropic&apos;s Claude API to draft milestones.
              </li>
              <li>
                <strong className="text-neutral-200">Submissions:</strong> pull request URLs are read from the public GitHub API; the diff, any code or notes you paste,
                and CI results are sent to the Claude API for grading. Staging URLs you enter are requested once to check that they respond.
              </li>
              <li>
                <strong className="text-neutral-200">Payments:</strong> checkout runs in PayPal&apos;s own window, so card and bank details never reach D&apos;accord.
                The server handles PayPal order, authorization, capture and payout IDs and the payout recipient&apos;s email.
              </li>
              <li>
                <strong className="text-neutral-200">Logs:</strong> the hosting provider (Vercel) keeps standard request logs. Webhook events from PayPal are logged
                for reconciliation.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">3. Third parties</h2>
            <p>
              PayPal (payments), Anthropic (AI grading), GitHub (reading public pull requests) and Vercel (hosting) each handle data under their own
              privacy policies. Don&apos;t submit private or confidential code to this prototype.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">4. Your requests</h2>
            <p>
              Because nothing is stored in a D&apos;accord database, there is usually nothing to delete. For questions or removal of log data, email the
              address below.
            </p>
          </section>

          <section className="space-y-3 border-t border-white/10 pt-8">
            <h2 className="text-xl font-semibold text-white">
              5. Contact
            </h2>
            <p className="text-neutral-400">
              Questions about this policy or security reports:
            </p>
            <div className="p-4 rounded-xl bg-[#0c0c0f] border border-white/10 space-y-1 text-sm font-mono text-neutral-300">
              <p>Email: <a href="mailto:support@hero-apps.com" className="text-[#a8ff35] hover:underline">support@hero-apps.com</a></p>
              <p>Site: hero-apps.com</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
