# D'accord

> **Agreed. Verified. Settled.** Built for the PayPal AI Hackathon 2026.

Freelance milestone payments that don't wait on a silent client. The client's funds are held with PayPal when the milestone starts. When the freelancer delivers, D'accord checks the work against criteria both sides agreed on up front, using the real pull request, CI results and a live URL. If it passes, the money goes to the freelancer's PayPal.

## How it works

1. **Agree on criteria.** Pick a sample contract, or describe a job and Claude drafts milestones with pass/fail criteria (`/api/contract/parse`).
2. **Hold the funds.** The client approves a PayPal order with `intent: AUTHORIZE` for the milestone in the PayPal Buttons popup (`/api/escrow/create`, `/api/escrow/authorize`). Nothing is charged yet. PayPal honors an authorization for 3 days and keeps it valid for 29.
3. **Verify the work** (`/api/verify`):
   - The server collects its own evidence. It reads the PR diff and CI check runs from the GitHub API and probes the staging URL (https and public hosts only).
   - Deterministic screens halt on known injection phrases and tautological tests such as `expect(true).toBe(true)`.
   - Two Claude passes run in parallel. An evaluator grades each criterion, and an adversarial reviewer looks for mocks, stubs and gaps. A criterion passes only if both agree. All submitted content is wrapped as untrusted data.
   - On a pass, the server signs a 30-minute **attestation** (HMAC-SHA256). It fixes the milestone, the amount (read back from the PayPal authorization), the recipient and the authorization ID.
4. **Pay out** (`/api/payout`). This step accepts only a valid attestation. It captures the authorization, then sends the amount with PayPal Payouts. The `sender_batch_id` comes from the evidence hash, so PayPal rejects a second payout for the same verification.
5. **Disputes** (`/api/dispute`). Claude sorts a client's revision request into in-scope defects and out-of-scope expansion, and drafts criteria for an add-on milestone. The price is left to the parties.

PayPal webhooks arrive at `/api/paypal/webhook` and are checked with `verify-webhook-signature` before they are logged.

## Modes

Every response says where its result came from, and the header shows the current mode:

| Missing config | What happens |
|---|---|
| PayPal keys | Funding and payouts are **simulated**, with `SIM-` IDs and a "simulated" label. |
| `ANTHROPIC_API_KEY` | Verification is **rule-based only**. CI and endpoint criteria are judged from GitHub and the probe; code-review criteria can't pass, so the payout stays locked. Custom contracts are off. |
| `DACCORD_SIGNING_SECRET` (production) | Payouts are disabled. |

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev
```

For sandbox testing, create a REST app plus a sandbox **business** account (the platform) and a **personal** account (the client) at [developer.paypal.com](https://developer.paypal.com/). Use the personal account in the checkout popup. For the payout recipient, enter the email of another sandbox personal account.

## Not built yet

- No database, so contract and milestone state lives in the browser. Webhook events are logged, not stored.
- Auto-release after a silent-client window (the "48-hour rule") is a design goal, not code. It would need persisted state and a scheduled job that runs before the authorization expires.
- In sandbox, captured funds land in the platform's account and the payout comes out of that account's balance. A production version would use PayPal's platform/marketplace onboarding instead of holding funds itself.

## License

[MIT](LICENSE)
