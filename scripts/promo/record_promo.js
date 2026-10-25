#!/usr/bin/env node
// Records the REAL D'accord app (localhost:3000) walking the full protocol:
// contract -> PayPal hold -> evidence submission -> two-reviewer verification
// -> signed payout -> threat-lab injection block. Writes raw_screen.mp4 plus a
// timeline.json (scene marks + audio cues, wall-clock seconds).
// Usage: node record_promo.js [workdir]
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const puppeteer = require('/Users/dorienvandenabbeele/Documents/antigravity/noble-pythagoras/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const APP = process.env.APP_URL || 'http://localhost:3000';
const WORK = process.argv[2] || path.join(process.env.HOME, 'Desktop', 'Daccord_Video', 'promo_work');
fs.mkdirSync(WORK, { recursive: true });
const RAW = path.join(WORK, 'raw_screen.mp4');
const AUDIO = path.join(WORK, 'audio');

const PR_URL = process.env.DEMO_PR_URL || 'https://github.com/tanDivina/paypal-orders-service/pull/1';
const STAGING_URL = process.env.DEMO_STAGING_URL || 'https://paypal-orders-service.vercel.app/api/health';
const RECEIVER = process.env.DEMO_RECEIVER || 'sb-freelancer@personal.example.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,940', '--force-device-scale-factor=1'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1.2 });
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await page.goto(APP, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => document.body.innerText.toLowerCase().includes('pick the milestone'), { timeout: 30000 });
  await sleep(400);

  // Desktop cursor + click pulse, drawn by the page itself so it is captured.
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      #promo-cursor { position: fixed; width: 26px; height: 26px; pointer-events: none; z-index: 999999;
        transition: transform .12s ease; filter: drop-shadow(0 2px 5px rgba(0,0,0,.6)); }
      #promo-cursor.down { transform: scale(0.82); }
      .promo-click { position: fixed; width: 56px; height: 56px; border-radius: 50%; pointer-events: none; z-index: 999998;
        background: radial-gradient(circle, rgba(143,188,10,0.6) 0%, rgba(143,188,10,0) 70%);
        transform: translate(-50%,-50%) scale(.25); animation: promoClick .45s cubic-bezier(.1,.8,.3,1) forwards; }
      @keyframes promoClick { to { transform: translate(-50%,-50%) scale(1.6); opacity: 0; } }
      #fps-heartbeat { position: fixed; bottom: 0; right: 0; width: 2px; height: 2px; z-index: 999997;
        animation: hb .033s infinite linear; }
      @keyframes hb { 0% { background:#F7F1E3 } 50% { background:#F6F0E1 } 100% { background:#F7F1E3 } }
    `;
    document.head.appendChild(style);
    const hb = document.createElement('div'); hb.id = 'fps-heartbeat'; document.body.appendChild(hb);
    const c = document.createElement('div');
    c.id = 'promo-cursor';
    c.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 3l14 9.2-6.6 1 3 6.3-2.7 1.3-3-6.3L5 18.6z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    c.style.left = '820px'; c.style.top = '620px';
    document.body.appendChild(c);
    window.cursorTo = (x, y) => { c.style.left = `${x}px`; c.style.top = `${y}px`; };
    window.cursorClick = (x, y) => {
      c.classList.add('down'); setTimeout(() => c.classList.remove('down'), 160);
      const r = document.createElement('div'); r.className = 'promo-click';
      r.style.left = `${x}px`; r.style.top = `${y}px`;
      document.body.appendChild(r); setTimeout(() => r.remove(), 480);
    };
    // Smallest button (or option-bearing element) whose text contains the query.
    window.findButton = (query) => {
      const els = Array.from(document.querySelectorAll('button, select, [role="tab"]'));
      const hits = els.filter((e) => (e.innerText || '').replace(/\s+/g, ' ').includes(query));
      hits.sort((a, b) => a.offsetWidth * a.offsetHeight - b.offsetWidth * b.offsetHeight);
      return hits[0] ?? null;
    };
    window.centerOf = (query) => {
      const t = window.findButton(query);
      if (!t) return null;
      const r = t.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom };
    };
    window.inputCenter = (placeholder) => {
      const el = document.querySelector(`input[placeholder*="${placeholder}"], textarea[placeholder*="${placeholder}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + Math.min(120, r.width / 2), y: r.top + r.height / 2, top: r.top, bottom: r.bottom };
    };
  });

  // Recorder: wall-clock timestamps keep the video real-time.
  const ff = spawn(FFMPEG, ['-y', '-use_wallclock_as_timestamps', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-i', '-',
    '-vf', 'scale=1920:1080:flags=lanczos', '-vsync', 'cfr', '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', RAW]);
  ff.stderr.on('data', () => {});
  const cdp = await page.target().createCDPSession();
  let frames = 0; let t0 = null; const marks = {}; const audio = [];
  const now = () => (Date.now() - t0) / 1000;
  const mark = (name) => { marks[name] = +now().toFixed(3); console.log(`  ⏱ ${name} @ ${marks[name]}s`); };
  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    try { if (t0 === null) t0 = Date.now(); frames++; ff.stdin.write(Buffer.from(data, 'base64')); await cdp.send('Page.screencastFrameAck', { sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  while (t0 === null) await sleep(20);

  // Voice pacing: each cue knows its clip duration; settle() waits until the
  // narrator finishes plus a breath. Missing clips fall back to 3s estimates.
  const dur = (f) => {
    try { return parseFloat(execSync(`/opt/homebrew/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).toString()); }
    catch { return 3; }
  };
  const GAP = 0.9;
  const played = [];
  const speak = (name) => {
    const file = path.join(AUDIO, `${name}.mp3`);
    audio.push({ name, file, t: +now().toFixed(3) });
    played.push({ end: now() + (fs.existsSync(file) ? dur(file) : 3) });
    console.log(`  🔊 ${name} @ ${now().toFixed(2)}s`);
  };
  const settle = async (extra = GAP) => {
    const end = Math.max(0, ...played.map((p) => p.end));
    const wait = end + extra - now();
    if (wait > 0) await sleep(wait * 1000);
  };

  // Cursor choreography.
  let cx = 820, cy = 620;
  async function moveTo(x, y, ms = 550) {
    const fx = cx, fy = cy, steps = Math.max(10, Math.round(ms / 33));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      cx = fx + (x - fx) * e; cy = fy + (y - fy) * e;
      await page.evaluate((a, b) => window.cursorTo(a, b), cx, cy);
      await sleep(ms / steps);
    }
  }
  async function click(query = null) {
    await page.evaluate((a, b) => window.cursorClick(a, b), cx, cy);
    await page.mouse.click(cx, cy);
    if (query) {
      await page.evaluate((q) => {
        const el = window.findButton(q);
        if (el) el.click();
      }, query);
    }
    await sleep(260);
  }
  async function clickOn(query, ms = 550) {
    await page.evaluate((q) => {
      const el = window.findButton(q);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.top < 90 || r.bottom > window.innerHeight - 90) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }, query);
    await sleep(300);
    const c = await page.evaluate((q) => window.centerOf(q), query);
    if (!c) throw new Error(`button not found: ${query}`);
    await moveTo(c.x, c.y, ms); await sleep(140); await click(query);
  }
  async function typeInto(placeholder, text) {
    await page.evaluate((p) => {
      const el = document.querySelector(`input[placeholder*="${p}"], textarea[placeholder*="${p}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.top < 90 || r.bottom > window.innerHeight - 90) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }, placeholder);
    await sleep(300);
    const c = await page.evaluate((p) => window.inputCenter(p), placeholder);
    if (!c) throw new Error(`input not found: ${placeholder}`);
    await moveTo(c.x, c.y, 450); await sleep(100); await click();
    await page.keyboard.type(text, { delay: 22 });
    await sleep(200);
  }
  async function scrollTo(y, ms = 700) {
    await page.evaluate((target, dur) => new Promise((done) => {
      const from = window.scrollY, delta = target - from, start = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - start) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        window.scrollTo(0, from + delta * e);
        k < 1 ? requestAnimationFrame(step) : done();
      };
      requestAnimationFrame(step);
    }), y, ms);
    await sleep(120);
  }
  const waitText = (txt, timeout = 20000) =>
    page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout }, txt);

  // ── Scene 1: hero + contract with criteria ───────────────────────────────
  mark('hero'); console.log('Scene 1: hero');
  speak('n_hook');
  await sleep(1400);
  await scrollTo(360, 900);
  await settle(0.5);

  mark('criteria'); console.log('Scene 2: criteria');
  speak('n_criteria');
  await scrollTo(760, 900);
  await clickOn('PayPal Orders v2 & Webhook Reconciliation Engine', 650);
  await settle(0.4);
  await clickOn('Fund milestone #2 with PayPal', 600);

  // ── Scene 3: hold the funds ──────────────────────────────────────────────
  await waitText('Step 2: Hold the funds');
  await scrollTo(430, 700);
  mark('hold'); console.log('Scene 3: hold');
  speak('n_hold');
  await sleep(600);
  await clickOn('Simulate funding', 650);
  await waitText('Authorization ID', 30000);
  await settle(0.5);

  // ── Scene 4: submit evidence ─────────────────────────────────────────────
  mark('submit'); console.log('Scene 4: submit evidence');
  speak('n_submit');
  await typeInto('GitHub PR URL', PR_URL);
  await typeInto('Staging URL', STAGING_URL);
  await typeInto('Notes for the client', 'Milestone 2 ready: webhook verification + health endpoint live on staging.');
  await typeInto('Your PayPal email', RECEIVER);
  await settle(0.4);
  await clickOn('Submit for verification', 550);
  mark('verify_start'); console.log('Scene 5: verifying');
  await sleep(400);
  speak('n_verify');

  // Wait for the verdict (two Claude passes; the dead time is compressed in post).
  await page.waitForFunction(
    () => document.body.innerText.includes('Step 3: Work verified') || document.body.innerText.includes('criteria not met') || document.body.innerText.includes('Halted'),
    { timeout: 180000 }
  );
  mark('verify_end');

  const verified = await page.evaluate(() => document.body.innerText.includes('Step 3: Work verified'));
  if (verified) {
    // ── Scene 6: verified -> release ───────────────────────────────────────
    await scrollTo(380, 700);
    mark('verified'); console.log('Scene 6: verified');
    await settle(0.2);
    speak('n_release');
    await sleep(1200);
    await scrollTo(720, 1000);
    await settle(0.5);
    const rel = await page.evaluate(() => window.centerOf('Release payment'));
    if (!rel || rel.bottom > 880) await scrollTo(900, 700);
    await clickOn('Release payment', 600);

    // ── Scene 7: paid ──────────────────────────────────────────────────────
    await waitText('Payment released', 60000);
    await scrollTo(430, 700);
    mark('paid'); console.log('Scene 7: paid');
    speak('n_paid');
    await settle(1.0);
  } else {
    console.log('⚠ verification did not pass (rules mode?) — skipping payout scenes');
    mark('verified'); mark('paid');
  }

  // ── Scene 8: threat lab ────────────────────────────────────────────────────
  await scrollTo(0, 650);
  await clickOn('Threat lab', 600);
  await waitText('Try to cheat the verifier');
  await scrollTo(260, 650);
  mark('threat'); console.log('Scene 8: threat lab');
  speak('n_threat');
  await sleep(900);
  await clickOn('Run', 550);
  await waitText('PROMPT_INJECTION_DETECTED', 30000);
  await scrollTo(430, 650);
  await settle(0.8);

  // ── Outro: narrator carries into the end card ────────────────────────────
  mark('outro'); console.log('Outro');
  speak('n_outro');
  await sleep(1500);
  mark('end');

  await cdp.send('Page.stopScreencast');
  await sleep(300);
  await browser.close();
  await new Promise((r) => { ff.stdin.end(); ff.on('close', r); });
  fs.writeFileSync(path.join(WORK, 'timeline.json'), JSON.stringify({ fps: 30, frames, seconds: marks.end, verified, marks, audio }, null, 2));
  console.log(`\n✅ ${RAW} (${frames} frames, ${marks.end}s), verified=${verified}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
