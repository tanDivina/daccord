# D'accord promo pipeline

Records the real app and produces a 1920x1080 promo with narration.

## One-time setup

1. Keys in `daccord/.env.local`: `ANTHROPIC_API_KEY` (verification), `ELEVENLABS_API_KEY` (narration). `DACCORD_SIGNING_SECRET` is optional in dev. PayPal keys optional (funding shows simulated without them).
2. The demo PR must exist with green CI: `github.com/tanDivina/paypal-orders-service/pull/1` (repo in `~/Projects/paypal-orders-service`), and its staging deployed so `https://paypal-orders-service.vercel.app/api/health` answers 200.

## Produce the video

```bash
cd ~/Projects/daccord && npm run dev          # terminal 1 (reads .env.local)
node scripts/promo/generate_narration.js      # once; FORCE=1 to regenerate
node scripts/promo/make_overlays.js           # end card + caption pills
curl -s https://paypal-orders-service.vercel.app/api/health > /dev/null  # pre-warm staging
node scripts/promo/record_promo.js            # drives the app, ~2 min
node scripts/promo/compose_promo.js           # writes ~/Desktop/Daccord_Video/daccord_promo.mp4
```

Music is optional: `node scripts/promo/compose_promo.js "" "" /path/to/track.mp3`.

Env overrides: `APP_URL`, `DEMO_PR_URL`, `DEMO_STAGING_URL`, `DEMO_RECEIVER`, `DACCORD_VOICE_ID`, `DACCORD_TTS_MODEL`.

The composer compresses the live Claude-verification wait (never shorter than the narrator's line) and extends the end card so the outro line finishes.
