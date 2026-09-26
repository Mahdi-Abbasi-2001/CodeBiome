/**
 * A static, decorative preview of the CodeBiome world for the landing page
 * — adapted from the Claude Design artifact's Main.dc.html. Purely
 * illustrative (not derived from any real repository); the actual world is
 * always generated from the analyzed repo's World Model.
 */
export function WorldPreviewSvg() {
  return (
    <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
      <defs>
        <radialGradient id="cb-sky" cx="78%" cy="14%" r="65%">
          <stop offset="0%" stopColor="#182231" />
          <stop offset="45%" stopColor="#0F151D" />
          <stop offset="100%" stopColor="#0A0D12" />
        </radialGradient>
        <radialGradient id="cb-moon" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F6E7C9" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#F2B84B" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#F2B84B" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cb-canopy" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F2B84B" stopOpacity="0.3" />
          <stop offset="60%" stopColor="#4FD1C5" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#4FD1C5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cb-path" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#4FD1C5" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#4FD1C5" stopOpacity="0.15" />
        </linearGradient>
        <filter id="cb-blur-sm"><feGaussianBlur stdDeviation="4" /></filter>
        <filter id="cb-blur-lg"><feGaussianBlur stdDeviation="26" /></filter>
      </defs>

      <rect width="1440" height="900" fill="url(#cb-sky)" />
      <circle cx="1300" cy="130" r="70" fill="url(#cb-moon)" />
      <circle cx="1300" cy="130" r="16" fill="#F6E7C9" opacity="0.9" />

      <polygon points="520,640 700,540 880,600 1060,520 1260,590 1440,540 1440,900 520,900" fill="#1B2530" opacity="0.9" />
      <polygon points="560,700 760,600 940,660 1140,580 1360,650 1440,610 1440,900 560,900" fill="#182A24" opacity="0.95" />
      <polygon points="600,760 820,660 1020,720 1220,640 1420,700 1440,690 1440,900 600,900" fill="#12241C" />
      <polygon points="640,830 860,740 1080,800 1300,730 1440,780 1440,900 640,900" fill="#0D1B15" />

      <g>
        <path
          d="M1070 860 Q1080 770 1160 770 Q1240 770 1250 860 L1230 860 Q1222 800 1160 800 Q1098 800 1090 860 Z"
          fill="#080B0E"
        />
        <path d="M1070 860 Q1080 770 1160 770 Q1240 770 1250 860" fill="none" stroke="#4FD1C5" strokeWidth="2" opacity="0.35" />
      </g>

      <g className="animate-cb-pulse">
        <ellipse cx="1290" cy="618" rx="60" ry="70" fill="none" stroke="#7C9CFF" strokeWidth="5" opacity="0.55" />
        <ellipse cx="1290" cy="618" rx="60" ry="70" fill="#7C9CFF" opacity="0.1" filter="url(#cb-blur-lg)" />
      </g>

      <path d="M800 800 Q900 700 985 660" fill="none" stroke="url(#cb-path)" strokeWidth="4" strokeLinecap="round" opacity="0.85" />
      <path d="M985 660 Q1120 690 1160 800" fill="none" stroke="#4FD1C5" strokeWidth="3" strokeLinecap="round" opacity="0.5" strokeDasharray="2 10" />

      <circle cx="985" cy="600" r="230" fill="url(#cb-canopy)" className="animate-cb-pulse" />
      <polygon points="965,660 1005,660 1000,790 970,790" fill="#12241C" />
      <circle cx="985" cy="560" r="140" fill="#1F5C41" opacity="0.85" />
      <circle cx="940" cy="520" r="95" fill="#2E7A54" opacity="0.85" />
      <circle cx="1030" cy="540" r="80" fill="#3FA672" opacity="0.8" />
      <circle cx="985" cy="520" r="46" fill="#F2B84B" opacity="0.35" className="animate-cb-pulse" />

      <g>
        <rect x="748" y="700" width="16" height="100" rx="3" fill="#171E26" />
        <rect x="836" y="700" width="16" height="100" rx="3" fill="#171E26" />
        <rect x="742" y="690" width="116" height="14" rx="3" fill="#171E26" />
        <rect x="748" y="700" width="16" height="100" fill="none" stroke="#F2B84B" strokeWidth="1.5" opacity="0.6" />
        <rect x="836" y="700" width="16" height="100" fill="none" stroke="#F2B84B" strokeWidth="1.5" opacity="0.6" />
      </g>

      <g transform="translate(818,760)">
        <ellipse cx="0" cy="46" rx="16" ry="5" fill="#000" opacity="0.4" />
        <rect x="-9" y="6" width="18" height="34" rx="7" fill="#E3DACC" />
        <circle cx="0" cy="-2" r="10" fill="#F3F1EA" />
        <rect x="-9" y="16" width="18" height="10" fill="#4FD1C5" opacity="0.8" />
      </g>

      <g fill="#F2B84B">
        <circle cx="720" cy="560" r="2.4" opacity="0.8" className="animate-cb-pulse" />
        <circle cx="1150" cy="500" r="2" opacity="0.6" className="animate-cb-pulse" />
        <circle cx="1330" cy="470" r="2.2" opacity="0.7" className="animate-cb-pulse" />
        <circle cx="900" cy="440" r="1.8" opacity="0.6" className="animate-cb-pulse" />
      </g>
    </svg>
  );
}
