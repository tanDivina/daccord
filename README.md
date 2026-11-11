# D'accord

> **Agreed. Verified. Settled.** Built for the PayPal AI Hackathon 2026.

**Live demo:** https://daccord.hero-apps.com (PayPal sandbox + Claude)

Freelance milestone payments that don't wait on a silent client. The client's funds are held with PayPal when the milestone starts. When the freelancer delivers, D'accord checks the work against criteria both sides agreed on up front, using the real pull request, CI results and a live URL. If it passes, the client gets a short review window to approve or object with reasons, and the money then goes to the freelancer's PayPal. Silence releases it.

## How it works

1. **Agree on criteria.** Pick a sample contract, or describe a job and Claude drafts milestones with pass/fail criteria (`/api/contract/parse`).
2. **Hold the funds.** The client enters the contractor's PayPal email, the staging URL (required when a health criterion has no probe URL of its own) and, optionally, the GitHub repository the work must land in, then approves a PayPal order with `intent: AUTHORIZE` for the milestone in the PayPal Buttons popup (`/api/escrow/create`, `/api/escrow/authorize`). Nothing is charged yet. PayPal honors an authorization for 3 days and keeps it valid for 29. The server returns a signed **milestone grant** that fixes the criteria, amount, payee, staging URL and repository (see Security model).
3. **Verify the work** (`/api/verify`):
   - The freelancer sends the grant and a PR URL. Criteria, amount, payee and staging URL come from the grant, never from the request. If the grant names a repository, a PR to any other repository is refused.
   - The server collects its own evidence. It reads the PR diff, the CI check runs (with the app that produced each one), the CI workflow files and the files that define what their commands run (`package.json` scripts, a Makefile, local actions) at the PR's head commit from the GitHub API, and probes the URLs agreed at funding (https and public hosts only).
   - Deterministic screens halt on unreviewable PRs (diff cut for length, files with no readable diff, over 300 files), known injection phrases and tautological tests such as `expect(2).toBe(2)`.
   - Two Claude passes run in parallel. An evaluator grades each criterion, and an adversarial reviewer looks for mocks, stubs, rigged CI and gaps. A criterion passes only if both agree and the platform's own facts (green GitHub Actions checks, a successful probe) do not contradict it. All submitted content, including the workflow files and the client's objections, is wrapped as untrusted data, and any tag inside it that would close that data block is defanged first.
   - On a pass, in PayPal mode the authorization is read back to confirm it is still capturable for the same amount. Then the pass opens the client's **review window** (step 4). It does not pay out by itself.
4. **Review window** (`/api/release/*`). The window length is signed into the grant (`reviewWindowSec`): 48 hours, always, for live PayPal holds. On sandbox and simulated holds the client can pick a labeled "Demo: 2 minutes" window at funding so the auto-release can be watched. During the window:
   - **The client approves** (`/api/release/approve`) and the funds release at once.
   - **The client objects** with written reasons (`/api/release/object`). The scope arbiter (Claude, the same logic as `/api/dispute`) judges the reasons against the criteria signed into the grant, never criteria sent in the request:
     - `IN_SCOPE_DEFECT` or `MIXED`: the release is paused ("changes requested"). The freelancer pushes a new commit and verifies again; a pass opens a fresh window. The in-scope items are shown to both sides.
     - `OUT_OF_SCOPE_EXPANSION`: the objection is recorded and shown, the clock keeps running, and the page shows the add-on milestone the arbiter drafted. New work cannot hold back payment for verified work.
     - At most 2 upheld objections per milestone. A 3rd upheld objection moves the milestone to "escalated": it needs a human arbiter, which is not built yet, so the funds stay held. At most 8 objections per milestone in total, to bound model calls.
   - **The client stays silent.** Once the window has passed, anyone can trigger the release: the status check the page runs every 10 seconds (`/api/release/status`), the freelancer's "Claim payment" button, which unlocks at the release time (`/api/release/claim`), or a daily cron sweep (`/api/cron/release`). Money only ever goes to the payee in the grant.
5. **Pay out.** A release captures the authorization, then sends the amount with PayPal Payouts and reads the payout status once for the receipt. The `sender_batch_id` is derived from the authorization ID, so PayPal rejects a second payout for the same hold, and the capture uses a fixed `PayPal-Request-Id`. On a deployment without a datastore the window is off and `/api/payout` pays right after verification (see Security model).
6. **Disputes outside the window** (`/api/dispute`). The Threat lab calls the same scope arbiter directly. There it is advisory and cannot move funds.

