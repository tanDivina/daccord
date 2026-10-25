import Link from "next/link";
import { ArrowLeftIcon, GuardIcon, HoldIcon, SealCheckIcon } from "@/components/icons";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#F7F1E3] text-[#1A160F] py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Navigation Back */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-[#6B6353] hover:text-[#44560A] transition-colors group"
        >
          <ArrowLeftIcon className="w-4 h-4 transition-transform duration-300 group-hover:-translate-x-1" />
          Back to D&apos;accord Platform
        </Link>

        {/* Header */}
        <div className="space-y-4 border-b border-[#1A160F]/15 pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider bg-[#1A160F]/5 border border-[#1A160F]/15 text-[#44560A]">
            <GuardIcon className="w-3.5 h-3.5" />
            Privacy
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#1A160F]">
            Privacy Policy
          </h1>
          <p className="text-[#6B6353] text-sm">
            Last updated: October 24, 2026
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-8 text-[#4A443A] leading-relaxed text-sm sm:text-base">
          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-[#1A160F] flex items-center gap-2">
              <HoldIcon className="w-5 h-5 text-[#44560A]" />
              1. Overview
            </h2>
            <p>
              D&apos;accord is a hackathon prototype run by Dorien Van den Abbeele (hero-apps.com). It has no user accounts and no database: contracts,
              submissions and results live in your browser session and in the requests described below.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-[#1A160F] flex items-center gap-2">
              <SealCheckIcon className="w-5 h-5 text-[#44560A]" />
              2. What is processed
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-[#6B6353]">
              <li>
                <strong className="text-[#1A160F]">Contract text:</strong> job descriptions you type are sent to Anthropic&apos;s Claude API to draft milestones.
              </li>
              <li>
                <strong className="text-[#1A160F]">Submissions:</strong> pull request URLs are read from the public GitHub API; the diff, any code or notes you paste,
                and CI results are sent to the Claude API for grading. Staging URLs you enter are requested once to check that they respond.
              </li>
              <li>
                <strong className="text-[#1A160F]">Payments:</strong> checkout runs in PayPal&apos;s own window, so card and bank details never reach D&apos;accord.
                The server handles PayPal order, authorization, capture and payout IDs and the payout recipient&apos;s email.
              </li>
              <li>
                <strong className="text-[#1A160F]">Logs:</strong> the hosting provider (Vercel) keeps standard request logs. Webhook events from PayPal are logged
                for reconciliation.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-[#1A160F]">3. Third parties</h2>
            <p>
              PayPal (payments), Anthropic (AI grading), GitHub (reading public pull requests) and Vercel (hosting) each handle data under their own
              privacy policies. Don&apos;t submit private or confidential code to this prototype.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-[#1A160F]">4. Your requests</h2>
            <p>
              Because nothing is stored in a D&apos;accord database, there is usually nothing to delete. For questions or removal of log data, email the
              address below.
            </p>
          </section>

          <section className="space-y-3 border-t border-[#1A160F]/15 pt-8">
            <h2 className="font-display text-xl font-semibold text-[#1A160F]">
              5. Contact
            </h2>
            <p className="text-[#6B6353]">
              Questions about this policy or security reports:
            </p>
            <div className="p-4 rounded-xl bg-[#F1EAD8] border border-[#1A160F]/15 space-y-1 text-sm font-mono text-[#4A443A]">
              <p>Email: <a href="mailto:support@hero-apps.com" className="text-[#44560A] hover:underline">support@hero-apps.com</a></p>
              <p>Site: hero-apps.com</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
