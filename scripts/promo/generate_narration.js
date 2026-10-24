#!/usr/bin/env node
// Generates the English narration clips with ElevenLabs into WORK/audio/.
// Needs ELEVENLABS_API_KEY in the environment (or in daccord/.env.local).
// Usage: node generate_narration.js [workdir]   (default ~/Desktop/Daccord_Video/promo_work)
const fs = require('fs');
const path = require('path');

const WORK = process.argv[2] || path.join(process.env.HOME, 'Desktop', 'Daccord_Video', 'promo_work');
const AUDIO = path.join(WORK, 'audio');
fs.mkdirSync(AUDIO, { recursive: true });

function loadKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const envFile = path.join(__dirname, '..', '..', '.env.local');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^ELEVENLABS_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  console.error('ELEVENLABS_API_KEY not set (env or daccord/.env.local). Aborting.');
  process.exit(1);
}

async function main() {
  const key = loadKey();
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'narration.json'), 'utf8'));
  const voiceId = process.env.DACCORD_VOICE_ID || cfg.voiceId;
  const modelId = process.env.DACCORD_TTS_MODEL || cfg.modelId;

  for (const [name, text] of Object.entries(cfg.lines)) {
    const out = path.join(AUDIO, `${name}.mp3`);
    if (fs.existsSync(out) && !process.env.FORCE) { console.log(`skip ${name} (exists)`); continue; }
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: modelId, voice_settings: cfg.voiceSettings }),
    });
    if (!res.ok) { console.error(`${name}: ElevenLabs ${res.status} ${await res.text()}`); process.exit(1); }
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log(`✓ ${name}.mp3 (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
  }
  console.log(`\nnarration in ${AUDIO}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
