/* Lucide-style stroke icons (24x24, stroke 2) used across the Klimat Pro kit.
   Mirrors the lucide-react set the product ships with. window.Icons.<Name> */
const _i = (paths, extra = {}) => ({ size = 18, color = "currentColor", strokeWidth = 2, style } = {}) =>
  React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 24 24", fill: extra.fill || "none",
    stroke: color, strokeWidth, strokeLinecap: "round", strokeLinejoin: "round",
    style: { display: "block", flexShrink: 0, ...style },
    dangerouslySetInnerHTML: { __html: paths },
  });

window.Icons = {
  Gauge: _i('<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>'),
  Folder: _i('<path d="M4 5h5l2 2.5h9A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V6.5A1.5 1.5 0 0 1 4 5z"/>'),
  Wallet: _i('<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>'),
  Chart: _i('<path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 4-6"/>'),
  Check2: _i('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  Search: _i('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  Bell: _i('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  Plus: _i('<path d="M12 5v14M5 12h14"/>'),
  Settings: _i('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  Pencil: _i('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  Trash: _i('<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/>'),
  ArrowUp: _i('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  ArrowDown: _i('<path d="M12 5v14M5 12l7 7 7-7"/>'),
  Clock: _i('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  Users: _i('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13A4 4 0 0 1 16 11"/>'),
  Building: _i('<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>'),
  Logout: _i('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'),
  Dots: _i('<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>'),
  Calendar: _i('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  Flame: _i('<path d="M12 2s4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-2.5C9 9 12 8 12 2z"/>'),
};
