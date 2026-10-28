#!/usr/bin/env node
// Generates the narration clips with ElevenLabs into WORK/audio/.
// A line is a string, or an array of parts joined with short pauses; a part
// { "fr": "D'accord." } is spoken with language_code fr (same voice and model)
// so the product name gets its French pronunciation inside English narration.
// If audio/name_fr.wav exists (an approved take), it is used for every French part.
// Needs ELEVENLABS_API_KEY in the environment (falls back to ~/Projects/daccord/.env.local).
// Usage: node generate_narration.cjs [workdir] [line,line...]   (default ~/Desktop/Daccord_Video/demo_work)
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const WORK = process.argv[2] || path.join(process.env.HOME, 'Desktop', 'Daccord_Video', 'demo_work');
const AUDIO = path.join(WORK, 'audio');
const PARTS = path.join(AUDIO, 'parts');
fs.mkdirSync(PARTS, { recursive: true });
const GAP_BEFORE_NAME = 0.14, GAP_AFTER_NAME = 0.32, GAP = 0.2;

function loadKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const envFile = path.join(process.env.HOME, 'Projects', 'daccord', '.env.local');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^ELEVENLABS_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  console.error('ELEVENLABS_API_KEY not set. Aborting.');
  process.exit(1);
}

const meanDb = (f) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', f, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume:\s*(-?[\d.]+)/.exec(r.stderr || '');
  return m ? parseFloat(m[1]) : -20;
};

async function main() {
  const key = loadKey();
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'narration.json'), 'utf8'));
  const voiceId = process.env.VOICE_ID || cfg.voiceId;
  const only = process.argv[3] ? process.argv[3].split(',') : null;

  const tts = async (text, out, lang) => {
    const settings = lang ? { ...cfg.voiceSettings, speed: cfg.nameSpeed ?? 1.0 } : cfg.voiceSettings;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: cfg.modelId, voice_settings: settings, ...(lang ? { language_code: lang } : {}), ...(cfg.seed ? { seed: cfg.seed } : {}) }),
    });
    if (!res.ok) { console.error(`${path.basename(out)}: ElevenLabs ${res.status} ${await res.text()}`); process.exit(1); }
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  };

  for (const [name, line] of Object.entries(cfg.lines)) {
    if (only && !only.includes(name)) continue;
    const out = path.join(AUDIO, `${name}.mp3`);
    if (fs.existsSync(out) && !process.env.FORCE && !only) { console.log(`skip ${name} (exists)`); continue; }
    if (typeof line === 'string') {
      await tts(line, out);
    } else {
      // Each part trimmed of edge silence, French parts level-matched to the English ones, joined with pauses.
      const wavs = [];
      for (const [i, part] of line.entries()) {
        const fr = typeof part === 'object';
        const wav = path.join(PARTS, `${name}_${i}.wav`);
        // The name is one approved take reused everywhere: takes vary, and only some sound French.
        const master = fr && path.join(AUDIO, 'name_fr.wav');
        if (fr && fs.existsSync(master)) { fs.copyFileSync(master, wav); wavs.push({ wav, fr }); continue; }
        const raw = path.join(PARTS, `${name}_${i}.mp3`);
        await tts(fr ? part.fr : part, raw, fr ? 'fr' : null);
        execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af',
          'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,aformat=sample_rates=44100:channel_layouts=mono', wav]);
        wavs.push({ wav, fr });
      }
      const english = wavs.filter((w) => !w.fr);
      const target = english.length ? english.reduce((a, w) => a + meanDb(w.wav), 0) / english.length : null;
      const inputs = []; const chain = [];
      wavs.forEach((w, i) => {
        inputs.push('-i', w.wav);
        const gain = w.fr && target !== null ? target - meanDb(w.wav) : 0;
        const next = wavs[i + 1];
        const pad = !next ? 0 : next.fr ? GAP_BEFORE_NAME : w.fr ? GAP_AFTER_NAME : GAP;
        chain.push(`[${i}:a]volume=${gain.toFixed(2)}dB,apad=pad_dur=${pad}[p${i}]`);
      });
      const fc = `${chain.join(';')};${wavs.map((_, i) => `[p${i}]`).join('')}concat=n=${wavs.length}:v=0:a=1[a]`;
      execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', fc, '-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', out]);
    }
    console.log(`✓ ${name}.mp3 (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
