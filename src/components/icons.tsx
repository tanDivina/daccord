import type { SVGProps } from "react";

// D'accord's own icon set. One motif runs through it: the wax seal and the
// signed contract. Strokes use currentColor; one detail per icon uses
// --icon-accent (lime by default, set in globals.css). Override it with
// [--icon-accent:currentColor] where the icon sits on a lime surface.

type IconProps = SVGProps<SVGSVGElement>;

const ACCENT = "var(--icon-accent)";

const SEAL =
  "M12 4.4Q14.43 2.92 15.8 5.42Q18.65 5.35 18.58 8.2Q21.08 9.57 19.6 12Q21.08 14.43 18.58 15.8Q18.65 18.65 15.8 18.58Q14.43 21.08 12 19.6Q9.57 21.08 8.2 18.58Q5.35 18.65 5.42 15.8Q2.92 14.43 4.4 12Q2.92 9.57 5.42 8.2Q5.35 5.35 8.2 5.42Q9.57 2.92 12 4.4Z";

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Contract: a page with a signature. */
export function ContractIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 3h7.5l4 4v14h-11.5z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 9.5h4M9.5 12.5h5.5" />
      <path d="M9 17.6c.8-1.5 1.6-1.6 1.9-.4.3 1.3 1 1.2 1.7.1.6-.9 1.2-.8 1.6 0 .3.6.8.7 1.3.3" stroke={ACCENT} />
    </Icon>
  );
}

/** Hold: a padlock whose keyhole carries the accent. */
export function HoldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="3" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
      <circle cx="12" cy="14.6" r="1.35" fill={ACCENT} stroke="none" />
      <path d="M12 15.6v1.9" stroke={ACCENT} />
    </Icon>
  );
}

/** Two reviewers: overlapping lenses; only where both agree is lit. */
export function ReviewersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 7.6a5.2 5.2 0 0 1 0 8.8a5.2 5.2 0 0 1 0-8.8z" fill={ACCENT} stroke="none" />
      <circle cx="9" cy="12" r="5.2" />
      <circle cx="15" cy="12" r="5.2" />
    </Icon>
  );
}

/** Payout: a coin with money leaving it. */
export function PayoutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8.5" cy="12" r="5.75" />
      <path d="M8.5 9.2v5.6" />
      <path d="M16.5 12h5M19 9.5l2.5 2.5-2.5 2.5" stroke={ACCENT} />
    </Icon>
  );
}

/** Seal with a tick: criterion met. */
export function SealCheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={SEAL} />
      <path d="M8.9 12.2l2.1 2.1 4.1-4.3" />
    </Icon>
  );
}

/** Seal with a cross: criterion not met. */
export function SealCrossIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={SEAL} />
      <path d="M9.6 9.6l4.8 4.8M14.4 9.6l-4.8 4.8" />
    </Icon>
  );
}

/** Broken seal: a piece chipped off the top right. Blocked. */
export function BrokenSealIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19.6 12Q21.08 14.43 18.58 15.8Q18.65 18.65 15.8 18.58Q14.43 21.08 12 19.6Q9.57 21.08 8.2 18.58Q5.35 18.65 5.42 15.8Q2.92 14.43 4.4 12Q2.92 9.57 5.42 8.2Q5.35 5.35 8.2 5.42Q9.57 2.92 12 4.4Q14.43 2.92 15.8 5.42L13.2 9.6L14.6 10.6Z" />
      <path
        d="M15.8 5.42Q18.65 5.35 18.58 8.2Q21.08 9.57 19.6 12L14.6 10.6L13.2 9.6Z"
        transform="translate(1.7 -1.7)"
      />
    </Icon>
  );
}

/** Guard: a shield with the seal's tick. */
export function GuardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3l7 2.6v5.6c0 4.5-2.9 7.9-7 9.8-4.1-1.9-7-5.3-7-9.8V5.6z" />
      <path d="M9.2 12l2 2 3.8-4" stroke={ACCENT} />
    </Icon>
  );
}

/** Rosette: the hackathon badge. */
export function RosetteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="9.5" r="5.5" />
      <circle cx="12" cy="9.5" r="2" fill={ACCENT} stroke="none" />
      <path d="M9.2 14.3L7.8 21l4.2-2.3 4.2 2.3-1.4-6.7" />
    </Icon>
  );
}

/** Stack: the three layers of the D'accord mark. */
export function StackIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5l8 4-8 4-8-4z" fill={ACCENT} fillOpacity={0.25} stroke={ACCENT} />
      <path d="M4 12l8 4 8-4" />
      <path d="M4 16.5l8 4 8-4" />
    </Icon>
  );
}

/** Waiting: an hourglass, for review windows. */
export function HourglassIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 3h10M7 21h10" />
      <path d="M8 3c0 4.6 4 5.4 4 9s-4 4.4-4 9M16 3c0 4.6-4 5.4-4 9s4 4.4 4 9" />
      <path d="M9.6 19.6h4.8L12 17.4z" fill={ACCENT} stroke={ACCENT} strokeWidth={1} />
    </Icon>
  );
}

/** Source code. */
export function CodeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
      <path d="M13.4 5.5l-2.8 13" stroke={ACCENT} />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12h14M13.5 6.5L19 12l-5.5 5.5" />
    </Icon>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19.5 12h-14M10.5 6.5L5 12l5.5 5.5" />
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 5.6v12.8a.9.9 0 0 0 1.4.75l9.7-6.4a.9.9 0 0 0 0-1.5L9.4 4.85A.9.9 0 0 0 8 5.6z" />
    </Icon>
  );
}

/** Start over: a loop back to the beginning. */
export function RestartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.6 13.2A7.5 7.5 0 1 0 6.9 6.5L4.5 8.8" />
      <path d="M4.5 4.6v4.2h4.2" />
    </Icon>
  );
}