7. **Ledger** (AG Grid). Every agreed criterion, PayPal authorization, verdict, attack and payout from the session lands in an AG Grid audit ledger with filters, quick search and CSV export. Ask it a question in plain language ("criteria the skeptic rejected", "real PayPal events over $1,000") and Claude returns an AG Grid filter model and sort (`/api/ledger/query`). Only the question and milestone titles go to the server, never the rows.

PayPal webhooks arrive at `/api/paypal/webhook` and are checked with `verify-webhook-signature` before they are logged.

## Tools used

| Tool | How it's used |
|---|---|
| PayPal Orders v2 (`intent: AUTHORIZE`), PayPal JS SDK Buttons | Hold the client's money per milestone, then capture it on a verified pass |
| PayPal Payouts v1 | Send the captured amount to the freelancer, idempotent per hold |
| PayPal Webhooks + `verify-webhook-signature` | Receive and check order and payout events |
| Claude Opus 5.5 (Anthropic API, structured outputs) | Drafts contracts and criteria, runs the evaluator and skeptic reviews, judges client objections in the review window, turns ledger questions into grid filters |
| AG Grid Community (`ag-grid-react`) | The audit ledger: custom cell renderers, themed with the Theming API, column filters, quick filter, CSV export, filter model set by Claude |
| GitHub REST API | PR diff, CI check runs and workflow files as evidence |
| Next.js 14 on Vercel (+ Vercel Cron) | App and API routes; a daily sweep releases due review windows |
| Upstash Redis REST (optional) | Review-window records, release locks, retry limits |

## Modes

Every response says where its result came from, and the header shows the current mode:

| Missing config | What happens |
|---|---|
| PayPal keys | Funding and payouts are **simulated**, with `SIM-` IDs and a "simulated" label. |
| `ANTHROPIC_API_KEY` | Verification is **rule-based only**. The response reports the CI checks and probe results, but no criterion can pass because nobody reads the code or the workflow, so the payout stays locked. Custom contracts are off. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or the Vercel marketplace names `KV_REST_API_URL` / `KV_REST_API_TOKEN`) | Retry limits, remembered failures and review-window records are kept **in memory**. Responses include `storage: "memory"` or `"upstash"`, and `/api/release/status` returns `storeMode`. In production on Vercel the review window is then **off**: verification pays out right away, and the page says so. Locally (one `next start` process) the full window runs in memory. |
| `CRON_SECRET` | `/api/cron/release` refuses every call in production. Vercel sends it as a bearer token when it is set. The lazy release (status and claim) still works. |
| `DACCORD_SIGNING_SECRET` (production) | Payouts are disabled. |

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev
```

For sandbox testing, create a REST app plus a sandbox **business** account (the platform) and a **personal** account (the client) at [developer.paypal.com](https://developer.paypal.com/). Use the personal account in the checkout popup. For the payout recipient, enter the email of another sandbox personal account.

## Security model

**Signed at funding.** When the client places the hold, `/api/escrow/authorize` returns a milestone grant: the criteria (with any probe URLs), the amount PayPal actually authorized, the authorization ID, the contractor's PayPal email, the staging URL and the repository (if set), signed with HMAC-SHA256 and valid until the authorization expires (29 days at most). Before the hold, `/api/escrow/create` puts a hash of these terms in the PayPal order's `reference_id`, and authorize refuses to issue a grant if the terms sent with the order ID hash to anything else. So knowing an order ID is not enough to get a grant with other criteria or another payee. Grants, attestations, client keys and any future token kinds are signed under separate labels, so one can never be used as another.

**What the verifier refuses.**
- A tampered or expired grant (403). Criteria, amount, payee and authorization sent in the request body are ignored when a grant is present.
- A grant with no PR URL, or a PR it cannot read (404, private repo). Pasted code is shown to the reviewers as a claim, not as proof, and never replaces the PR.
- A PR to another repository when the grant names one, and a PR that was closed without being merged.
- PR URLs with anything after the PR number. Only the rebuilt `https://github.com/owner/repo/pull/N` reaches the reviewers.
- Probing any URL the client did not agree to. Endpoint criteria use the criterion's probe URL or the staging URL from the grant; a URL in the submission is never probed. An endpoint criterion with neither fails.
- A PR it cannot read in full: diff over 120k characters, changed files with no readable diff (lockfiles, images, fonts and pure renames excepted), or more than 300 files. The answer is to split the milestone into a smaller PR.
- CI checks that do not come from GitHub Actions, failing or pending Actions checks, or green checks when a workflow file at the head commit is missing, unreadable or cut by the size cap. The workflow files and the build files they call go to both reviewers, who are told that a step which only echoes, exits 0 or swallows failures proves nothing, that `npm test` counts only when the `test` script is shown and runs real tests, and that mocks are fine inside tests and fake work anywhere else. Check-run names and workflow file names are written by the contractor, so they are quoted as labels, length-capped and run through the prescan.
- Without a grant (the Threat lab), `/api/verify` grades pasted text only: it never signs an attestation, calls GitHub or probes a URL.

