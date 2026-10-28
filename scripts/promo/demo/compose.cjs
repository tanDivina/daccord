#!/usr/bin/env node
// Composes the D'accord demo video (1920x1080, under 3:00) from:
//   demo/take.mp4 + demo/timeline.json (record_demo.cjs): the real end-to-end take
//   demo/popup.mp4 (real PayPal mode): the PayPal sandbox window, shown picture-in-picture
//   site/<scene>.mp4 (record_site.cjs): hero, arch, close
//   narration in audio/ (garden clone voice); personal clips in ../personal/
// Missing personal clips become slates that show the script, so the timing is reserved.
// The take plays at 1x wherever the voice speaks or a result lands; only quiet
// stretches are sped up, and each sped-up wait is stamped with its real duration.
// Usage: node compose.cjs [workdir] [out.mp4]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const MAGICK = '/opt/homebrew/bin/magick';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORK = process.argv[2] || path.join(process.env.HOME, 'Desktop', 'Daccord_Video', 'demo_work');
const PERSONAL = path.join(path.dirname(WORK), 'personal');
const OUT = process.argv[3] || path.join(path.dirname(WORK), 'daccord_demo.mp4');
const MUSIC = process.env.MUSIC || path.join(path.dirname(WORK), 'daccord_music.mp3');
const SEG = path.join(WORK, 'seg');
const CARDS = path.join(WORK, 'cards');
fs.mkdirSync(SEG, { recursive: true }); fs.mkdirSync(CARDS, { recursive: true });
const LEAD = 0.3;
const PAPER = '#F7F1E3', INK = '#1A160F', MUTED = '#6B6353', LIME_TEXT = '#44560A';
const SERIF = '/System/Library/Fonts/Supplemental/Georgia.ttf';
const SERIF_I = '/System/Library/Fonts/Supplemental/Georgia Italic.ttf';
const MUSIC_DB = -21;

const A = (n) => path.join(WORK, 'audio', `${n}.mp3`);
const dur = (f) => parseFloat(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const hasAudio = (f) => execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', f]).toString().trim() !== '';
const ff = (args) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const V_OUT = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30'];
const A_OUT = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];
const find = (base) => ['.mov', '.mp4', '.mkv', '.MOV', '.MP4'].map((e) => path.join(PERSONAL, base + e)).find(fs.existsSync);
const f3 = (x) => x.toFixed(3);

function mix(cues, firstInput, len) {
  if (!cues.length) return `anullsrc=r=48000:cl=stereo,atrim=0:${f3(len)}[aout]`;
  const parts = cues.map((c, i) => {
    const ms = Math.max(0, Math.round(c.t * 1000));
    return `[${firstInput + i}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${c.vol ?? 1},adelay=${ms}|${ms}[a${i}]`;
  });
  return [...parts, `${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0:dropout_transition=0,apad,atrim=0:${f3(len)}[aout]`].join(';');
}

// A paper card in the site's style (ink border, hard offset shadow), rendered by
// headless Chrome with a transparent background (this ffmpeg has no drawtext).
function card(name, lines, width = 520) {
  const file = path.join(CARDS, `${name}.png`);
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const font = (f) => (f === 'mono' ? "'Geist Mono', Menlo, monospace" : f === 'serif' ? "'Fraunces', Georgia, serif" : f === 'italic' ? "italic 'Fraunces', Georgia, serif" : "'Geist', Helvetica, sans-serif");
  const body = lines.map(([text, size, color, f, weight]) =>
    `<div style="font-family:${font(f)};font-size:${size}px;line-height:1.22;color:${color};font-weight:${weight || (f === 'serif' ? 600 : 400)};${f === 'italic' ? 'font-style:italic;' : ''}${f === 'mono' ? 'letter-spacing:.14em;' : ''}margin:0 0 ${Math.round(size * 0.32)}px">${esc(text)}</div>`).join('');
  const html = file.replace(/\.png$/, '.html');
  fs.writeFileSync(html, `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,600;1,500&family=Geist:wght@400;600&family=Geist+Mono:wght@500&display=block" rel="stylesheet"></head>
<body style="margin:0;padding:14px;background:transparent"><div style="display:inline-block;box-sizing:border-box;width:${width}px;background:#FFFDF4;border:2px solid ${INK};box-shadow:7px 7px 0 ${INK};padding:22px 26px 12px">${body}</div></body></html>`);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=5000',
    '--default-background-color=00000000', `--window-size=${width + 60},560`, `--screenshot=${file}`, 'file://' + html], { stdio: 'ignore' });
  execFileSync(MAGICK, [file, '-trim', '+repage', file]);
  return file;
}

