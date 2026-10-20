import React from "react";

const paths = {
  journal: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M8 3v18M12 8h4M12 12h4" />
    </>
  ),
  chart: (
    <>
      <path d="M4 19V5M4 19h16M8 15v-4M13 15V7M18 15v-7" />
    </>
  ),
  habits: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 3v4M17 3v4M3 11h18" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="3" width="18" height="5" rx="1" />
      <path d="M5 8v12h14V8M10 12h4" />
    </>
  ),
  restore: (
    <>
      <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" />
      <path d="M12 8v5l3 2" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H4v16h5M9 12h12m-4-4 4 4-4 4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1" />
    </>
  ),
  moon: <path d="M20 14A8 8 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  edit: (
    <>
      <path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14Z" />
    </>
  ),
  leaf: (
    <>
      <path d="M19 3C5 3 3 9 5 15s14 4 14-12Z" />
      <path d="M4 21 15 10" />
    </>
  ),
  book: (
    <>
      <path d="M12 5C8 2 4 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-4-1-7-1-10 1Zm0 0v16" />
    </>
  ),
  heart: <path d="M12 21 3 12C-3 3 8-1 12 6c4-7 15-3 9 6Z" />,
  water: <path d="M12 2C9 7 4 11 4 15a8 8 0 0 0 16 0c0-4-5-8-8-13Z" />,
  wave: <path d="M2 13h4l3-9 5 16 3-9h5" />,
  music: (
    <>
      <path d="M10 18V5l11-2v13M10 8l11-2" />
      <ellipse cx="6" cy="18" rx="4" ry="3" />
      <ellipse cx="17" cy="16" rx="4" ry="3" />
    </>
  ),
};

export function Icon({ name = "leaf", size = 20, className = "", ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {paths[name] || paths.leaf}
    </svg>
  );
}

export function Brand({ compact = false }) {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      {!compact && (
        <span>
          rhythm<span className="brand-dot">.</span>
        </span>
      )}
    </span>
  );
}

export function habitIcon(symbol) {
  if (symbol?.includes("book")) return "book";
  if (symbol?.includes("sun")) return "sun";
  if (symbol?.includes("moon")) return "moon";
  if (symbol?.includes("drop")) return "water";
  if (symbol?.includes("heart")) return "heart";
  if (symbol?.includes("music")) return "music";
  if (symbol?.includes("pencil")) return "edit";
  if (symbol?.includes("wave")) return "wave";
  return "leaf";
}
