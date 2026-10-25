import type { SVGProps } from "react";

// The Maître: D'accord's face. In France a notary is addressed as "Maître",
// and a maître d' is the person who seats two parties at the same table —
// both jobs this product does. Same visual language as the icon set
// (src/components/icons.tsx): currentColor strokes, lime accent details,
// the wax-seal motif. Drawn by hand; keep every stroke deliberate.

type MaitreProps = SVGProps<SVGSVGElement> & {
  pose?: "greet" | "inspect" | "serve";
  verdict?: "pass" | "fail";
};

const ACCENT = "var(--icon-accent)";
const FAIL = "#f87171"; // matches the UI's red-400
const SEAL =
  "M12 4.4Q14.43 2.92 15.8 5.42Q18.65 5.35 18.58 8.2Q21.08 9.57 19.6 12Q21.08 14.43 18.58 15.8Q18.65 18.65 15.8 18.58Q14.43 21.08 12 19.6Q9.57 21.08 8.2 18.58Q5.35 18.65 5.42 15.8Q2.92 14.43 4.4 12Q2.92 9.57 5.42 8.2Q5.35 5.35 8.2 5.42Q9.57 2.92 12 4.4Z";

export function Maitre({ pose = "greet", verdict = "pass", ...props }: MaitreProps) {
  const happy = pose !== "serve" || verdict === "pass";
  return (
    <svg
      viewBox="33 7 46 82"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* head */}
      <circle cx="48" cy="19" r="9" />
      <path d="M40.6 14.5 Q43.5 10.6 49.5 11.2 Q54 11.6 55.8 14.8" strokeWidth={1.75} />
      {/* glasses */}
      <circle cx="44.4" cy="19.6" r="2.6" strokeWidth={1.6} />
      <circle cx="51.8" cy="19.6" r="2.6" strokeWidth={1.6} />
      <path d="M47 19.4 L49.2 19.4" strokeWidth={1.6} />
      <circle cx="44.4" cy="19.8" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="51.8" cy="19.8" r="0.75" fill="currentColor" stroke="none" />
      {/* mouth: a smile, or pressed lips when the verdict is non */}
      {happy ? (
        <path d="M45.9 24.6 Q48.1 26.1 50.3 24.6" strokeWidth={1.6} />
      ) : (
        <path d="M46.2 25.2 L50 25.2" strokeWidth={1.6} />
      )}
      {/* bow tie */}
      <g fill={ACCENT} stroke="none">
        <path d="M46.6 33.5 L40.8 30.6 L40.8 36.4 Z" />
        <path d="M49.4 33.5 L55.2 30.6 L55.2 36.4 Z" />
        <circle cx="48" cy="33.5" r="1.6" />
      </g>
      {/* jacket with collar and lapel V */}
      <path d="M39.8 64 L40.6 41 Q41 35.5 44.8 33.6 L48 37.4 L51.2 33.6 Q55 35.5 55.4 41 L56.2 64" />
      <path d="M45.2 34.3 L48 41.6 L50.8 34.3" />
      {/* hem, trousers, shoes */}
      <path d="M40 64 L56 64" />
      <path d="M41.8 64 L41.3 84 M46.4 64.4 L47.2 70 L48.8 70 L49.6 64.4 M54.2 64 L54.7 84" />
      <path d="M46 84 L46.5 70.5 M50 84 L49.5 70.5" />
      <path d="M41.3 84 Q40.2 86.2 42.4 86.2 L46 86.2 L46 84 M54.7 84 Q55.8 86.2 53.6 86.2 L50 86.2 L50 84" />

      {/* right arm, per pose */}
      {pose === "greet" && (
        <>
          <path d="M55.4 39.5 Q60.5 41.5 62.5 46.5" />
          <path d="M62.5 46.5 Q64.5 50.5 69.5 50" />
          <path d="M69.5 50 Q72 50.2 73.6 48.4" strokeWidth={1.8} />
        </>
      )}
      {pose === "inspect" && (
        <>
          {/* magnifier: ring, lime glint, handle down to the hand */}
          <circle cx="69" cy="19.5" r="6.2" fill={ACCENT} fillOpacity={0.07} strokeWidth={1.8} />
          <path d="M66.2 16.6 Q64.5 17.8 64.2 20" stroke={ACCENT} strokeWidth={1.4} />
          <path d="M66 24.9 Q64.2 27.8 63.8 30.5" strokeWidth={1.8} />
          <path d="M55.4 39.5 Q60 41.5 62 38" />
          <path d="M62 38 Q63.5 34.5 63.8 30.5" />
        </>
      )}
      {pose === "serve" && (
        <>
          {/* arm up waiter-style, tray on the fingertips, verdict seal served */}
          <path d="M55.4 39.5 Q61 40.5 63.5 35.5" />
          <path d="M63.5 35.5 Q66 31 66.5 26.5" />
          <path d="M58.5 24.8 L74.5 24.8" />
          <path d="M66.5 26.5 L66.5 24.8" strokeWidth={1.6} />
          <g
            transform="translate(66.5 18.4) scale(0.58) translate(-12 -12)"
            stroke={verdict === "pass" ? ACCENT : FAIL}
          >
            <path d={SEAL} />
            {verdict === "pass" ? (
              <path d="M8.9 12.2 L11 14.3 L15.2 9.8" />
            ) : (
              <path d="M9.4 9.4 L14.6 14.6 M14.6 9.4 L9.4 14.6" />
            )}
          </g>
        </>
      )}

      {/* left arm, always with the contract folded over the forearm */}
      <path d="M40.6 39.5 Q36.8 44.5 37.8 49.5 Q38.7 53 43.5 53.2" />
      <path d="M37.6 53.2 L37.6 62.5 L45.4 62.5 L45.4 53.2" />
      <path d="M37.6 55.2 L45.4 55.2" strokeWidth={1.4} />
      <path d="M39.8 59.3 c0.9 -1.2 1.6 -1.2 1.9 0 c0.3 1.1 0.9 1 1.5 0" stroke={ACCENT} strokeWidth={1.4} />
    </svg>
  );
}