let n = 0;
const segs = [];
const next = () => path.join(SEG, `${String(++n).padStart(2, '0')}.mp4`);

function site(scene, cues) {
  const v = path.join(WORK, 'site', `${scene}.mp4`);
  const len = dur(v); const out = next();
  const cs = cues.map((c) => ({ ...c, file: A(c.line) }));
  ff(['-i', v, ...cs.flatMap((c) => ['-i', c.file]), '-filter_complex', mix(cs, 1, len),
    '-map', '0:v', '-map', '[aout]', ...V_OUT, ...A_OUT, '-t', f3(len), out]);
  segs.push(out); console.log(`✓ ${path.basename(out)} site/${scene} ${len.toFixed(1)}s`);
}

function slate(label, script, seconds) {
  const png = path.join(WORK, `slate_${n + 1}.png`);
  execFileSync(MAGICK, ['-size', '1920x1080', `xc:${PAPER}`,
    '-font', SERIF, '-fill', LIME_TEXT, '-pointsize', '34', '-gravity', 'north', '-annotate', '+0+170', label.toUpperCase(),
    '(', '-size', '1400x', '-background', 'none', '-font', SERIF_I, '-fill', INK, '-pointsize', '50', '-gravity', 'center', `caption:${script}`, ')',
    '-gravity', 'center', '-geometry', '+0+40', '-composite', png]);
  const out = next();
  ff(['-loop', '1', '-t', String(seconds), '-i', png, '-filter_complex', `[0:v]scale=1920:1080,format=yuv420p[v];` + mix([], 1, seconds),
    '-map', '[v]', '-map', '[aout]', ...V_OUT, ...A_OUT, '-t', String(seconds), out]);
  segs.push(out); console.log(`… ${path.basename(out)} SLATE ${label} ${seconds}s`);
}

// Dorien on camera: centred, side strips from a blurred copy of the clip, optional overlay.
function personal(base, label, script, seconds, overlay) {
  const f = find(base);
  if (!f) return slate(label, script, seconds);
  const len = dur(f); const out = next();
  const ov = overlay && fs.existsSync(path.join(WORK, overlay)) ? path.join(WORK, overlay) : null;
  const v = `[0:v]split[bg0][fg0];[bg0]scale=1920:-2,crop=1920:1080:0:(ih-1080)*0.55,boxblur=28:2,eq=brightness=-0.07:saturation=0.85[bg];` +
    `[fg0]scale=-2:1080:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:0` + (ov ? `[base];[base][1:v]overlay=0:0:eof_action=pass` : '') + `,setsar=1,format=yuv420p[v]`;
  const a = hasAudio(f) ? `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5[aout]` : `anullsrc=r=48000:cl=stereo,atrim=0:${len}[aout]`;
  ff(['-i', f, ...(ov ? ['-i', ov] : []), '-filter_complex', `${v};${a}`, '-map', '[v]', '-map', '[aout]', ...V_OUT, ...A_OUT, '-t', f3(len), out]);
  segs.push(out); console.log(`✓ ${path.basename(out)} personal ${path.basename(f)} ${len.toFixed(1)}s${ov ? ' + overlay' : ''}`);
}

// ── the real take ───────────────────────────────────────────────────────────
const DEMO = path.join(WORK, 'demo');
const tl = JSON.parse(fs.readFileSync(path.join(DEMO, 'timeline.json'), 'utf8'));
const M = tl.marks;
const TAKE = path.join(DEMO, 'take.mp4');
const REAL = tl.paypal === 'sandbox';
const recordedOn = new Date(tl.recorded).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Panama' });

