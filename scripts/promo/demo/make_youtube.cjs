#!/usr/bin/env node
// Writes the YouTube title + description for the current render, from the take's
// timeline (what was real, measured times) and chapters.json (compose.cjs).
// Re-run after every re-render: chapter times move.
// Usage: node make_youtube.cjs [workdir] [out.md]
const fs = require('fs');
const path = require('path');

const WORK = process.argv[2] || path.join(process.env.HOME, 'Desktop', 'Daccord_Video', 'demo_work');
const OUT = process.argv[3] || path.join(path.dirname(WORK), 'youtube.md');
const tl = JSON.parse(fs.readFileSync(path.join(WORK, 'demo', 'timeline.json'), 'utf8'));
const { chapters } = JSON.parse(fs.readFileSync(path.join(WORK, 'chapters.json'), 'utf8'));
const REAL = tl.paypal === 'sandbox';
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const day = new Date(tl.recorded).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Panama' });

const title = "D'accord: freelance milestone payments, verified by Claude, paid through PayPal";
const real = REAL
  ? `Everything in the demo is real and recorded in one take on the live app (${day}): a real PayPal sandbox order with intent AUTHORIZE, a real pull request with green CI and a live staging URL, two Claude reviews, then a real capture and PayPal Payout. Every ID on the receipt came back from the PayPal sandbox. Waits are sped up on screen and stamped with their real duration.`
  : `Recorded in one take on the live app (${day}). The pull request, its CI, the staging URL and both Claude reviews are real. In this cut the PayPal hold and payout run in the app's simulated mode, which the app labels on screen. Waits are sped up and stamped with their real duration.`;
const measured = [`Claude verification of the pull request (two passes, evaluator and skeptic): ${tl.waits.verify.toFixed(1)} s in this recording.`];
if (REAL && tl.waits.payout) measured.push(`Capture plus PayPal Payout after release: ${tl.waits.payout.toFixed(1)} s in this recording.`);

const description = `Freelancers do the work, then wait to get paid. In the Freelancers Union's national survey, the average longest wait was 98 days.

D'accord holds the client's money with PayPal before the work starts, and releases it the moment the delivered work is verified against criteria both sides agreed on. Not whenever the client gets around to it.

${real}

Try it: https://daccord.hero-apps.com
Code (MIT): https://github.com/tanDivina/daccord
The pull request the verifier grades: https://github.com/tanDivina/paypal-orders-service/pull/1

Built with:
- PayPal Orders v2 (intent AUTHORIZE, then capture)
- PayPal Payouts, with the batch ID derived from the evidence hash so one verification pays once
- PayPal Webhooks, checked with verify-webhook-signature
- Claude (Anthropic API): contract drafting, an evaluator and an adversarial skeptic per criterion
- GitHub API (PR diff and check runs), Next.js on Vercel

Measured:
${measured.map((m) => `- ${m}`).join('\n')}

Sources:
- Freelancers Union, "The Costs of Nonpayment" (2015), national survey of 5,358 U.S. freelancers: 71% have had trouble getting paid for finished work; the average longest wait to get paid is 98 days; the average loss to nonpayment is $5,968 a year.

Chapters:
${chapters.map((c) => `${mmss(c.t)} ${c.title}`).join('\n')}

Built by Dorien Van den Abbeele (Divina Endeavors LLC / Hero Apps) for the PayPal AI Hackathon 2026. Music: an original track made with ElevenLabs Music.

#PayPal #Claude #Freelance #Hackathon #Fintech`;

const md = `# YouTube: D'accord demo\n\nUpload as Public or Unlisted (Devpost rejects private or password-protected videos). Re-run make_youtube.cjs after any re-render; chapter times move.\n\n## Title\n\n${title}\n\n## Description\n\n${description}\n`;
if (/—/.test(md)) throw new Error('em dash in YouTube copy');
fs.writeFileSync(OUT, md);
fs.writeFileSync(path.join(path.dirname(OUT), 'youtube_title.txt'), title);
fs.writeFileSync(path.join(path.dirname(OUT), 'youtube_description.txt'), description);
console.log(`✓ ${OUT} (title ${title.length} chars, description ${description.length} chars)`);
