import Link from "next/link";
import { ArrowLeft, ShieldCheck, Lock, CheckCircle2 } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#050507] text-[#ededed] py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Navigation Back */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-[#a8ff35] transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 transition-transform duration-300 group-hover:-translate-x-1" />
          Back to D&apos;accord Platform
        </Link>

        {/* Header */}
        <div className="space-y-4 border-b border-white/10 pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider bg-white/5 border border-white/10 text-[#a8ff35]">
            <ShieldCheck className="w-3.5 h-3.5" />
            Privacy & Trust Architecture
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Privacy Policy & Security Standards
          </h1>
          <p className="text-neutral-400 text-sm">
            Effective Date: October 24, 2026 • Last Updated: October 2026 • Reference: D&apos;accord Protocol v1.4
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-8 text-neutral-300 leading-relaxed text-sm sm:text-base">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Lock className="w-5 h-5 text-[#a8ff35]" />
              1. Overview & Data Philosophy
            </h2>
            <p>
              D&apos;accord (&quot;we&quot;, &quot;our&quot;, or &quot;the Protocol&quot;) operates an autonomous, milestone-based contract settlement network integrated with the PayPal Developer Platform. We believe in radical data minimization: our AI verification engines operate inside zero-retention ephemeral sandboxes, and financial credentials are never touched directly by our servers.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-[#a8ff35]" />
              2. Data We Collect and Process
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-neutral-400">
              <li>
                <strong className="text-neutral-200">Contract & Milestone Metadata:</strong> Deliverable descriptions, milestones, acceptance criteria, and cryptographic state hashes.
              </li>
              <li>
                <strong className="text-neutral-200">Public Code Repositories & Artifacts:</strong> Git pull request URLs, CI build logs, and deploy status endpoints submitted voluntarily for automated verification.
              </li>
              <li>
                <strong className="text-neutral-200">Payment Routing Tokens:</strong> PayPal Order IDs, Payout Batch IDs, and masked receiver emails necessary for transaction reconciliation via PayPal Sandbox and REST APIs. We never store or transmit raw credit card numbers or banking credentials.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              3. Secure OAuth & PayPal Credentials Usage
            </h2>
            <p>
              All payments, escrow holds, and automated disbursements are executed via official, authenticated PayPal REST API endpoints (Orders v2 and Payouts v1). Sessions use TLS 1.3 cryptographic tunneling, and all webhooks are verified against PayPal root certificates using SHA-256 HMAC digital signatures.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              4. Air-Gapped Code Inspection & AI Privacy
            </h2>
            <p>
              When code deliverables or build logs are submitted for milestone verification, they are inspected inside air-gapped memory buffers. Your proprietary source code is never used to train generalized foundation models, and all inspection memory is wiped immediately after generating the cryptographic verification receipt.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              5. GDPR & CCPA Compliance
            </h2>
            <p>
              In accordance with European General Data Protection Regulation (GDPR) and California Consumer Privacy Act (CCPA) standards, users retain full rights to request audit logs, data deletion, or export of their contract transaction history at any time by contacting our security team.
            </p>
          </section>

          <section className="space-y-3 border-t border-white/10 pt-8">
            <h2 className="text-xl font-semibold text-white">
              6. Contact Information
            </h2>
            <p className="text-neutral-400">
              For security disclosures, compliance inquiries, or questions regarding this policy:
            </p>
            <div className="p-4 rounded-xl bg-[#0c0c0f] border border-white/10 space-y-1 text-sm font-mono text-neutral-300">
              <p>Email: <a href="mailto:support@hero-apps.com" className="text-[#a8ff35] hover:underline">support@hero-apps.com</a></p>
              <p>Domain: hero-apps.com / daccord.hero-apps.com</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