// Cold open: the take's own receipt as the PAID stamp lands, with a soft chime.
function cold() {
  const a = M.paid - 0.1, len = 3.9, out = next();
  const png = card('cold_badge', REAL
    ? [['A REAL RUN · PAYPAL SANDBOX', 17, LIME_TEXT, 'mono'], [`daccord.hero-apps.com · ${recordedOn}`, 26, INK, 'serif']]
    : [['PREVIEW TAKE', 17, LIME_TEXT, 'mono'], ['PayPal hold and payout in labelled simulated mode', 24, INK, 'serif']], 470);
  const bell = (f, d) => `sine=f=${f}:d=${d}:r=48000,afade=t=out:st=0:d=${d}:curve=exp`;
  const hit = Math.round((0.1 + 0.9 + 0.33) * 1000);
  ff(['-ss', f3(a), '-t', f3(len), '-i', TAKE, '-i', png, '-filter_complex',
    `[0:v]fps=30,scale=1920:1080,setsar=1[t];[t][1:v]overlay=x=70:y=H-h-70:enable='gte(t,0.6)',format=yuv420p[v];` +
    `${bell(1318, 1.2)},volume=0.22[a1];${bell(1976, 0.9)},volume=0.12[a2];[a1][a2]amix=inputs=2:normalize=0,adelay=${hit}|${hit},aformat=channel_layouts=stereo,apad,atrim=0:${len}[aout]`,
    '-map', '[v]', '-map', '[aout]', ...V_OUT, ...A_OUT, '-t', f3(len), out]);
  segs.push(out); console.log(`✓ ${path.basename(out)} cold open ${len}s`);
}

