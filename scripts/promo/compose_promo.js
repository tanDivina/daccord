#!/usr/bin/env node
// Composes the final 1920x1080 promo from the raw recording:
// - compresses the live Claude-verification wait so pacing stays tight
//   (but never shorter than the narrator's verification line),
// - overlays the caption pills at the remapped scene marks,
// - crossfades into the end card,
// - mixes the narration stems (level-matched) with optional ducked music.
// Usage: node compose_promo.js [workdir] [out.mp4] [music.mp3]
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const WORK = process.argv[2] || path.join(process.env.HOME, 'Desktop', 'Daccord_Video', 'promo_work');
const OUT = process.argv[3] || path.join(path.dirname(WORK), 'daccord_promo.mp4');
const MUSIC = process.argv[4] || process.env.MUSIC || null;

const tl = JSON.parse(fs.readFileSync(path.join(WORK, 'timeline.json')));
const m = tl.marks;
const RAW = path.join(WORK, 'raw_screen.mp4');
const T = parseFloat(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', RAW]).toString());
const dur = (f) => { try { return parseFloat(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()); } catch { return 3; } };
const f3 = (n) => n.toFixed(3);

// ── Retiming: compress the verification wait ───────────────────────────────
const nVerify = tl.audio.find((c) => c.name === 'n_verify');
const a = Math.min(m.verify_start + 1.2, m.verify_end);
const b = Math.max(a, m.verify_end - 0.5);
let f = 1;
if (b - a > 2) {
  const cueT = nVerify ? nVerify.t : a;
  const voiceNeeds = nVerify && fs.existsSync(nVerify.file) ? cueT + dur(nVerify.file) + 0.7 - a : 3;
  const target = Math.min(b - a, Math.max(3, voiceNeeds));
  f = target / (b - a);
}
const mapT = (t) => (t <= a ? t : t < b ? a + (t - a) * f : t - (b - a) * (1 - f));
const MT = mapT(T); // mapped duration of the screen part
console.log(`verify span ${f3(a)}–${f3(b)} compressed x${(1 / f).toFixed(2)} → screen part ${f3(MT)}s (raw ${f3(T)}s)`);

// ── End card length: the outro line may run past the screen part ───────────
const XF = 0.5;
const outroCue = tl.audio.find((c) => c.name === 'n_outro');
let END_CARD = 3.6;
if (outroCue && fs.existsSync(outroCue.file)) {
  const needed = mapT(outroCue.t) + dur(outroCue.file) + 1.0 - (MT - XF);
  END_CARD = Math.max(END_CARD, needed);
}
const TOTAL = MT - XF + END_CARD;

// ── Captions ────────────────────────────────────────────────────────────────
const spans = [];
const add = (name, s, e) => {
  if (s == null || e == null) return;
  const S = mapT(s), E = Math.max(mapT(e), mapT(s) + 0.8);
  const file = path.join(WORK, 'captions', `${name}.png`);
  if (fs.existsSync(file)) spans.push({ name, file, s: S, e: Math.min(E, MT - 0.2) });
};
add('c_hook', m.hero + 0.3, m.criteria - 0.2);
add('c_criteria', m.criteria, m.hold - 0.2);
add('c_hold', m.hold, m.submit - 0.2);
add('c_submit', m.submit, m.verify_start + 0.9);
add('c_verify', m.verify_start + 1.1, m.verify_end + 2.2);
if (tl.verified) {
  add('c_release', m.verified + 0.3, m.paid - 0.2);
  add('c_paid', m.paid, m.threat - 0.2);
}
add('c_threat', m.threat, m.outro - 0.1);

// ── Inputs ──────────────────────────────────────────────────────────────────
const inputs = ['-i', RAW, '-i', path.join(WORK, 'endcard.png')];
spans.forEach((c) => inputs.push('-i', c.file));
const CAP0 = 2;
const clips = tl.audio.filter((c) => fs.existsSync(c.file));
const AUD0 = CAP0 + spans.length;
clips.forEach((c) => inputs.push('-i', c.file));
let MUS = -1;
if (MUSIC && fs.existsSync(MUSIC)) { MUS = AUD0 + clips.length; inputs.push('-i', MUSIC); }

// ── Video graph ─────────────────────────────────────────────────────────────
const parts = [];
if (f < 1) {
  parts.push(
    `[0:v]trim=0:${f3(a)},setpts=PTS-STARTPTS[s0]`,
    `[0:v]trim=${f3(a)}:${f3(b)},setpts=(PTS-STARTPTS)*${f.toFixed(5)}[s1]`,
    `[0:v]trim=${f3(b)},setpts=PTS-STARTPTS[s2]`,
    `[s0][s1][s2]concat=n=3:v=1,fps=30[vt]`
  );
} else {
  parts.push(`[0:v]fps=30[vt]`);
}
let cur = 'vt';
spans.forEach((c, i) => {
  const d = c.e - c.s;
  parts.push(
    `[${CAP0 + i}:v]format=rgba,loop=-1:size=1:start=0,trim=0:${f3(d)},setpts=PTS-STARTPTS,` +
      `fade=t=in:st=0:d=0.3:alpha=1,fade=t=out:st=${f3(Math.max(0, d - 0.3))}:d=0.3:alpha=1,setpts=PTS+${f3(c.s)}/TB[c${i}]`,
    `[${cur}][c${i}]overlay=0:0:eof_action=pass[v${i}]`
  );
  cur = `v${i}`;
});
parts.push(`[${cur}]format=yuv420p,setsar=1[main]`);
parts.push(`[1:v]loop=-1:size=1:start=0,trim=duration=${f3(END_CARD)},setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[ec]`);
parts.push(`[main][ec]xfade=transition=fade:duration=${XF}:offset=${f3(MT - XF)}[vout]`);

// ── Audio graph ─────────────────────────────────────────────────────────────
const VOICE_TARGET = -20;
const gainOf = (file) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const mm = /mean_volume:\s*(-?[\d.]+)/.exec(r.stderr || '');
  return VOICE_TARGET - (mm ? parseFloat(mm[1]) : VOICE_TARGET);
};
const aparts = clips.map((c, i) => {
  const d = Math.round(mapT(c.t) * 1000);
  const g = gainOf(c.file);
  console.log(`  stem ${c.name}: ${g >= 0 ? '+' : ''}${g.toFixed(1)} dB @ ${(d / 1000).toFixed(2)}s`);
  return `[${AUD0 + i}:a]volume=${g.toFixed(2)}dB,adelay=${d}|${d},aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`;
});
let mix;
if (clips.length) {
  const voices = `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,apad=whole_dur=${f3(TOTAL)}`;
  if (MUS >= 0) {
    aparts.push(`[${MUS}:a]dynaudnorm=f=400:g=15:p=0.7:m=8,volume=0.07,afade=t=in:d=1.5,atrim=0:${f3(TOTAL)},afade=t=out:st=${f3(TOTAL - 2.5)}:d=2.5,aformat=sample_rates=44100:channel_layouts=stereo[am]`);
    mix = [
      `${voices},asplit=2[vx][vsc]`,
      `[am][vsc]sidechaincompress=threshold=0.015:ratio=8:attack=60:release=700:makeup=1[duck]`,
      `[duck][vx]amix=inputs=2:normalize=0:dropout_transition=0,volume=4dB,alimiter=limit=0.89:attack=5:release=60:level=false[aout]`,
    ].join(';\n');
  } else {
    mix = `${voices},volume=3dB,alimiter=limit=0.89:attack=5:release=60:level=false[aout]`;
  }
} else {
  mix = `anullsrc=r=44100:cl=stereo,atrim=0:${f3(TOTAL)}[aout]`;
}

const filter = [...parts, ...aparts, mix].join(';\n');
const fscript = path.join(WORK, 'filter.txt');
fs.writeFileSync(fscript, filter);
const args = ['-y', ...inputs, '-filter_complex_script', fscript, '-map', '[vout]', '-map', '[aout]', '-t', f3(TOTAL),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT];
console.log(`composing ${OUT} (${TOTAL.toFixed(1)}s)`);
execFileSync(FFMPEG, args, { stdio: ['ignore', 'inherit', 'pipe'] });
console.log('done');
