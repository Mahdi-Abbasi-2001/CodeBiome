"use client";

import { useRef, useState } from "react";

const GITHUB_ICON_PATH =
  "M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.5c-2.22.48-2.69-.94-2.69-.94-.36-.92-.89-1.17-.89-1.17-.72-.5.06-.49.06-.49.8.06 1.23.82 1.23.82.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z";

function WorldScene() {
  return (
    <svg
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    >
      <defs>
        <radialGradient id="sky" cx="78%" cy="14%" r="65%">
          <stop offset="0%" stopColor="#182231" />
          <stop offset="45%" stopColor="#0F151D" />
          <stop offset="100%" stopColor="#0A0D12" />
        </radialGradient>
        <radialGradient id="moon" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F6E7C9" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#F2B84B" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#F2B84B" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="canopyGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F2B84B" stopOpacity="0.30" />
          <stop offset="60%" stopColor="#4FD1C5" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#4FD1C5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pathGlow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#4FD1C5" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#4FD1C5" stopOpacity="0.15" />
        </linearGradient>
        <filter id="blurSm" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id="blurLg" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="26" />
        </filter>
      </defs>

      <rect x="0" y="0" width="1440" height="900" fill="url(#sky)" />
      <circle cx="1300" cy="130" r="70" fill="url(#moon)" />
      <circle cx="1300" cy="130" r="16" fill="#F6E7C9" opacity="0.9" />

      {/* hill layers, back to front */}
      <polygon points="520,640 700,540 880,600 1060,520 1260,590 1440,540 1440,900 520,900" fill="#1B2530" opacity="0.9" />
      <polygon points="560,700 760,600 940,660 1140,580 1360,650 1440,610 1440,900 560,900" fill="#182A24" opacity="0.95" />
      <polygon points="600,760 820,660 1020,720 1220,640 1420,700 1440,690 1440,900 600,900" fill="#12241C" />
      <polygon points="640,830 860,740 1080,800 1300,730 1440,780 1440,900 640,900" fill="#0D1B15" />

      {/* distant tiny factory, cropped at edge */}
      <g opacity="0.85">
        <rect x="1372" y="668" width="52" height="70" fill="#131A20" />
        <rect x="1382" y="650" width="10" height="20" fill="#131A20" />
        <rect x="1386" y="684" width="10" height="12" fill="#F2B84B" opacity="0.8" />
        <rect x="1400" y="700" width="10" height="12" fill="#F2B84B" opacity="0.5" />
        <path d="M1387 650 Q1394 630 1384 612" stroke="#3D453F" strokeWidth="3" fill="none" opacity="0.5" />
      </g>

      {/* cave arch */}
      <g>
        <path d="M1070 860 Q1080 770 1160 770 Q1240 770 1250 860 L1230 860 Q1222 800 1160 800 Q1098 800 1090 860 Z" fill="#080B0E" />
        <path d="M1070 860 Q1080 770 1160 770 Q1240 770 1250 860" fill="none" stroke="#4FD1C5" strokeWidth="2" opacity="0.35" />
        <ellipse cx="1160" cy="845" rx="46" ry="10" fill="#4FD1C5" opacity="0.12" filter="url(#blurSm)" />
      </g>

      {/* portal ring */}
      <g className="cb-canopy-glow">
        <ellipse cx="1290" cy="618" rx="60" ry="70" fill="none" stroke="#7C9CFF" strokeWidth="5" opacity="0.55" />
        <ellipse cx="1290" cy="618" rx="60" ry="70" fill="#7C9CFF" opacity="0.10" filter="url(#blurLg)" />
        <ellipse cx="1290" cy="618" rx="40" ry="50" fill="none" stroke="#B9C8FF" strokeWidth="1.5" opacity="0.5" />
      </g>

      {/* connective glowing paths */}
      <path d="M800 800 Q900 700 985 660" fill="none" stroke="url(#pathGlow)" strokeWidth="4" strokeLinecap="round" opacity="0.85" />
      <path d="M985 660 Q1120 690 1160 800" fill="none" stroke="#4FD1C5" strokeWidth="3" strokeLinecap="round" opacity="0.5" strokeDasharray="2 10" />
      <path d="M1010 640 Q1160 600 1260 618" fill="none" stroke="#4FD1C5" strokeWidth="3" strokeLinecap="round" opacity="0.5" strokeDasharray="2 10" />

      {/* giant central tree (highest centrality landmark) */}
      <circle cx="985" cy="600" r="230" fill="url(#canopyGlow)" className="cb-canopy-glow" />
      <polygon points="965,660 1005,660 1000,790 970,790" fill="#12241C" />
      <circle cx="985" cy="560" r="140" fill="#1F5C41" opacity="0.85" />
      <circle cx="940" cy="520" r="95" fill="#2E7A54" opacity="0.85" />
      <circle cx="1030" cy="540" r="80" fill="#3FA672" opacity="0.8" />
      <circle cx="985" cy="520" r="46" fill="#F2B84B" opacity="0.35" className="cb-canopy-glow" />

      {/* gate */}
      <g>
        <rect x="748" y="700" width="16" height="100" rx="3" fill="#171E26" />
        <rect x="836" y="700" width="16" height="100" rx="3" fill="#171E26" />
        <rect x="742" y="690" width="116" height="14" rx="3" fill="#171E26" />
        <rect x="748" y="700" width="16" height="100" fill="none" stroke="#F2B84B" strokeWidth="1.5" opacity="0.6" />
        <rect x="836" y="700" width="16" height="100" fill="none" stroke="#F2B84B" strokeWidth="1.5" opacity="0.6" />
        <ellipse cx="800" cy="800" rx="70" ry="10" fill="#F2B84B" opacity="0.14" filter="url(#blurSm)" />
      </g>

      {/* avatar, near the gate for scale */}
      <g transform="translate(818,760)">
        <ellipse cx="0" cy="46" rx="16" ry="5" fill="#000" opacity="0.4" />
        <rect x="-9" y="6" width="18" height="34" rx="7" fill="#E3DACC" />
        <circle cx="0" cy="-2" r="10" fill="#F3F1EA" />
        <rect x="-9" y="16" width="18" height="10" fill="#4FD1C5" opacity="0.8" />
      </g>

      {/* fireflies / particles */}
      <g fill="#F2B84B">
        <circle cx="720" cy="560" r="2.4" opacity="0.8" className="cb-spark" />
        <circle cx="1150" cy="500" r="2" opacity="0.6" className="cb-spark" />
        <circle cx="1330" cy="470" r="2.2" opacity="0.7" className="cb-spark" />
        <circle cx="900" cy="440" r="1.8" opacity="0.6" className="cb-spark" />
        <circle cx="1050" cy="760" r="2" opacity="0.5" className="cb-spark" />
      </g>
    </svg>
  );
}

function GitHubIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill={color}>
      <path d={GITHUB_ICON_PATH} />
    </svg>
  );
}

export function LandingHero({ onAnalyze }: { onAnalyze?: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const lanternRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAnalyze?.(url.trim());
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = lanternRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.style.transform = `translate3d(${e.clientX - rect.left - 260}px, ${e.clientY - rect.top - 260}px, 0)`;
    el.style.opacity = "1";
  };

  const handleMouseLeave = () => {
    const el = lanternRef.current;
    if (el) el.style.opacity = "0";
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ position: "relative", width: "100%", minHeight: "100vh", overflow: "hidden", background: "#0A0D12", color: "#F3F1EA" }}
    >
      <WorldScene />

      {/* legibility scrim */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(100deg,#0A0D12 0%,#0A0D12 38%,rgba(10,13,18,0.86) 52%,rgba(10,13,18,0.35) 70%,rgba(10,13,18,0.02) 88%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 220,
          background: "linear-gradient(180deg,rgba(10,13,18,0) 0%,#0A0D12 100%)",
        }}
      />

      {/* amber lantern glow that follows the cursor */}
      <div
        ref={lanternRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 520,
          height: 520,
          borderRadius: "50%",
          pointerEvents: "none",
          mixBlendMode: "screen",
          opacity: 0,
          transition: "opacity 0.4s ease",
          background: "radial-gradient(circle, rgba(242,184,75,0.30) 0%, rgba(242,184,75,0.12) 40%, rgba(242,184,75,0) 70%)",
        }}
        className="cb-lantern"
      />

      {/* nav */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 88,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 56px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="26" height="26" viewBox="0 0 26 26">
            <circle cx="13" cy="13" r="11" fill="none" stroke="#4FD1C5" strokeWidth="1.6" />
            <circle cx="13" cy="13" r="4.5" fill="#F2B84B" />
            <circle cx="21" cy="8" r="2" fill="#4FD1C5" />
            <circle cx="5" cy="18" r="2" fill="#4FD1C5" />
            <path d="M13 13 L21 8 M13 13 L5 18" stroke="#4FD1C5" strokeWidth="1.2" opacity="0.6" />
          </svg>
          <span style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 19, fontWeight: 600, letterSpacing: 0.2 }}>
            CodeBiome
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 32, fontSize: 14, color: "#9CA6AC" }}>
          <a href="#">How it works</a>
          <a href="#">MCP clients</a>
          <a
            href="#"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              color: "#F3F1EA",
              border: "0.5px solid rgba(255,255,255,0.16)",
              padding: "8px 14px",
              borderRadius: 7,
            }}
          >
            <GitHubIcon size={15} color="currentColor" />
            GitHub
          </a>
        </div>
      </div>

      {/* hero */}
      <div style={{ position: "absolute", left: 56, top: 206, width: 600 }}>
        <div
          style={{
            fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace",
            fontSize: 12,
            letterSpacing: 1.6,
            color: "#4FD1C5",
            marginBottom: 18,
          }}
        >
          AI‑POWERED REPOSITORY ONBOARDING
        </div>
        <h1
          style={{
            fontFamily: "'Space Grotesk',system-ui,sans-serif",
            fontSize: 52,
            lineHeight: 1.12,
            fontWeight: 600,
            margin: "0 0 20px",
            color: "#F8F6EF",
          }}
        >
          Every repository
          <br />
          is a world waiting
          <br />
          to be explored.
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: "#B7BDC3", maxWidth: 520, margin: "0 0 32px" }}>
          Paste a GitHub URL. An AI agent — CodeBiome&apos;s own built-in one, or any MCP client you connect yourself —
          explores the real code and tells CodeBiome what it found; every claim is checked against the real files before
          it&apos;s rendered as a living world you can walk through.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 520 }}>
          <label htmlFor="repo-url" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
            GitHub repository URL
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <div
              style={{
                flexGrow: 1,
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "#12171D",
                border: "0.5px solid rgba(255,255,255,0.14)",
                borderRadius: 9,
                padding: "0 16px",
                height: 52,
              }}
            >
              <GitHubIcon size={16} color="#6B7580" />
              <input
                id="repo-url"
                type="text"
                placeholder="github.com/owner/repository"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                style={{
                  flexGrow: 1,
                  background: "transparent",
                  border: 0,
                  outline: 0,
                  color: "#F3F1EA",
                  fontSize: 15,
                  fontFamily: "'IBM Plex Mono',monospace",
                }}
              />
            </div>
            <button
              type="submit"
              style={{
                background: "#F2B84B",
                color: "#171208",
                border: 0,
                borderRadius: 9,
                padding: "0 26px",
                fontSize: 15,
                fontWeight: 600,
                fontFamily: "'IBM Plex Sans',sans-serif",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Analyze →
            </button>
          </div>
          <span style={{ fontSize: 13, color: "#6B7580" }}>Public repositories · usually ready in under a minute</span>
        </form>

        <div style={{ display: "flex", gap: 10, marginTop: 36, flexWrap: "wrap" }}>
          {[
            { color: "#4FD1C5", label: "Architecture mapped" },
            { color: "#F2B84B", label: "Health & risk surfaced" },
            { color: "#7C9CFF", label: "First contribution found" },
          ].map((badge) => (
            <div
              key={badge.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(255,255,255,0.04)",
                border: "0.5px solid rgba(255,255,255,0.08)",
                borderRadius: 20,
                padding: "8px 14px",
                fontSize: 13,
                color: "#B7BDC3",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: badge.color, display: "inline-block" }} />
              {badge.label}
            </div>
          ))}
        </div>
      </div>

      {/* caption on the world preview */}
      <div style={{ position: "absolute", right: 56, bottom: 40, textAlign: "right" }}>
        <div style={{ fontFamily: "'IBM Plex Mono','SF Mono',Menlo,monospace", fontSize: 12, color: "#6B7580" }}>
          a preview world, generated from a real repository graph
        </div>
      </div>
    </div>
  );
}
