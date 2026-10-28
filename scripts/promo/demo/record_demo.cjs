#!/usr/bin/env node
// Records one continuous take of the LIVE D'accord app walking the whole protocol:
// criteria -> PayPal hold -> evidence -> two-reviewer verification -> capture +
// payout -> threat lab (two attacks). Writes WORK/demo/take.mp4, the PayPal
// popup as WORK/demo/popup.mp4 (real mode), and WORK/demo/timeline.json
// (scene marks, narration cues, real wait times, receipt IDs; seconds from take start).
//
// PAYPAL=real (default): a visible Chrome window; when PayPal's window opens,
//   Dorien logs in with a SANDBOX buyer account and approves. The script waits.
// PAYPAL=sim: unattended, uses the app's labelled "Simulate funding".
// Usage: [PAYPAL=sim] [APP_URL=...] node record_demo.cjs [workdir]
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const puppeteer = require('/Users/dorienvandenabbeele/Documents/antigravity/noble-pythagoras/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const APP = process.env.APP_URL || 'https://daccord.hero-apps.com';
const REAL = (process.env.PAYPAL || 'real') === 'real';
const WORK = process.argv[2] || path.join(process.env.HOME, 'Desktop', 'Daccord_Video', 'demo_work');
const OUT = path.join(WORK, 'demo');
fs.mkdirSync(OUT, { recursive: true });
const AUDIO = path.join(WORK, 'audio');

const PR_URL = 'https://github.com/tanDivina/paypal-orders-service/pull/1';
const STAGING_URL = 'https://paypal-orders-service.vercel.app/api/health';
const RECEIVER = process.env.DEMO_RECEIVER || 'sb-freelancer@personal.example.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dur = (f) => { try { return parseFloat(execSync(`/opt/homebrew/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).toString()); } catch { return 3; } };

// Screencast a page into an mp4 with wall-clock timestamps (no drift on idle stretches).
async function screencast(page, file, onFirstFrame) {
  const ff = spawn(FFMPEG, ['-y', '-use_wallclock_as_timestamps', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-i', '-',
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-fps_mode', 'cfr', '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', file]);
  ff.stderr.on('data', () => {}); ff.stdin.on('error', () => {});
  const closed = new Promise((r) => ff.on('close', r));
  const cdp = await page.target().createCDPSession();
  let first = true;
  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    try { if (first) { first = false; onFirstFrame && onFirstFrame(); } ff.stdin.write(Buffer.from(data, 'base64')); await cdp.send('Page.screencastFrameAck', { sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  return async () => { try { await cdp.send('Page.stopScreencast'); await cdp.detach(); } catch {} ff.stdin.end(); await closed; };
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: REAL ? false : 'new', protocolTimeout: 600000, defaultViewport: null,
    args: ['--no-sandbox', '--window-size=1600,1000', '--window-position=40,40', '--force-device-scale-factor=1'],
  });
  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1.2 });
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await page.goto(APP, { waitUntil: 'networkidle0', timeout: 90000 });
  await page.waitForFunction(() => document.body.innerText.toLowerCase().includes('pick the milestone'), { timeout: 60000 });
  await sleep(2600); // let the hero entrance finish before the take starts

  // Cursor + click pulse drawn in the page (so the screencast sees it), plus a heartbeat pixel.
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = `#promo-cursor{position:fixed;width:26px;height:26px;pointer-events:none;z-index:999999;transition:transform .12s ease;filter:drop-shadow(0 2px 5px rgba(0,0,0,.45))}
      #promo-cursor.down{transform:scale(.82)}
      .promo-click{position:fixed;width:56px;height:56px;border-radius:50%;pointer-events:none;z-index:999998;background:radial-gradient(circle,rgba(143,188,10,.6) 0%,rgba(143,188,10,0) 70%);transform:translate(-50%,-50%) scale(.25);animation:pc .45s cubic-bezier(.1,.8,.3,1) forwards}
      @keyframes pc{to{transform:translate(-50%,-50%) scale(1.6);opacity:0}}
      #fps-hb{position:fixed;bottom:0;right:0;width:2px;height:2px;z-index:999997;animation:hb .033s infinite linear}
      @keyframes hb{0%{background:#F7F1E3}50%{background:#F6F0E1}100%{background:#F7F1E3}}
      html{scroll-behavior:auto!important}`;
    document.head.appendChild(s);
    const hb = document.createElement('div'); hb.id = 'fps-hb'; document.body.appendChild(hb);
    const c = document.createElement('div'); c.id = 'promo-cursor';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 3l14 9.2-6.6 1 3 6.3-2.7 1.3-3-6.3L5 18.6z" fill="#fff" stroke="#1A160F" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    c.style.left = '820px'; c.style.top = '620px'; document.body.appendChild(c);
    window.cursorTo = (x, y) => { c.style.left = x + 'px'; c.style.top = y + 'px'; };
    window.cursorClick = (x, y) => { c.classList.add('down'); setTimeout(() => c.classList.remove('down'), 160);
      const r = document.createElement('div'); r.className = 'promo-click'; r.style.left = x + 'px'; r.style.top = y + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 480); };
    window.findButton = (q) => { const hits = [...document.querySelectorAll('button, select')].filter((e) => (e.innerText || '').replace(/\s+/g, ' ').includes(q));
      hits.sort((a, b) => a.offsetWidth * a.offsetHeight - b.offsetWidth * b.offsetHeight); return hits[0] || null; };
    window.rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 140), y: r.top + r.height / 2, top: r.top, bottom: r.bottom }; };
  });

  // Measured up front: probing during the take delays cues on a busy machine.
  const LINE = Object.fromEntries(fs.readdirSync(AUDIO).filter((f) => f.endsWith('.mp3')).map((f) => [f.slice(0, -4), dur(path.join(AUDIO, f))]));
  let t0 = null; const marks = {}; const audio = []; const waits = {}; const played = [];
  const now = () => (Date.now() - t0) / 1000;
  const stopMain = await screencast(page, path.join(OUT, 'take.mp4'), () => { t0 = Date.now(); });
  while (t0 === null) await sleep(20);
  const mark = (n) => { marks[n] = +now().toFixed(3); console.log(`  ⏱ ${n} @ ${marks[n]}s`); };
  const speak = (name) => {
    audio.push({ line: name, t: +now().toFixed(3) });
    played.push({ end: now() + (LINE[name] ?? 3) });
    console.log(`  🔊 ${name} @ ${now().toFixed(2)}s`);
  };
  const settle = async (extra = 0.7) => { const w = Math.max(0, ...played.map((p) => p.end)) + extra - now(); if (w > 0) await sleep(w * 1000); };

  let cx = 820, cy = 620;
  const moveTo = async (x, y, ms = 550) => {
    const fx = cx, fy = cy, steps = Math.max(10, Math.round(ms / 33));
    for (let i = 0; i <= steps; i++) { const t = i / steps, e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      cx = fx + (x - fx) * e; cy = fy + (y - fy) * e; await page.evaluate((a, b) => window.cursorTo(a, b), cx, cy); await sleep(ms / steps); }
  };
  const scrollTo = (y, ms = 800) => page.evaluate((target, d) => new Promise((done) => {
    const from = window.scrollY, delta = target - from, start = performance.now();
    const step = (t) => { const k = Math.min(1, (t - start) / d), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      window.scrollTo(0, from + delta * e); k < 1 ? requestAnimationFrame(step) : done(); };
    requestAnimationFrame(step); }), y, ms);
  const ensureVisible = async (getRect) => {
    const r = await page.evaluate(getRect);
    if (r && (r.top < 100 || r.bottom > 820)) { const y = await page.evaluate((top) => window.scrollY + top - 380, r.top); await scrollTo(Math.max(0, y), 650); await sleep(150); }
    return page.evaluate(getRect);
  };
  const clickOn = async (q, ms = 550) => {
    const r = await ensureVisible(new Function(`return window.rectOf(window.findButton(${JSON.stringify(q)}))`));
    if (!r) throw new Error(`button not found: ${q}`);
    await moveTo(r.x, r.y, ms); await sleep(120);
    await page.evaluate((a, b) => window.cursorClick(a, b), cx, cy);
    await page.evaluate((qq) => window.findButton(qq)?.click(), q);
    await sleep(260);
  };
  const typeInto = async (ph, text) => {
    const sel = `input[placeholder*="${ph}"], textarea[placeholder*="${ph}"]`;
    const r = await ensureVisible(new Function(`return window.rectOf(document.querySelector(${JSON.stringify(sel)}))`));
    if (!r) throw new Error(`input not found: ${ph}`);
    await moveTo(r.x, r.y, 420); await page.evaluate((a, b) => window.cursorClick(a, b), cx, cy);
    await page.focus(sel); await page.keyboard.type(text, { delay: 18 }); await sleep(150);
  };
  const waitText = (txt, timeout = 30000) => page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout }, txt);
  const scrollToText = async (txt, offset = 120) => {
    const y = await page.evaluate((t, o) => { const el = [...document.querySelectorAll('h2,h3,p,span')].find((e) => e.innerText && e.innerText.includes(t));
      return el ? el.getBoundingClientRect().top + window.scrollY - o : null; }, txt, offset);
    if (y !== null) await scrollTo(Math.max(0, y), 800);
  };

  // ── 1. criteria ──────────────────────────────────────────────────────────
  mark('criteria'); speak('n_criteria');
  await page.evaluate(() => document.querySelector('main > div.scroll-mt-44')?.scrollIntoView({ block: 'start' }));
  await scrollTo(await page.evaluate(() => window.scrollY), 10);
  await sleep(2600);
  await scrollToText('Pick the milestone', 140);
  await sleep(900);
  await clickOn('PayPal Orders v2 & Webhook Reconciliation Engine', 650);
  await settle(0.3);
  await clickOn('Fund milestone #2 with PayPal', 600);

  // ── 2. hold the funds ────────────────────────────────────────────────────
  await waitText('Step 2: Hold the funds');
  await page.evaluate(() => document.querySelector('main > div.scroll-mt-44')?.scrollIntoView({ block: 'start' }));
  mark('hold'); speak(REAL ? 'n_hold' : 'n_hold_sim');
  let stopPopup = null;
  if (REAL) {
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some((f) => /paypal/.test(f.src || f.name)), { timeout: 30000 });
    await sleep(2500);
    const box = await page.evaluate(() => { const f = [...document.querySelectorAll('iframe')].find((x) => /paypal_buttons|zoid/.test(x.name)); const r = f.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 22 }; });
    await moveTo(box.x, box.y, 600); await page.evaluate((a, b) => window.cursorClick(a, b), cx, cy);
    const popP = new Promise((r) => browser.once('targetcreated', async (t) => r(await t.page())));
    const bf = page.frames().find((f) => f.url().includes('smart/buttons'));
    await bf.click('[data-funding-source="paypal"]');
    const pop = await popP;
    mark('popup_open');
    stopPopup = await screencast(pop, path.join(OUT, 'popup.mp4'), () => { marks.popup_first_frame = +now().toFixed(3); });
    console.log('\n  >>> PayPal window is open. Log in with your SANDBOX buyer account and approve. Waiting up to 6 min...\n');
    await page.waitForFunction(() => /Authorization ID/i.test(document.body.innerText), { timeout: 360000 });
    mark('popup_closed');
    await stopPopup().catch(() => {}); stopPopup = null;
    waits.paypal = +(marks.popup_closed - marks.popup_open).toFixed(1);
  } else {
    await sleep(1800);
    await clickOn('Simulate funding', 650);
    await waitText('Authorization ID', 30000);
  }
  mark('held');
  await sleep(600);
  const auth = await page.evaluate(() => (document.body.innerText.match(/Authorization ID\s*\n?\s*([A-Z0-9-]+)/i) || [])[1] || null);
  await settle(0.4);

  // ── 3. submit evidence ───────────────────────────────────────────────────
  mark('submit'); speak('n_submit');
  await typeInto('GitHub PR URL', PR_URL);
  await typeInto('Staging URL', STAGING_URL);
  await typeInto('Notes for the client', 'Milestone 2 ready: Orders v2 authorize and capture, webhook verification, health endpoint live on staging.');
  await typeInto('Your PayPal email', RECEIVER);
  await settle(0.3);
  await clickOn('Submit for verification', 550);
  mark('verify_start'); await sleep(300); speak('n_verify');
  await page.waitForFunction(() => /Step 3: Work verified|criteria not met|Halted/i.test(document.body.innerText), { timeout: 240000 });
  mark('verify_end');
  waits.verify = +(marks.verify_end - marks.verify_start).toFixed(1);
  const verified = await page.evaluate(() => document.body.innerText.includes('Step 3: Work verified'));
  if (!verified) console.log('⚠ verification did not pass; the take stops being useful after this point');

  // ── 4. release + paid ────────────────────────────────────────────────────
  let receipt = null;
  if (verified) {
    await page.evaluate(() => document.querySelector('main > div.scroll-mt-44')?.scrollIntoView({ block: 'start' }));
    await sleep(500);
    mark('verified');
    await settle(0.2);
    await scrollTo(await page.evaluate(() => window.scrollY + 320), 1600);
    await settle(0.3);
    speak('n_release');
    await sleep(1800);
    await clickOn('Release payment', 600);
    mark('release_click');
    await waitText('Payment released', 90000);
    // Jump to the receipt at once: its PAID stamp animates 0.9 s after mount.
    await page.evaluate(() => {
      const stamp = [...document.querySelectorAll('.appear-stamp')].pop();
      const card = stamp?.closest('.shadow-paper-md');
      (card || stamp)?.scrollIntoView({ block: 'center' });
    });
    mark('paid');
    waits.payout = +(marks.paid - marks.release_click).toFixed(1);
    speak(REAL ? 'n_paid' : 'n_paid_sim');
    await sleep(700);
    receipt = await page.evaluate(() => {
      const t = document.body.innerText; const g = (k) => (t.match(new RegExp(k + '\\s*\\n?\\s*([^\\n]+)')) || [])[1]?.trim() || null;
      return { captureId: g('Capture ID'), captureStatus: g('Capture status'), payoutBatchId: g('Payout batch ID'), batchStatus: g('Batch status'),
        senderBatchId: g('Sender batch ID'), mode: /SIMULATED PAYOUT/.test(t) ? 'simulated' : 'sandbox' };
    });
    await settle(1.0);
    mark('paid_end');
  }

  // ── 5. threat lab: hidden instruction, then the polite "waived" note ─────
  await scrollTo(0, 600);
  await clickOn('Threat lab', 500);
  await waitText('Try to cheat the verifier');
  await sleep(500);
  mark('threat'); speak('n_threat');
  await scrollToText('SUBMITTED CODE', 170);
  await clickOn('Run', 500);
  await page.waitForFunction(() => /Halted/.test(document.body.innerText.split('SUBMITTED CODE')[1] || ''), { timeout: 40000 });
  mark('threat1_done');
  await sleep(2400);
  await scrollToText('Try to cheat the verifier', 110);
  await clickOn('2. Disguised injection', 550);
  await sleep(500);
  await scrollToText('SUBMITTED CODE', 170);
  await clickOn('Run', 500);
  mark('threat2_start');
  await page.waitForFunction(() => !/Running\.\.\./.test(document.body.innerText) && /criteria not met|Halted|Work verified/i.test(document.body.innerText.split('SUBMITTED CODE')[1] || ''), { timeout: 120000 });
  mark('threat2_done');
  waits.threat2 = +(marks.threat2_done - marks.threat2_start).toFixed(1);
  await sleep(1300);
  // Bring Claude's PROMPT_INJECTION_DETECTED finding to the middle of the frame and let it be read.
  const yRed = await page.evaluate(() => { const el = [...document.querySelectorAll('p,span,div')].reverse().find((e) => e.childElementCount === 0 && /PROMPT_INJECTION_DETECTED/.test(e.innerText || ''));
    return el ? el.getBoundingClientRect().top + window.scrollY - 330 : window.scrollY + 260; });
  await scrollTo(yRed, 1000);
  mark('threat2_read');
  await sleep(4200);
  await settle(0.4);
  mark('end');

  await stopMain();
  await browser.close();
  const tl = { recorded: new Date().toISOString(), app: APP, paypal: REAL ? 'sandbox' : 'simulated', verified, authorizationId: auth, receipt, waits, marks, audio };
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(tl, null, 2));
  console.log(`\n✅ take.mp4 ${marks.end}s, paypal=${tl.paypal}, verified=${verified}, waits=${JSON.stringify(waits)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
