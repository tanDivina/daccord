# D'accord — Devpost submission draft

> Paste-ready draft for paypalaihackathon.devpost.com (deadline Nov 12 PT).
> Everything below states only what the app actually does; simulated parts are named.

## Tagline (one line)

Agreed. Verified. D'accord. — AI-verified milestone payments: the client's money is held with PayPal up front and released the minute the work provably meets the criteria both sides signed.

## Inspiration

Freelancers Union's national survey found that 71% of freelancers have had trouble getting paid, the average longest wait to get paid is 98 days, and the average loss to nonpayment is $5,968 a year — 13% of income. The work gets done; the payment waits. Marketplaces "solve" this with a review window (14 days on Upwork) that still depends on a silent client clicking a button. We wanted the release decision to depend on evidence instead of mood.

## What it does

D'accord runs a four-step settlement protocol for freelance milestones:

1. **Agree on checkable criteria.** Each milestone gets pass/fail criteria before work starts. Claude can draft them from a plain-language job description and budget.
2. **Hold the funds.** The client approves a PayPal Orders v2 order with intent AUTHORIZE — money is held, nothing is charged.
3. **Verify the work.** The freelancer submits a real GitHub PR, a staging URL and notes. The verifier reads the actual PR diff and CI check runs from the GitHub API and probes the staging URL itself — then two parallel Claude passes grade each criterion: an evaluator and an adversarial skeptic hunting for mocks, stubs and prompt injection. A criterion passes only if both agree.
4. **Pay out, exactly once.** A pass produces an HMAC-signed, 30-minute attestation fixing amount, recipient and authorization ID. The payout endpoint accepts nothing else; it captures the authorization and sends a PayPal Payout whose batch ID is derived from the evidence hash, so one verification can never pay twice.

The **Threat lab** lets judges try to cheat it live: prompt injection in code comments, a polite "note to the reviewer" that keyword filters miss, tautological tests, and client scope creep (which gets classified and turned into a drafted add-on milestone instead of blocking payment for verified work).

The **Ledger** tab is an AG Grid audit trail of the session: each agreed criterion, PayPal authorization, Claude verdict, blocked attack and payout is one row, with column filters, quick search and CSV export. You can ask it questions in plain language, such as "criteria the skeptic rejected" or "real PayPal events over $1,000". Claude answers with an AG Grid filter model and sort, so the grid itself shows the answer. The rows never leave the browser; only the question and the milestone titles are sent.

PayPal webhooks arrive at /api/paypal/webhook and are verified with PayPal's verify-webhook-signature API before being trusted.

## How we built it

- **Next.js 14 + TypeScript** on Vercel, live at https://daccord.hero-apps.com
- **PayPal sandbox**: Orders v2 (AUTHORIZE → capture), Payouts v1, Webhooks with signature verification
- **Claude (Anthropic API)**: contract drafting, dual-reviewer milestone verification (evaluator + skeptic), dispute classification
- **AG Grid Community** (ag-grid-react 36): the audit ledger, themed to the app with the Theming API, with custom status and source cell renderers, text and number column filters, quick filter and CSV export; Claude sets its filter model from plain-language questions
- **Evidence pipeline**: GitHub PR diff + CI check runs + live staging probe, hashed (SHA-256) into the signed attestation
- The demo verifies a real open PR on a real microservice repo (github.com/tanDivina/paypal-orders-service, PR #1, CI green) with a live staging health endpoint.

## Honesty notes (what's real vs. simulated)

- Verification, PR/CI evidence, staging probes, attestations and webhook signature checks are real.
- PayPal runs in sandbox. In the recorded demo, funding/payout use a clearly labeled "SIMULATED" mode (headless recording can't do the PayPal login popup); the live app does real sandbox checkout with PayPal Buttons when you log in with a sandbox account.
- Every panel in the UI labels its mode (PayPal sandbox/simulated, AI: Claude/rules).

## Challenges

- Making an AI verifier that can't be sweet-talked: the single-reviewer version passed a "criteria were waived by the client" comment; the adversarial second pass catches it.
- Exactly-once payouts: deriving the Payouts batch ID from the evidence hash makes retries idempotent at PayPal's end.
- Honest demos: simulated modes are labeled in-frame rather than hidden.

## Accomplishments

- A full escrow → evidence → dual-AI verdict → signed release → payout loop against real PayPal sandbox APIs.
- A threat lab where you can attack the verifier yourself.
- A brand with a face: Le Maître d'accord, the monocled maître d'/notary who serves the verdict seal.

## What's next

- Auto-release after a silent-client window (the "48-hour rule") with persisted state and scheduled jobs.
- Multi-milestone escrow across a whole contract; dispute escalation flows.
- Marketplace integrations.

## Links

- Live app: https://daccord.hero-apps.com
- Repo: https://github.com/tanDivina/daccord
- Demo deliverable (real PR the verifier grades): https://github.com/tanDivina/paypal-orders-service/pull/1
- Video: (YouTube link once uploaded)

## Suggested tags

paypal, payments, escrow, ai-agents, claude, ag-grid, nextjs, typescript, fintech, freelance
