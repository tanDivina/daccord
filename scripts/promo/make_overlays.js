#!/usr/bin/env node
// Renders the end card and caption overlays (1920x1080 PNGs, captions with
// alpha) in the app's own visual language: Geist, #050507, lime #a8ff35.
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

const captionHtml = (text) => `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_FACE}
  * { margin: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; background: transparent; font-family: Geist, sans-serif;
         display: flex; align-items: flex-end; justify-content: center; padding-bottom: 54px; }
  .pill { background: rgba(5,5,7,0.78); border: 1.5px solid rgba(168,255,53,0.28); border-radius: 44px;
          padding: 20px 44px; color: #f4f4f4; font-size: 34px; font-weight: 600; letter-spacing: -0.2px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.55); }
</style></head><body><div class="pill">${text}</div></body></html>`;

const LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="#a8ff35" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;

const endcardHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_FACE}
  * { margin: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; background: #050507; font-family: Geist, sans-serif;
         display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 34px;
         background-image: linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
         background-size: 56px 56px; }
  .badge { width: 128px; height: 128px; border-radius: 32px; display: flex; align-items: center; justify-content: center;
           background: linear-gradient(135deg, rgba(168,255,53,0.18), transparent); border: 2px solid rgba(168,255,53,0.35);
           box-shadow: 0 0 90px rgba(168,255,53,0.16); }
  .badge svg { width: 76px; height: 76px; }
  h1 { color: #ffffff; font-size: 132px; font-weight: 800; letter-spacing: -4px; }
  .tag { color: #a3a3a3; font-size: 44px; font-weight: 500; letter-spacing: -0.5px; }
  .tag b { color: #a8ff35; font-weight: 700; }
  .foot { margin-top: 26px; color: #555; font-size: 26px; font-family: ui-monospace, Menlo, monospace; }
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
