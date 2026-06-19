// Discord-style icons recreated as inline SVGs (matching Discord's voice panel UI).
import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  xmlns: "http://www.w3.org/2000/svg",
  ...props,
});

export function MicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z" />
      <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11Z" />
    </svg>
  );
}

export function MicOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M15 5a3 3 0 0 0-5.91-.74L15 10.17V5Z" />
      <path d="M19 11a1 1 0 1 0-2 0 4.9 4.9 0 0 1-.43 2L18 14.45A6.93 6.93 0 0 0 19 11Z" />
      <path d="M12 16a5 5 0 0 1-5-5 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 0 0 .73-.32L12.9 17.9A5 5 0 0 1 12 16Z" />
      <path d="M3.7 2.3a1 1 0 0 0-1.4 1.4l18 18a1 1 0 0 0 1.4-1.4l-18-18Z" />
      <path d="M9 11V9.41l5.62 5.62A3 3 0 0 1 9 13v-2Z" />
    </svg>
  );
}

export function HeadphoneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-0a7 7 0 0 1 14 0v0h-2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

export function HeadphoneOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3.7 2.3a1 1 0 0 0-1.4 1.4l18 18a1 1 0 0 0 1.4-1.4l-2.45-2.45A3 3 0 0 0 21 17v-5a9 9 0 0 0-15.3-6.42L3.7 2.3Z" />
      <path d="M3 12v5a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5a7 7 0 0 1 .56-2.61L3.6 8.4A8.94 8.94 0 0 0 3 12Z" />
    </svg>
  );
}

export function ChevronIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base({ width: 12, height: 12, ...props })}>
      <path d="M5.3 8.3a1 1 0 0 1 1.4 0L12 13.6l5.3-5.3a1 1 0 1 1 1.4 1.4l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4Z" />
    </svg>
  );
}

export function PhoneOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 9c-1.6 0-3.15.25-4.6.7v3.1c0 .4-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a1 1 0 0 1-1.4-.03L.3 13.8a1 1 0 0 1 0-1.42C3.34 9.34 7.46 7.5 12 7.5s8.66 1.84 11.7 4.88a1 1 0 0 1 0 1.42l-2.48 2.62a1 1 0 0 1-1.4.03 11.7 11.7 0 0 0-2.66-1.85.998.998 0 0 1-.56-.9v-3.1A15.6 15.6 0 0 0 12 9Z" />
    </svg>
  );
}
