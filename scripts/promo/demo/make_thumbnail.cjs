#!/usr/bin/env node
// Renders the 1280x720 YouTube thumbnail. The Maître is the real SVG lifted from
// the live hero (never redrawn); the badges use the measured numbers in the take's
// timeline, so the thumbnail cannot disagree with the video.
// Usage: node make_thumbnail.cjs [workdir] [out.png]
const fs = require('fs');
const path = require('path');
const puppeteer = require('/Users/dorienvandenabbeele/Documents/antigravity/noble-pythagoras/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORK = process.argv[2] || path.join(process.env.HOME, 'Desktop', 'Daccord_Video', 'demo_work');
const OUT = process.argv[3] || path.join(path.dirname(WORK), 'daccord_thumbnail.png');
const tl = JSON.parse(fs.readFileSync(path.join(WORK, 'demo', 'timeline.json'), 'utf8'));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--allow-file-access-from-files'] });
  const site = await browser.newPage();
  await site.goto(tl.app, { waitUntil: 'networkidle0', timeout: 90000 });
  // The serving Maître in the hero: the largest inline SVG with the contract-and-tray viewBox.
  const svg = await site.evaluate(() => {
    const el = [...document.querySelectorAll('svg[viewBox="28 8 116 160"]')].sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    const c = el.cloneNode(true);
    c.removeAttribute('class'); c.removeAttribute('style');
    return c.outerHTML.replace(/var\(--icon-accent\)/g, '#A8D912');
  });
  const svgFile = path.join(WORK, 'cards', 'maitre.svg');
  fs.mkdirSync(path.dirname(svgFile), { recursive: true });
  fs.writeFileSync(svgFile, svg);
  const b1 = `Claude verified a real PR in ${tl.waits.verify.toFixed(1)} s`;
  const b2 = tl.paypal === 'sandbox' ? 'Real PayPal sandbox payout' : 'Live app, one take';
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'thumbnail.html') + `?svg=${encodeURIComponent('file://' + svgFile)}&b1=${encodeURIComponent(b1)}&b2=${encodeURIComponent(b2)}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: OUT });
  await browser.close();
  console.log(`✓ ${OUT} (${b1} · ${b2})`);
})().catch((e) => { console.error(e); process.exit(1); });
