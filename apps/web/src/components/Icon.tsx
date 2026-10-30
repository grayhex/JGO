import { t as translateUI } from '../i18n';
import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  library: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  play: <path d="M8 5l11 7-11 7z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  restart: <><path d="M4 12a8 8 0 1 0 3-6.2" /><path d="M4 4v5h5" /></>,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></>,
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
  keypad: <><circle cx="6" cy="6" r="1.4" /><circle cx="12" cy="6" r="1.4" /><circle cx="18" cy="6" r="1.4" /><circle cx="6" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18" cy="12" r="1.4" /><circle cx="6" cy="18" r="1.4" /><circle cx="12" cy="18" r="1.4" /><circle cx="18" cy="18" r="1.4" /></>,
  volume: <><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" /></>,
  mute: <><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>,
  gamepad: <><path d="M7 8h10a4 4 0 0 1 4 4.5l-.6 3.5a2.2 2.2 0 0 1-3.8 1.1L15 15.5H9l-1.6 1.6a2.2 2.2 0 0 1-3.8-1.1L3 12.5A4 4 0 0 1 7 8z" /><path d="M8 11v3M6.5 12.5h3" /></>,
  zoom: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5M8.5 11h5M11 8.5v5" /></>,
  chevron: <path d="M6 9l6 6 6-6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />,
  log: <><path d="M5 4h14v16H5z" /><path d="M8.5 9h7M8.5 13h7M8.5 17h4" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2.2 2.2L15.5 10" /></>,
  device: <><rect x="3" y="5" width="18" height="11" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: <><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5v.01" /></>,
  trash: <><path d="M4 7h16M10 7V4h4v3M6.5 7l1 13h9l1-13" /></>,
  grid: <><path d="M4 4h16v16H4zM4 12h16M12 4v16" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, className = '', title }: { name: IconName; className?: string; title?: string }) {
  return (
    <svg className={`icon-svg ${className}`} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={translateUI(title)} aria-hidden={title ? undefined : true}>
      {P[name]}
    </svg>
  );
}