**Review window.**
- *The window is part of the grant.* `reviewWindowSec` is signed at funding with the other terms, and a 2-minute demo choice is part of the order hash, so it cannot be changed after the hold. A live PayPal hold always gets 48 hours (172800 seconds), whatever the request says.
- *Client key.* `/api/escrow/authorize` also returns a signed client key (its own token kind, bound to the authorization ID, valid until the grant expires). Only the client's browser holds it, and it is issued once per authorization (a second authorize call for the same order is refused, since the order ID and terms are not secret). Approve and object require it; status and claim do not, because a due release can only pay the grant's payee.
- *Bound to one grant.* Simulated grants can be minted by anyone, so each record stores the hash of its grant and every release route refuses a different grant for the same authorization (403).
- *State machine.* The record (`daccord:release:<authorizationId>`) moves between `review`, `changes_requested`, `released` and `escalated`. The server refuses: approve or object without a valid client key for that authorization; a release while the state is not `review`, or before the release time (except client approval); a new review over a released record; objections after the release. With the window on, verification signs no 30-minute attestation, so `/api/payout` cannot skip the window (409). A passing verification while a window is already open keeps that window (the clock does not restart), but the record moves to that newer commit. Every commit that passed for the milestone is remembered, and none of them can open a new window after the client requested changes.
- *Exactly once.* Every state change runs under a per-authorization lock in the store (`SET NX EX 90`, dropped with a compare-and-delete), so the page, the claim button and the cron cannot release twice. The payout batch ID comes from the authorization, and the capture is idempotent. The capture is recorded before the payout, so if the payout then fails the next check retries only the payout, and objections are closed from that moment (the client's money has moved). A failed release keeps the record in review with the error, and the next check retries. The cron sweep pushes a record that keeps failing past the next sweep and stops sweeping it after 5 failures, so it cannot starve newer due records; status and claim still retry it. The scope arbiter runs outside the release lock (with its own one-objection-at-a-time marker and a 50 second timeout), and its verdict is applied only if the record is still in the same open window when it answers.
- *Storage.* Upstash Redis (or Vercel KV) when configured. If it is configured but unreachable, the release routes answer 503 rather than fall back to memory. Without it, the in-memory store cannot be shared across serverless instances, so on Vercel production the app keeps the old behavior (pay right after verification) and the page shows "Review window needs a datastore; this deployment pays out right after verification".
- *Cron.* `vercel.json` runs the sweep once a day (09:00 UTC) so it fits the Vercel Hobby plan. Between sweeps, a due release happens whenever the page checks status or the freelancer claims, so with nobody online an auto-release can wait up to a day.
- *PayPal's honor period.* PayPal honors an authorization for 3 days. With a 48-hour window, a verification later than about day 1 after funding can push the capture past the honor period. The capture can still succeed while the authorization is valid (29 days), but the funds are no longer guaranteed. The release time is not capped at the grant's expiry, so a very late verification can end its window after the authorization dies; the capture then fails and the error is recorded.

**Retry limits.** With the AI reviewer on, each grant gets 5 graded attempts per rolling hour and 15 over its whole life, and over a limit the API answers 429 with `Retry-After`. A failed verdict is remembered for 7 days per grant and head commit (plus its check results and probe results), so editing the notes or pasted code on the same commit returns the earlier failure without asking the model; only a new commit gets a new grade. Passes are never cached. Threat lab calls get 5 per hour per client IP (taken from the host's own forwarding header where it sets one) and 60 per hour for the whole deployment, and are not remembered, so each run shows its own verdict. Storage is Upstash Redis when its two variables are set, otherwise process memory.

**Known limits.**
- CI runs in the freelancer's repository. D'accord reads the workflow files and check results, but cannot rule out a runner or third-party action that lies; a client who needs that should run the tests on their own CI.
- Without Upstash, retry limits and remembered failures live in each server instance's memory, so on a serverless host they reset when instances recycle and are not shared between instances.
- The client has to trust D'accord's signing key. Anyone holding `DACCORD_SIGNING_SECRET` can sign grants and attestations.
- Simulated holds cannot be bound to a PayPal order, so anyone can mint a simulated grant. Simulated payouts move no money.
- The reviewers are language models. The rules above narrow what they accept, but a determined attacker may still find wording or code that fools both.
- A new hold creates a new grant, so the retry count and remembered failures start over for it. Only the client can create a hold.
- The repository field is optional. If the client leaves it blank, any public PR that meets the criteria can be submitted against the grant.
- A new commit on the PR gets a new grade, within the attempt limits. An empty commit is enough to reroll.
- Only the top-level `.github/workflows`, the root `package.json`, a root Makefile and local `uses: ./` actions are read. Tests delegated to a remote reusable workflow or action are not shown to the reviewers, who are told not to count them; monorepos with per-package scripts may need the client to name the exact test command in the criterion.
- The prompt-injection prescan is a keyword filter and is easy to evade; the model passes are the real defense.
- Escalated milestones need a human arbiter, which is not built yet. Their funds stay held until the authorization expires.
- If the server crashes after PayPal accepts the payout but before the record is saved, a retry hits PayPal's duplicate batch rejection and the record stays in review with an error. Nobody is paid twice, but the record needs manual reconciliation.
- The demo page shows the client and freelancer panels on one screen. In real use each side would see only its own.

## What verification does not cover

D'accord answers one question: does the delivered work provably meet the criteria both sides signed? It does not measure whether the client is happy. A client can still be unhappy, and sometimes rightly so, when:

- **The criteria were incomplete.** The client wanted a fast, polished checkout but only wrote "orders endpoint returns 201". The work passes and still is not what they meant. We expect this to be the most common case.
- **Quality was never written down.** Messy code, poor UX, weak design or slow pages pass if no criterion covers them.
- **Staging is not production.** The work runs on the freelancer's staging and breaks once deployed for real.
- **The reviewers get it wrong.** Two independent passes must agree, which lowers the risk of a false pass but does not remove it.
- **The deliverable is not code.** Design, copy or strategy work cannot be verified this way yet.

We have not measured how often D'accord catches a bad delivery in real use, so we make no catch-rate claim. What it changes is the shape of a dispute: "did you deliver?" becomes "did we agree on the right thing?", which is a smaller and easier argument.

**Built for these cases:**
- **A client review window.** After verification passes, the client gets a window (48 hours) to approve or object with reasons; silence releases the funds. The silence rule protects the freelancer, the window protects the client.
- **The scope arbiter, wired into that window.** An objection is sorted into an in-scope defect (the freelancer fixes it, the release pauses) or an out-of-scope expansion (recorded, offered as a new paid milestone, the clock keeps running). Two upheld objections at most; a third escalates.

**Planned for these cases:**
- **A human arbiter** for escalated milestones and split decisions. Today an escalated milestone just stays held.
- **A criteria coach at contract time.** Flags vague or missing criteria (performance, mobile, accessibility) before any money is held, which targets the biggest gap above.
- **Client-owned CI and a production smoke test** after deploy, so the evidence does not come only from the freelancer's side.
- **Partial release.** Pay out the criteria that passed and keep holding the rest.

## Not built yet

- Contract and milestone state lives in the browser; only review-window records, retry counts and remembered failures are stored server side. Webhook events are logged, not stored.
- The human arbiter for escalated milestones.
- In sandbox, captured funds land in the platform's account and the payout comes out of that account's balance. A production version would use PayPal's platform/marketplace onboarding instead of holding funds itself.

## License

[MIT](LICENSE)
