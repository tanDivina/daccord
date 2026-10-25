#!/usr/bin/env node
// Renders the end card and caption overlays (1920x1080 PNGs, captions with
// alpha) in the app's own visual language: bistro cream #F7F1E3, ink #1A160F,
// lime #A8D912, Fraunces display (Google Fonts, falls back to Geist offline).
// Usage: node make_overlays.js [workdir]
const fs = require('fs');
const path = require('path');
const puppeteer = require('/Users/dorienvandenabbeele/Documents/antigravity/noble-pythagoras/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORK = process.argv[2] || path.join(process.env.HOME, 'Desktop', 'Daccord_Video', 'promo_work');
const FONT = path.join(__dirname, '..', '..', 'src', 'app', 'fonts', 'GeistVF.woff');
fs.mkdirSync(path.join(WORK, 'captions'), { recursive: true });

const CAPTIONS = {
  c_hook: 'The work is done. The payment waits.',
  c_criteria: 'Pass/fail criteria, agreed up front',
  c_hold: 'Funds held with PayPal — authorized, not charged',
  c_submit: 'Evidence: real PR · CI checks · live URL',
  c_verify: 'Evaluator + adversarial skeptic — both must agree',
  c_release: 'Signed attestation → one payout, exactly once',
  c_paid: 'Captured and paid out in seconds',
  c_threat: 'Prompt injection? Halted before a model reads it',
};

const FONT_B64 = fs.readFileSync(FONT).toString('base64');
const FONT_FACE = `@font-face { font-family: Geist; src: url(data:font/woff;base64,${FONT_B64}) format('woff'); font-weight: 100 900; }`;

const FRAUNCES_LINK = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..900;1,9..144,400..900&display=swap">`;

const captionHtml = (text) => `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_FACE}
  * { margin: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; background: transparent; font-family: Geist, sans-serif;
         display: flex; align-items: flex-end; justify-content: center; padding-bottom: 54px; }
  .pill { background: rgba(255,253,244,0.95); border: 2px solid #1A160F; border-radius: 44px;
          padding: 20px 44px; color: #1A160F; font-size: 34px; font-weight: 600; letter-spacing: -0.2px;
          box-shadow: 5px 5px 0 #1A160F; }
</style></head><body><div class="pill">${text}</div></body></html>`;

const SEAL_PATH = 'M12 4.4Q14.43 2.92 15.8 5.42Q18.65 5.35 18.58 8.2Q21.08 9.57 19.6 12Q21.08 14.43 18.58 15.8Q18.65 18.65 15.8 18.58Q14.43 21.08 12 19.6Q9.57 21.08 8.2 18.58Q5.35 18.65 5.42 15.8Q2.92 14.43 4.4 12Q2.92 9.57 5.42 8.2Q5.35 5.35 8.2 5.42Q9.57 2.92 12 4.4Z';
const LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none"><path d="${SEAL_PATH}" fill="#A8D912" stroke="#1A160F" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.9 12.2l2.1 2.1 4.3-4.5" stroke="#1A160F" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const endcardHtml = `<!doctype html><html><head><meta charset="utf-8">${FRAUNCES_LINK}<style>
  ${FONT_FACE}
  * { margin: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; background: #F7F1E3; font-family: Geist, sans-serif;
         display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px;
         background-image: linear-gradient(rgba(26,22,15,0.035) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(26,22,15,0.035) 1px, transparent 1px);
         background-size: 56px 56px; }
  .badge { width: 148px; height: 148px; }
  .badge svg { width: 148px; height: 148px; }
  h1 { color: #1A160F; font-family: Fraunces, Geist, serif; font-size: 138px; font-weight: 600; letter-spacing: -2px; }
  .tag { color: #4A443A; font-size: 44px; font-weight: 500; letter-spacing: -0.5px; }
  .tag b { color: #44560A; font-weight: 700; border-bottom: 5px solid #A8D912; }
  .foot { margin-top: 26px; color: #6B6353; font-size: 26px; font-family: ui-monospace, Menlo, monospace; }
</style></head><body>
  <div class="badge">${LOGO_SVG}</div>
  <h1>D&rsquo;accord</h1>
  <div class="tag">Agreed. Verified. <b>Settled.</b></div>
  <div class="foot">github.com/tanDivina/daccord &nbsp;·&nbsp; PayPal AI Hackathon 2026</div>
</body></html>`;

async function shoot(page, html, out, transparent) {
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 120));
  await page.screenshot({ path: out, omitBackground: transparent });
  console.log(`✓ ${path.basename(out)}`);
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await shoot(page, endcardHtml, path.join(WORK, 'endcard.png'), false);
  for (const [name, text] of Object.entries(CAPTIONS)) {
    await shoot(page, captionHtml(text), path.join(WORK, 'captions', `${name}.png`), true);
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
