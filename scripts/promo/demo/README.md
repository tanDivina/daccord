# D'accord demo video (under 3:00)

The hackathon submission video. Media lives in `~/Desktop/Daccord_Video/` (`demo_work/` is regenerable; `personal/` holds Dorien's on-camera clips). The older 79 s promo pipeline is one folder up.

Run in order:

1. `node generate_narration.cjs` - narration in Dorien's garden clone voice (settings in `narration.json`; the product name is spelled "Dah-kor" for TTS). `node generate_narration.cjs <work> n_x,n_y` regenerates single lines; copy the old mp3 to `<line>.old.mp3` first.
2. `node record_site.cjs` - live-site scenes: `hero`, `arch` (cards lit on the narration's word times), `close`. Re-record a scene after changing its line.
3. `node record_demo.cjs` - one continuous take of the live app, end to end.
   - `PAYPAL=real` (default) opens a visible Chrome window. When PayPal's window opens, log in with a **sandbox buyer** account and approve; the script waits up to 6 minutes, records the PayPal window too, then finishes on its own.
   - `PAYPAL=sim` runs unattended with the app's labelled simulated hold (preview cuts).
4. `node compose.cjs` - cold open, Dorien's clips (slates until `personal/p1_open` and `personal/p2_story` exist), hero, demo, architecture, close, ducked music. Prints the length and writes `demo_work/chapters.json`.
5. `node make_thumbnail.cjs` and `node make_youtube.cjs` - thumbnail and YouTube copy from the take's measured numbers and the current chapters.

The demo keeps 1x speed wherever the voice speaks or a result lands; only quiet stretches are sped up, each long wait stamped with its real duration.
