#!/usr/bin/env node
// Records the LIVE site (daccord.hero-apps.com) as one clip per scene, each
// sized to its narration line: hero (entrance + count-up stats) under n_intro,
// the Architecture tab with each card lit as the voice names it (n_arch),
// and the close back on the hero (n_close). Writes WORK/site/<scene>.mp4.
// Usage: node record_site.cjs [workdir] [scene,scene...]
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const puppeteer = require('/Users/dorienvandenabbeele/Documents/antigravity/noble-pythagoras/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const SITE = process.env.SITE_URL || 'https://daccord.hero-apps.com/';
const WORK = process.argv[2] || path.join(process.env.HOME, 'Desktop', 'Daccord_Video', 'demo_work');
const OUT = path.join(WORK, 'site');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[3] ? process.argv[3].split(',') : null;
const LEAD = 0.3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dur = (f) => { try { return parseFloat(execSync(`/opt/homebrew/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).toString()); } catch { return 3; } };
const len = (line, pad = 1.0) => LEAD + dur(path.join(WORK, 'audio', `${line}.mp3`)) + pad;

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 300000,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,940', '--force-device-scale-factor=1'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1.2 });

  async function scene(name, seconds, run) {
    if (only && !only.includes(name)) return;
    const file = path.join(OUT, `${name}.mp4`);
    const ff = spawn(FFMPEG, ['-y', '-use_wallclock_as_timestamps', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-i', '-',
      '-vf', 'scale=1920:1080:flags=lanczos', '-fps_mode', 'cfr', '-r', '30', '-t', seconds.toFixed(2),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', file]);
    ff.stderr.on('data', () => {}); ff.stdin.on('error', () => {});
    const closed = new Promise((r) => ff.on('close', r));
    const cdp = await page.target().createCDPSession();
    cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
      try { ff.stdin.write(Buffer.from(data, 'base64')); await cdp.send('Page.screencastFrameAck', { sessionId }); } catch {}
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
    const t0 = Date.now();
    await run(() => (Date.now() - t0) / 1000);
    const left = seconds + 0.5 - (Date.now() - t0) / 1000;
    if (left > 0) await sleep(left * 1000);
    await cdp.send('Page.stopScreencast'); await cdp.detach();
    ff.stdin.end(); await closed;
    console.log(`✓ ${name}.mp4 (${seconds.toFixed(1)}s)`);
  }
  const at = async (now, t) => { const w = t - now(); if (w > 0) await sleep(w * 1000); };
  const scrollTo = (y, ms = 1400) => page.evaluate((target, d) => new Promise((done) => {
    const from = window.scrollY, delta = target - from, start = performance.now();
    const step = (t) => { const k = Math.min(1, (t - start) / d), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      window.scrollTo(0, from + delta * e); k < 1 ? requestAnimationFrame(step) : done(); };
    requestAnimationFrame(step); }), y, ms);
  // A fresh load with the heartbeat pixel; the hero entrance plays from here.
  const fresh = async () => {
    await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = `#fps-hb{position:fixed;right:0;bottom:0;width:2px;height:2px;z-index:99999;animation:fpshb .033s infinite linear}
        @keyframes fpshb{0%{background:#F7F1E3}50%{background:#F6F0E1}100%{background:#F7F1E3}}
        html{scroll-behavior:auto!important}
        .arch-lit{outline:3px solid #A8D912;outline-offset:2px;box-shadow:4px 4px 0 #1A160F!important;transform:translateY(-3px);transition:all .45s cubic-bezier(.16,1,.3,1)}`;
      document.head.appendChild(s);
      const d = document.createElement('div'); d.id = 'fps-hb'; document.body.appendChild(d);
    });
  };
  // Warm the cache so the recorded load is the real first paint, not a network wait.
  await page.goto(SITE, { waitUntil: 'networkidle0', timeout: 90000 });
  await page.goto('about:blank');

  // ── hero: entrance (receipt prints, PAID stamp), stats count up ──────────
  await scene('hero', len('n_intro', 1.4), async (now) => {
    await fresh();
    await at(now, 8.0); await scrollTo(150, 1800);
  });

  // ── architecture: light each card as the voice names it ──────────────────
  // n_arch word times: Orders 1.3, Payouts 3.3, webhooks 4.3, batch ID 9.0
  await fresh();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Architecture'));
  await sleep(2500);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Architecture').click());
  await sleep(1500);
  const archTop = await page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find((e) => e.innerText.includes('What runs where'));
    return h.getBoundingClientRect().top + window.scrollY - 110; });
  await page.evaluate((y) => window.scrollTo(0, y), archTop);
  await scene('arch', len('n_arch', 1.4), async (now) => {
    const lit = (title) => page.evaluate((t) => {
      document.querySelectorAll('.arch-lit').forEach((e) => e.classList.remove('arch-lit'));
      const h = [...document.querySelectorAll('h4')].find((e) => e.innerText.trim() === t); h?.parentElement.classList.add('arch-lit');
    }, title);
    await at(now, LEAD + 1.2); await lit('Orders v2');
    await at(now, LEAD + 3.2); await lit('Payouts v1');
    await at(now, LEAD + 4.2); await lit('Webhooks');
    await at(now, LEAD + 8.9); await lit('Payouts v1');
  });

  // ── close: back on the hero, entrance replays ────────────────────────────
  await scene('close', len('n_close', 2.6), async () => { await fresh(); });

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
