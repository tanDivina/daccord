import type { SVGProps } from "react";

// The Maître: D'accord's face. In France a notary is addressed as "Maître",
// and a maître d' is the person who seats two parties at the same table —
// both jobs this product does. Filled-ink illustration: solid tailcoat,
// monocle (he inspects the work), pencil moustache, the contract over his
// forearm, the verdict seal served on a tray. Drawn by hand; keep every
// stroke deliberate.

type MaitreProps = SVGProps<SVGSVGElement> & {
  pose?: "greet" | "inspect" | "serve";
  verdict?: "pass" | "fail";
};

const INK = "#1A160F";
const SKIN = "#F3E7CE";
const PAPER = "#FFFDF4";
const ACCENT = "var(--icon-accent)";
const FAIL = "#C8473B";
const SEAL =
  "M12 4.4Q14.43 2.92 15.8 5.42Q18.65 5.35 18.58 8.2Q21.08 9.57 19.6 12Q21.08 14.43 18.58 15.8Q18.65 18.65 15.8 18.58Q14.43 21.08 12 19.6Q9.57 21.08 8.2 18.58Q5.35 18.65 5.42 15.8Q2.92 14.43 4.4 12Q2.92 9.57 5.42 8.2Q5.35 5.35 8.2 5.42Q9.57 2.92 12 4.4Z";

export function Maitre({ pose = "greet", verdict = "pass", ...props }: MaitreProps) {
  const happy = pose !== "serve" || verdict === "pass";
  const sealColor = verdict === "pass" ? ACCENT : FAIL;
  return (
    <svg viewBox="28 8 116 160" fill="none" aria-hidden="true" {...props}>
      {/* right arm, per pose (drawn first so the body overlaps the shoulder) */}
      {pose === "greet" && (
        <>
          <path d="M92 66 Q104 65 111 57" stroke={INK} strokeWidth={9} strokeLinecap="round" />
          <circle cx="112.5" cy="55.5" r="5.2" fill={SKIN} stroke={INK} strokeWidth={2} />
        </>
      )}
      {pose === "inspect" && (
        <>
          <path d="M90 66 Q100 63 97 54" stroke={INK} strokeWidth={9} strokeLinecap="round" />
          <circle cx="106" cy="38.5" r="9" fill={ACCENT} fillOpacity={0.12} stroke={INK} strokeWidth={2.5} />
          <path d="M101.5 34.5 Q99.5 36 99 38.5" stroke={ACCENT} strokeWidth={1.6} strokeLinecap="round" />
          <path d="M100.9 45.5 L96.5 52.5" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
          <circle cx="96.5" cy="53" r="5.2" fill={SKIN} stroke={INK} strokeWidth={2} />
        </>
      )}
      {pose === "serve" && (
        <>
          <path d="M92 66 Q108 60 116 48" stroke={INK} strokeWidth={9} strokeLinecap="round" />
          <path d="M117 41 L117 36.5" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
          <path d="M98 36.5 L136 36.5" stroke={INK} strokeWidth={4} strokeLinecap="round" />
          <circle cx="117" cy="45" r="5.2" fill={SKIN} stroke={INK} strokeWidth={2} />
          <g transform="translate(117 23.5) translate(-12 -12)">
            <path d={SEAL} fill={sealColor} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
            {verdict === "pass" ? (
              <path d="M8.9 12.2 L11 14.3 L15.2 9.8" stroke={INK} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M9.4 9.4 L14.6 14.6 M14.6 9.4 L9.4 14.6" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
            )}
          </g>
        </>
      )}

      {/* head, slicked hair, monocle, moustache */}
      <circle cx="70" cy="34" r="17" fill={SKIN} stroke={INK} strokeWidth={2.5} />
      <path d="M53.6 29.5 A17 17 0 0 1 86.4 29.5 Q70 23.5 53.6 29.5 Z" fill={INK} />
      <path d="M57.5 30.5 Q61.5 28.8 65 30.3" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      <path d="M73 29.8 Q76.8 28.2 80.5 29.9" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      <circle cx="61.5" cy="35.5" r="1.8" fill={INK} />
      <circle cx="76.5" cy="35.5" r="1.8" fill={INK} />
      <circle cx="76.5" cy="35.8" r="5.4" fill={ACCENT} fillOpacity={0.15} stroke={INK} strokeWidth={2} />
      <path d="M80.5 40 Q85 47 82 54" stroke={INK} strokeWidth={1.3} />
      <path d="M69.5 33 Q68.5 37 69.8 39.5" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      <path d="M61.5 43.8 Q66 41.6 69 43.4 M71 43.4 Q74 41.6 78.5 43.8" stroke={INK} strokeWidth={1.9} strokeLinecap="round" />
      {/* mouth: a smile, or pressed lips when the verdict is non */}
      {happy ? (
        <path d="M64.5 47.6 Q70 51 75.5 47.6" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      ) : (
        <path d="M65.5 48.4 L74.5 48.4" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      )}

      {/* tailcoat, shirt, bow tie, pocket square */}
      <path
        d="M70 52.5 L87 59.5 Q94.5 62.5 95 71.5 L96.8 111 Q97.2 119.5 88.5 119.5 L51.5 119.5 Q42.8 119.5 43.2 111 L45 71.5 Q45.5 62.5 53 59.5 Z"
        fill={INK}
      />
      <path d="M62 57.5 L70 79 L78 57.5 Q74 54 70 53.5 Q66 54 62 57.5 Z" fill={PAPER} />
      <path d="M66.8 62 L57 57.2 L57 66.8 Z" fill={ACCENT} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M73.2 62 L83 57.2 L83 66.8 Z" fill={ACCENT} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx="70" cy="62" r="3" fill={ACCENT} stroke={INK} strokeWidth={1.5} />
      <circle cx="70" cy="88" r="1.6" fill={PAPER} />
      <circle cx="70" cy="97" r="1.6" fill={PAPER} />
      <path d="M55 72 L61 72 L58 76.5 Z" fill={ACCENT} />

      {/* left arm, always with the contract folded over the forearm */}
      <path d="M48 66 Q37 76 38.5 90 Q40 99.5 50 100.5" stroke={INK} strokeWidth={9} strokeLinecap="round" />
      <path d="M33.5 95.5 L33.5 119 L52.5 119 L52.5 95.5 Z" fill={PAPER} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <path d="M33.5 100.5 L52.5 100.5" stroke={INK} strokeWidth={1.4} />
      <path d="M38 106 L48 106 M38 110 L46 110" stroke={INK} strokeWidth={1.2} strokeLinecap="round" />
      <path d="M38 114.5 c2 -3 3 -3 4 0 c1 2.4 2 2.2 3.6 0" stroke={ACCENT} strokeWidth={1.8} strokeLinecap="round" />
      <circle cx="51" cy="100.5" r="5.2" fill={SKIN} stroke={INK} strokeWidth={2} />

      {/* trousers, shoes */}
      <path d="M57.5 119.5 L56.5 156 L66 156 L68 127 L72 127 L74 156 L83.5 156 L82.5 119.5 Z" fill={INK} />
      <path d="M56.5 156 Q53 162 59.5 162 L67 162 L66.6 156 Z" fill={INK} />
      <path d="M83.5 156 Q87 162 80.5 162 L73 162 L73.4 156 Z" fill={INK} />
    </svg>
  );
}