function demo() {
  const T = dur(TAKE);
  const lineLen = (l) => dur(A(l));
  const cues = tl.audio.map((c) => ({ line: c.line, t: c.t, end: c.t + lineLen(c.line) }));
  // 1x zones: every voice line, plus each moment a result lands on screen.
  const keep = cues.map((c) => [c.t - 0.3, c.end + 0.5]);
  const hold = (t, before, after) => t != null && keep.push([t - before, t + after]);
  hold(M.held, 0.2, 1.8); hold(M.verify_end, 0.4, 2.6); hold(M.paid, 0.2, 3.2);
  hold(M.threat1_done, 0.3, 2.2); hold(M.threat2_done, 0.3, 3.0); hold(M.threat2_read, 0, 4.4); hold(M.end, 1.5, 0);
  // Navigation from the receipt to the threat lab is cut out entirely.
  const cut = M.paid_end != null && M.threat != null ? [M.paid_end + 0.4, M.threat - 0.3] : null;
  keep.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [s, e] of keep) { const S = Math.max(0, s), E = Math.min(T, e); if (merged.length && S <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(merged.at(-1)[1], E); else merged.push([S, E]); }
  // Pieces: 1x inside keep zones; quiet gaps sped up to len/3, between 0.6 s and 4 s on screen.
  const pieces = []; let cursor = 0;
  const gap = (a, b) => {
    if (b - a < 0.05) return;
    if (cut && a < cut[1] && b > cut[0]) { gap(a, Math.max(a, cut[0])); gap(Math.min(b, cut[1]), b); return; }
    const len = b - a, shown = Math.min(len, Math.max(0.6, Math.min(len / 3, 4)));
    pieces.push({ a, b, k: len / shown });
  };
  for (const [s, e] of merged) { gap(cursor, s); if (!(cut && s >= cut[0] && e <= cut[1])) pieces.push({ a: s, b: e, k: 1 }); cursor = e; }
  gap(cursor, T);
  pieces.sort((x, y) => x.a - y.a);
  const map = (t) => { let o = 0; for (const p of pieces) { if (t >= p.b) o += (p.b - p.a) / p.k; else if (t > p.a) return o + (t - p.a) / p.k; else return o; } return o; };
  const len = map(T);

  // Cards: live badge, then each sped-up wait with its real duration.
  const overlays = [];
  const ov = (png, from, to, x = 'W-w-60', y = '130') => overlays.push({ png, from, to, x, y });
  ov(card('live_badge', [['LIVE APP · ONE CONTINUOUS TAKE', 17, LIME_TEXT, 'mono'],
    [`daccord.hero-apps.com · ${recordedOn}`, 27, INK, 'serif'],
    [REAL ? 'PayPal sandbox and Claude, nothing staged.' : 'Claude verification is live; the PayPal hold runs in labelled simulated mode.', 20, MUTED, 'italic']], 520), map(0) + 0.3, map(0) + 6.5);
  if (tl.waits.verify) ov(card('verify_stamp', [['VERIFIED IN', 17, LIME_TEXT, 'mono'], [`${tl.waits.verify.toFixed(1)} s`, 52, INK, 'serif'],
    ['two Claude passes on the real PR; the wait is shown faster', 20, MUTED, 'italic']], 400), map(M.verify_start) + 1.0, map(M.verify_end) + 2.5);
  if (REAL && tl.waits.paypal) ov(card('paypal_stamp', [['CLIENT APPROVED IN PAYPAL', 17, LIME_TEXT, 'mono'], [`${tl.waits.paypal.toFixed(0)} s`, 52, INK, 'serif'],
    ['sandbox buyer login and approval; shown faster', 20, MUTED, 'italic']], 400), map(M.popup_open) + 0.4, map(M.held) - 0.05, '70', '(H-h)/2');
  if (tl.receipt && REAL) ov(card('receipt_stamp', [['RETURNED BY PAYPAL SANDBOX', 17, LIME_TEXT, 'mono'],
    [`Capture ${tl.receipt.captureStatus || ''}`.trim(), 26, INK, 'serif'], [`Payout batch ${tl.receipt.batchStatus || ''}`.trim(), 26, INK, 'serif']], 420), map(M.paid) + 1.4, map(M.paid_end ?? M.paid + 6), '70', 'H-h-70');

  const cs = cues.map((c) => ({ line: c.line, t: map(c.t), file: A(c.line) }));
  // Guard: no voice line may run into the next one after retiming.
  cs.forEach((c, i) => { if (cs[i + 1] && c.t + dur(c.file) > cs[i + 1].t + 0.05) console.warn(`⚠ ${c.line} overlaps ${cs[i + 1].line}`); });

  let fc = `[0:v]fps=30,scale=1920:1080,setsar=1,split=${pieces.length}${pieces.map((_, i) => `[p${i}]`).join('')};`;
  fc += pieces.map((p, i) => `[p${i}]trim=${f3(p.a)}:${f3(p.b)},setpts=(PTS-STARTPTS)/${p.k.toFixed(4)}[q${i}]`).join(';');
  fc += ';' + pieces.map((_, i) => `[q${i}]`).join('') + `concat=n=${pieces.length}:v=1:a=0,fps=30[v0]`;
  const inputs = ['-i', TAKE];
  let last = 'v0', idx = 1;
  // The PayPal window (real mode), retimed with the same pieces as the take it ran beside.
  const POP = path.join(DEMO, 'popup.mp4');
  if (REAL && fs.existsSync(POP) && M.popup_first_frame != null) {
    const off = M.popup_first_frame, pend = M.popup_closed;
    const pp = pieces.map((p) => ({ a: Math.max(p.a, off), b: Math.min(p.b, pend), k: p.k })).filter((p) => p.b - p.a > 0.05);
    inputs.push('-i', POP);
    fc += `;[${idx}:v]fps=30,scale=-2:900,setsar=1,split=${pp.length}${pp.map((_, i) => `[u${i}]`).join('')};`;
    fc += pp.map((p, i) => `[u${i}]trim=${f3(p.a - off)}:${f3(p.b - off)},setpts=(PTS-STARTPTS)/${p.k.toFixed(4)}[w${i}]`).join(';');
    fc += ';' + pp.map((_, i) => `[w${i}]`).join('') + `concat=n=${pp.length}:v=1:a=0,fps=30,setpts=PTS+${f3(map(off))}/TB,pad=iw+8:ih+8:4:4:color=0x1A160F[pop]`;
    fc += `;[${last}][pop]overlay=x=W-w-90:y=(H-h)/2+20:eof_action=pass[vp]`; last = 'vp'; idx++;
  }
  overlays.forEach((o, i) => {
    inputs.push('-i', o.png);
    fc += `;[${last}][${idx}:v]overlay=x=${o.x}:y=${o.y}:enable='between(t,${f3(o.from)},${f3(o.to)})'[o${i}]`;
    last = `o${i}`; idx++;
  });
  fc += `;[${last}]format=yuv420p[vout];` + mix(cs, idx, len);
  const out = next();
  ff([...inputs, ...cs.flatMap((c) => ['-i', c.file]), '-filter_complex', fc, '-map', '[vout]', '-map', '[aout]', ...V_OUT, ...A_OUT, '-t', f3(len), out]);
  segs.push(out);
  demoMarks = { submit: map(M.submit), verified: map(M.verified ?? M.verify_end), threat: map(M.threat) };
  console.log(`✓ ${path.basename(out)} demo take ${len.toFixed(1)}s (from ${T.toFixed(1)}s raw, ${pieces.filter((p) => p.k > 1).length} quiet stretches sped up)`);
}

