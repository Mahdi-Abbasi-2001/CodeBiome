"use client";

import { useState } from "react";
import { WorldPreviewSvg } from "./WorldPreviewSvg";

const GITHUB_ICON_PATH =
  "M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.5c-2.22.48-2.69-.94-2.69-.94-.36-.92-.89-1.17-.89-1.17-.72-.5.06-.49.06-.49.8.06 1.23.82 1.23.82.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z";

export function LandingHero({ onAnalyze }: { onAnalyze: (url: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="relative min-h-screen overflow-hidden bg-biome-bg text-ink-primary">
      <div className="absolute inset-0">
        <WorldPreviewSvg />
        <div className="absolute inset-0 bg-gradient-to-r from-biome-bg via-biome-bg/[0.55] to-transparent md:via-biome-bg/70" />
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-biome-bg to-transparent" />
      </div>

      {/* nav */}
      <div className="relative z-10 flex h-[88px] items-center justify-between px-6 sm:px-14">
        <div className="flex items-center gap-2.5">
          <svg width="26" height="26" viewBox="0 0 26 26">
            <circle cx="13" cy="13" r="11" fill="none" stroke="#4FD1C5" strokeWidth="1.6" />
            <circle cx="13" cy="13" r="4.5" fill="#F2B84B" />
            <circle cx="21" cy="8" r="2" fill="#4FD1C5" />
            <circle cx="5" cy="18" r="2" fill="#4FD1C5" />
            <path d="M13 13 L21 8 M13 13 L5 18" stroke="#4FD1C5" strokeWidth="1.2" opacity="0.6" />
          </svg>
          <span className="font-display text-lg font-semibold">CodeBiome</span>
        </div>
        <div className="hidden items-center gap-8 text-sm text-ink-faint sm:flex">
          <span>How it works</span>
          <span>Bob</span>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-white/15 px-3.5 py-2 text-ink-primary"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d={GITHUB_ICON_PATH} />
            </svg>
            GitHub
          </a>
        </div>
      </div>

      {/* hero */}
      <div className="relative z-10 px-6 pt-8 sm:px-14 sm:pt-12">
        <div className="max-w-[600px]">
          <div className="mb-4 font-mono text-xs tracking-[1.6px] text-teal">AI-POWERED REPOSITORY ONBOARDING</div>
          <h1 className="font-display text-4xl font-semibold leading-tight text-ink-bright sm:text-[52px]">
            Every repository is a world waiting to be explored.
          </h1>
          <p className="mt-5 max-w-[520px] text-base leading-relaxed text-ink-secondary sm:text-[17px]">
            Paste a GitHub URL. CodeBiome runs deterministic repository analysis, builds a Knowledge Model of its
            architecture and structure — then renders it as a living world you can walk through.
          </p>

          <form
            className="mt-8 flex max-w-[520px] flex-col gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) onAnalyze(value.trim());
            }}
          >
            <label htmlFor="repo-url" className="sr-only">
              GitHub repository URL
            </label>
            <div className="flex gap-2.5">
              <div className="flex h-[52px] flex-grow items-center gap-2.5 rounded-lg border border-white/15 bg-biome-field px-4">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="#6B7580">
                  <path d={GITHUB_ICON_PATH} />
                </svg>
                <input
                  id="repo-url"
                  type="text"
                  placeholder="github.com/owner/repository"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="flex-grow bg-transparent font-mono text-sm text-ink-primary outline-none placeholder:text-ink-muted"
                />
              </div>
              <button
                type="submit"
                className="whitespace-nowrap rounded-lg bg-amber px-6 font-sans text-sm font-semibold text-amber-ink"
              >
                Analyze →
              </button>
            </div>
            <span className="text-[13px] text-ink-muted">
              Public repositories · small repos in under a minute, larger ones take longer
            </span>
          </form>

          <div className="mt-9 flex flex-wrap gap-2.5">
            <Pill color="#4FD1C5">Architecture mapped</Pill>
            <Pill color="#F2B84B">Dependencies traced</Pill>
            <Pill color="#7C9CFF">Explore with an avatar</Pill>
          </div>
        </div>
      </div>

      <div className="absolute bottom-10 right-14 hidden text-right font-mono text-xs text-ink-muted lg:block">
        a preview world — the real one is generated from your repository
      </div>
    </div>
  );
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-[13px] text-ink-secondary">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {children}
    </div>
  );
}