fs.readdirSync(SEG).forEach((f) => fs.unlinkSync(path.join(SEG, f)));

// YouTube chapters: first at 0:00, each at least 10 s; the short cold open merges into the first.
let demoMarks = null;
const chapters = [];
const at = () => segs.reduce((a, s) => a + dur(s), 0);
const chapter = (title, offset = 0) => chapters.push({ t: at() + offset, title });

chapter('Why freelancers wait to get paid');
cold();
personal('p1_open', 'Your clip P1: who you are and the pain, about 15 s',
  "Hi, I'm Dorien. I build websites and apps for small businesses in Panama, as a freelancer. The hardest part isn't the work. It's getting paid for it, once it's done.", 15, 'intro/overlay.mov');
chapter("Meet D'accord");
site('hero', [{ line: 'n_intro', t: LEAD }]);
const demoStart = at();
chapter('Live demo: criteria and a PayPal hold');
demo();
chapters.push({ t: demoStart + demoMarks.submit, title: 'Claude verifies a real pull request' });
chapters.push({ t: demoStart + demoMarks.verified, title: 'Release and PayPal payout' });
chapters.push({ t: demoStart + demoMarks.threat, title: 'Threat lab: trying to cheat the verifier' });
chapter('Under the hood');
site('arch', [{ line: 'n_arch', t: LEAD }]);
chapter("Who it's for and what's next");
personal('p2_story', 'Your clip P2: who it is for and what is next, about 16 s',
  "I built D'accord for freelancers like me. Next comes the forty-eight hour rule, so a silent client can't sit on verified work, and contracts with many milestones in one hold.", 16, 'intro/overlay2.mov');
site('close', [{ line: 'n_close', t: LEAD }]);

const list = path.join(SEG, 'list.txt');
fs.writeFileSync(list, segs.map((s) => `file '${s}'`).join('\n'));
const joined = path.join(WORK, 'joined.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
const T = dur(joined);

// Music bed (ElevenLabs original, cleared): loop with a crossfade, duck under every voice, fade out.
const md = dur(MUSIC);
const loops = Math.ceil(T / (md - 3)) + 1;
let mfc = '';
for (let i = 0; i < loops; i++) mfc += `[${1 + i}:a]aformat=sample_rates=48000:channel_layouts=stereo[m${i}];`;
let lastM = 'm0';
for (let i = 1; i < loops; i++) { mfc += `[${lastM}][m${i}]acrossfade=d=3[mx${i}];`; lastM = `mx${i}`; }
mfc += `[${lastM}]atrim=0:${f3(T)},volume=${MUSIC_DB}dB,afade=t=in:d=1.5,afade=t=out:st=${f3(T - 3)}:d=3[bed];`;
mfc += `[0:a]asplit=2[voice][key];[bed][key]sidechaincompress=threshold=0.02:ratio=8:attack=40:release=600[ducked];`;
mfc += `[voice][ducked]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11[aout]`;
ff(['-i', joined, ...Array.from({ length: loops }, () => ['-i', MUSIC]).flat(), '-filter_complex', mfc,
  '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', ...A_OUT, '-movflags', '+faststart', OUT]);
const total = dur(OUT);
console.log(`\n${total < 180 ? '✅' : '⚠ OVER 3:00'} ${OUT} (${total.toFixed(1)}s, ${segs.length} segments)`);
segs.forEach((s) => console.log(`  ${path.basename(s)} ${dur(s).toFixed(1)}s`));
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const ok = chapters.every((c, i) => i === 0 ? c.t === 0 : c.t - chapters[i - 1].t >= 10) && total - chapters.at(-1).t >= 10;
fs.writeFileSync(path.join(WORK, 'chapters.json'), JSON.stringify({ total, chapters: chapters.map((c) => ({ ...c, t: +c.t.toFixed(2) })) }, null, 2));
console.log(`\nChapters${ok ? '' : ' (⚠ one is under 10 s; YouTube will ignore them)'}:`);
chapters.forEach((c) => console.log(`  ${mmss(c.t)} ${c.title}`));
