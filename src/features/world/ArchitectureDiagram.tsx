"use client";

import { useMemo, useState } from "react";
import type { WorldSnapshot } from "@/types/world";
import { computeDomains, computeDomainBridges, computeDomainConnectivity, type Domain, type DomainBridge } from "@/lib/domains";
import { computeInfrastructureNodes, type InfraNode, type InfraCategory } from "@/lib/infrastructure";
import { CodeViewer } from "./CodeViewer";
import { ForestBackdrop } from "./ForestBackdrop";
import { WorldHud, type WorldLens } from "./WorldHud";


/**
 * Shapes here are deliberately organic (a hexagon reads as a honeycomb
 * cell, a cylinder as a trunk cross-section) — but the colors are the
 * SAME palette as the rest of CodeBiome (landing page, ScanningView,
 * DomainView): teal/amber/periwinkle on near-black, not a bespoke scheme.
 * The graph itself is not decorative either: every node and edge below is
 * built from `Domain`/`InfraNode`/`DomainBridge`, the same real, computed
 * facts the rest of the world already renders. Nothing here is invented.
 */

const TEAL = "#4FD1C5";
const AMBER = "#F2B84B";

type ColorKey = "client" | "app" | "data" | "cache" | "queue" | "external";
const COLOR: Record<ColorKey, { strong: string; soft: string }> = {
  client: { strong: "#9ED8F2", soft: "rgba(158,216,242,0.12)" }, // frontend — same light blue as the old infra chip
  app: { strong: "#8C9EFF", soft: "rgba(140,158,255,0.12)" }, // backend/service — same indigo as the old infra chip
  data: { strong: TEAL, soft: "rgba(79,209,197,0.12)" }, // database/search — CodeBiome's primary accent
  cache: { strong: AMBER, soft: "rgba(242,184,75,0.12)" }, // CodeBiome's secondary accent
  queue: { strong: "#B98CE0", soft: "rgba(185,140,224,0.12)" },
  external: { strong: "#FF9E7A", soft: "rgba(255,158,122,0.12)" },
};
const LINE = "#2B2F36";
const LINE_STRONG = "#4A5560";
const FOCUS = TEAL; // matches the landing page's glowing connective paths
const INK = "#F3F1EA";
const INK_SOFT = "#9CA6AC";

type ArchTier = "client" | "application" | "data" | "external";
type ArchShape = "browser" | "hex" | "cylinder" | "diamond" | "queue" | "search" | "external";

interface ArchNode {
  id: string;
  tier: ArchTier;
  shape: ArchShape;
  color: ColorKey;
  title: string;
  subtitle: string;
  badge: string;
  description: string;
  kind: "domain" | "infra";
  domainRef?: Domain;
  infraRef?: InfraNode;
}

interface ArchEdge {
  from: string;
  to: string;
  kind: "uses" | "relates";
  weight: number;
  label?: string;
}

const INFRA_CATEGORY_LABEL: Record<InfraCategory, string> = {
  database: "data store",
  cache: "cache",
  queue: "message queue",
  search: "search index",
  "external-api": "external service",
  frontend: "frontend framework",
  backend: "backend framework",
  fullstack: "full-stack framework",
};

const EDGE_VERB: Partial<Record<InfraCategory, string>> = {
  database: "reads / writes",
  cache: "reads / writes",
  queue: "publishes to",
  search: "queries",
  "external-api": "calls",
};

function shapeForCategory(category: InfraCategory): ArchShape {
  if (category === "cache") return "diamond";
  if (category === "queue") return "queue";
  if (category === "search") return "search";
  if (category === "external-api") return "external"; // globe/portal glyph — colorForCategory already colors it distinctly, the shape had just never been wired up, so it rendered as a plain database cylinder
  return "cylinder"; // database
}

function colorForCategory(category: InfraCategory): ColorKey {
  if (category === "cache") return "cache";
  if (category === "queue") return "queue";
  if (category === "external-api") return "external";
  return "data"; // database, search
}

function describeDomain(d: Domain, fw: InfraNode | null): string {
  const moduleCount = `${d.moduleIds.length} module${d.moduleIds.length === 1 ? "" : "s"}`;
  const parts = [moduleCount, fw ? `built on ${fw.name}` : "no detected framework"];
  if (d.hasRisk) parts.push("risk flagged");
  return `${parts.join(" · ")}. Health: ${d.healthTier}.`;
}

function describeInfra(n: InfraNode): string {
  return `Real dependency detected from source imports — referenced in ${n.fileIds.length} file${n.fileIds.length === 1 ? "" : "s"}.`;
}

const MAX_PER_TIER = 8;

function buildArchGraph(domains: Domain[], bridges: DomainBridge[], connectivity: Set<string>, infraNodes: InfraNode[]) {
  const frameworkInfra = infraNodes.filter((n) => n.category === "frontend" || n.category === "backend" || n.category === "fullstack");
  const serviceInfra = infraNodes.filter((n) => n.category !== "frontend" && n.category !== "backend" && n.category !== "fullstack");

  // A domain can legitimately have real evidence for MORE THAN ONE framework
  // — e.g. a backend domain that server-side-renders its frontend framework
  // has both, real. Picking "frontend always wins" as the tie-break used to
  // mean one server-rendering file could outweigh an entire real backend
  // framework's worth of evidence in the SAME domain. Compare the evidence
  // actually IN this domain instead: whichever framework has more of its own
  // files here is the one that actually explains this domain's tier.
  const frameworkByDomain = new Map<string, InfraNode>();
  for (const fw of frameworkInfra) {
    for (const domainId of fw.domainIds) {
      const existing = frameworkByDomain.get(domainId);
      const fwCount = fw.domainFileCounts[domainId] ?? 0;
      const existingCount = existing?.domainFileCounts[domainId] ?? -1;
      if (!existing || fwCount > existingCount) frameworkByDomain.set(domainId, fw);
    }
  }
  const serviceDomainIds = new Set<string>();
  for (const s of serviceInfra) for (const d of s.domainIds) serviceDomainIds.add(d);

  const eligible = domains.filter(
    (d) => !d.isInfra && (connectivity.has(d.id) || frameworkByDomain.has(d.id) || serviceDomainIds.has(d.id))
  );
  const clientDomains = eligible.filter((d) => frameworkByDomain.get(d.id)?.category === "frontend").slice(0, MAX_PER_TIER);
  const applicationDomains = eligible
    .filter((d) => frameworkByDomain.get(d.id)?.category !== "frontend")
    .slice(0, MAX_PER_TIER);
  const includedDomainIds = new Set([...clientDomains, ...applicationDomains].map((d) => d.id));

  const domainNode = (d: Domain, tier: "client" | "application"): ArchNode => {
    const fw = frameworkByDomain.get(d.id) ?? null;
    return {
      id: d.id,
      tier,
      shape: tier === "client" ? "browser" : "hex",
      color: tier === "client" ? "client" : "app",
      title: d.name,
      subtitle: fw ? fw.name.toLowerCase() : `${d.moduleIds.length} module${d.moduleIds.length === 1 ? "" : "s"}`,
      badge: tier === "client" ? "Client" : "Service",
      description: describeDomain(d, fw),
      kind: "domain",
      domainRef: d,
    };
  };

  const infraNode = (n: InfraNode): ArchNode => ({
    id: n.id,
    tier: n.category === "external-api" ? "external" : "data",
    shape: shapeForCategory(n.category),
    color: colorForCategory(n.category),
    title: n.name,
    subtitle: INFRA_CATEGORY_LABEL[n.category],
    badge: n.category === "external-api" ? "External" : n.category === "cache" ? "Cache" : n.category === "queue" ? "Queue" : "Data store",
    description: describeInfra(n),
    kind: "infra",
    infraRef: n,
  });

  const dataServiceNodes = serviceInfra.filter((n) => n.category !== "external-api").slice(0, MAX_PER_TIER);
  const externalServiceNodes = serviceInfra.filter((n) => n.category === "external-api").slice(0, MAX_PER_TIER);

  const nodes: ArchNode[] = [
    ...clientDomains.map((d) => domainNode(d, "client")),
    ...applicationDomains.map((d) => domainNode(d, "application")),
    ...dataServiceNodes.map(infraNode),
    ...externalServiceNodes.map(infraNode),
  ];
  const nodeIds = new Set(nodes.map((n) => n.id));

  const edges: ArchEdge[] = [];
  for (const b of bridges) {
    if (nodeIds.has(b.fromDomainId) && nodeIds.has(b.toDomainId)) {
      edges.push({ from: b.fromDomainId, to: b.toDomainId, kind: "relates", weight: b.weight });
    }
  }
  for (const n of [...dataServiceNodes, ...externalServiceNodes]) {
    for (const domainId of n.domainIds) {
      if (nodeIds.has(domainId)) {
        edges.push({ from: domainId, to: n.id, kind: "uses", weight: 1, label: EDGE_VERB[n.category] });
      }
    }
  }

  return { nodes, edges, hiddenDomainCount: eligible.length - includedDomainIds.size };
}

const SHAPE_SIZE: Record<ArchShape, { w: number; h: number }> = {
  browser: { w: 150, h: 86 },
  hex: { w: 150, h: 92 },
  cylinder: { w: 104, h: 84 },
  diamond: { w: 100, h: 100 },
  queue: { w: 140, h: 64 },
  search: { w: 104, h: 84 },
  external: { w: 122, h: 122 },
};
const TIER_ORDER: ArchTier[] = ["client", "application", "data", "external"];
const TIER_X: Record<ArchTier, number> = { client: 140, application: 460, data: 780, external: 1060 };
const TIER_LABEL: Record<ArchTier, string> = { client: "CLIENT", application: "APPLICATION", data: "DATA & MESSAGING", external: "EXTERNAL" };
const GAP = 40;
const TOP_MARGIN = 56;
const BOTTOM_MARGIN = 16;
/** Title + subtitle are drawn below each shape's own box (see the <text> elements' y offsets) — the last row in the tallest column needs room for that text below its shape, not just the shape itself. */
const LABEL_EXTRA = 40;

function layoutGraph(nodes: ArchNode[]) {
  const byTier: Record<ArchTier, ArchNode[]> = { client: [], application: [], data: [], external: [] };
  for (const n of nodes) byTier[n.tier].push(n);

  const columns = TIER_ORDER.map((tier) => {
    let y = 0;
    const items = byTier[tier].map((n) => {
      const { h } = SHAPE_SIZE[n.shape];
      const item = { node: n, y, h };
      y += h + GAP;
      return item;
    });
    return { tier, items, total: items.length > 0 ? y - GAP + LABEL_EXTRA : 0 };
  });

  const maxTotal = Math.max(0, ...columns.map((c) => c.total));
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const col of columns) {
    const offsetY = TOP_MARGIN + (maxTotal - col.total) / 2;
    for (const item of col.items) {
      const { w } = SHAPE_SIZE[item.node.shape];
      positions.set(item.node.id, { x: TIER_X[col.tier] - w / 2, y: offsetY + item.y, w, h: item.h });
    }
  }
  const height = TOP_MARGIN + maxTotal + BOTTOM_MARGIN;
  const width = TIER_X.external + SHAPE_SIZE.external.w / 2 + 90;
  return { positions, width, height: Math.max(height, 260) };
}

function edgePath(x1: number, y1: number, x2: number, y2: number, sameColumn: boolean) {
  if (sameColumn) {
    const bow = 70;
    return `M${x1},${y1} C${x1 + bow},${y1} ${x2 + bow},${y2} ${x2},${y2}`;
  }
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

function NodeGlyph({ node, w, h, selected }: { node: ArchNode; w: number; h: number; selected: boolean }) {
  const { strong: strongBase, soft } = COLOR[node.color];
  const strong = selected ? FOCUS : strongBase;
  const strokeWidth = selected ? 3 : 1.8;
  const cx = w / 2;
  const cy = h / 2;

  switch (node.shape) {
    case "browser":
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} rx={11} fill={soft} stroke={strong} strokeWidth={strokeWidth} />
          <line x1={0} y1={20} x2={w} y2={20} stroke={strong} strokeWidth={1.4} opacity={0.6} />
          {[8, 16, 24].map((dx) => (
            <circle key={dx} cx={dx} cy={10} r={2.3} fill={strong} />
          ))}
          <rect x={14} y={34} width={w - 28} height={7} rx={3} fill={strong} opacity={0.55} />
          <rect x={14} y={47} width={(w - 28) * 0.65} height={7} rx={3} fill={strong} opacity={0.35} />
          <rect x={14} y={h - 22} width={46} height={12} rx={6} fill={strong} opacity={0.85} />
        </g>
      );
    case "hex": {
      const pts = [
        [cx * 0.32, 2],
        [w - cx * 0.32, 2],
        [w - 2, cy],
        [w - cx * 0.32, h - 2],
        [cx * 0.32, h - 2],
        [2, cy],
      ]
        .map((p) => p.join(","))
        .join(" ");
      const barY = cy - 16;
      return (
        <g>
          <polygon points={pts} fill={soft} stroke={strong} strokeWidth={strokeWidth} />
          <polygon points={pts} fill="url(#cb-honeycomb)" opacity={0.32} />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={cx - 26} y={barY + i * 12} width={52} height={7} rx={2} fill={strongBase} opacity={i === 0 ? 0.9 : 0.5} />
              <circle cx={cx - 33} cy={barY + i * 12 + 3.5} r={2.2} fill={strongBase} />
            </g>
          ))}
        </g>
      );
    }
    case "cylinder":
    case "search": {
      const ry = 12;
      const bodyD = `M2,${ry} a${cx - 2},${ry} 0 0 1 ${w - 4},0 v${h - ry * 2} a${cx - 2},${ry} 0 0 1 -${w - 4},0 z`;
      const capD = `M2,${ry} a${cx - 2},${ry} 0 0 0 ${w - 4},0`;
      return (
        <g>
          <path d={bodyD} fill={soft} stroke={strong} strokeWidth={strokeWidth} />
          <path d={capD} fill="none" stroke={strong} strokeWidth={1.6} opacity={0.7} />
          {[0.42, 0.62, 0.82].map((f) => (
            <path key={f} d={`M2,${h * f} a${cx - 2},${ry} 0 0 0 ${w - 4},0`} fill="none" stroke={strongBase} strokeWidth={1} opacity={0.3} />
          ))}
          {node.shape === "search" && (
            <g transform={`translate(${cx - 8},${cy - 6})`}>
              <circle cx={7} cy={7} r={5.4} fill="none" stroke={strongBase} strokeWidth={1.8} />
              <line x1={11} y1={11} x2={16} y2={16} stroke={strongBase} strokeWidth={2} strokeLinecap="round" />
            </g>
          )}
        </g>
      );
    }
    case "diamond": {
      const dpts = [
        [cx, 1],
        [w - 1, cy],
        [cx, h - 1],
        [1, cy],
      ]
        .map((p) => p.join(","))
        .join(" ");
      const bolt = [
        [cx + 6, cy - 24],
        [cx - 10, cy + 2],
        [cx, cy + 2],
        [cx - 6, cy + 24],
        [cx + 12, cy - 4],
        [cx + 2, cy - 4],
      ]
        .map((p) => p.join(","))
        .join(" ");
      return (
        <g>
          <polygon points={dpts} fill={soft} stroke={strong} strokeWidth={strokeWidth} />
          <polygon points={bolt} fill={strongBase} />
        </g>
      );
    }
    case "queue": {
      const slant = 14;
      const pts = [
        [slant, 1],
        [w - 1, 1],
        [w - slant, h - 1],
        [1, h - 1],
      ]
        .map((p) => p.join(","))
        .join(" ");
      return (
        <g>
          <polygon points={pts} fill={soft} stroke={strong} strokeWidth={strokeWidth} />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={30 + i * 30} y={cy - 8} width={16} height={16} rx={3} fill={strongBase} opacity={0.35 + i * 0.25} />
          ))}
          <path d={`M${w - 40},${cy} l10,-6 v4 l10,0 v4 l-10,0 v4 z`} fill={strongBase} />
        </g>
      );
    }
    case "external": {
      const r = w / 2 - 2;
      return (
        <g>
          <circle cx={cx} cy={cy} r={r} fill={soft} stroke={strong} strokeWidth={strokeWidth} strokeDasharray="5 4" />
          <ellipse cx={cx} cy={cy} rx={r * 0.42} ry={r * 0.72} fill="none" stroke={strongBase} strokeWidth={1.3} opacity={0.7} />
          <line x1={cx - r * 0.8} y1={cy} x2={cx + r * 0.8} y2={cy} stroke={strongBase} strokeWidth={1.3} opacity={0.7} />
          <path d={`M${cx - r * 0.7},${cy - r * 0.32} a${r * 0.7},${r * 0.32} 0 0 0 ${r * 1.4},0`} fill="none" stroke={strongBase} strokeWidth={1.1} opacity={0.55} />
          <path d={`M${cx - r * 0.7},${cy + r * 0.32} a${r * 0.7},${r * 0.32} 0 0 1 ${r * 1.4},0`} fill="none" stroke={strongBase} strokeWidth={1.1} opacity={0.55} />
        </g>
      );
    }
    default:
      return null;
  }
}

const LEGEND_ITEMS: Array<{ label: string; shape: ArchShape; color: ColorKey }> = [
  { label: "Client", shape: "browser", color: "client" },
  { label: "Service", shape: "hex", color: "app" },
  { label: "Data store", shape: "cylinder", color: "data" },
  { label: "Cache", shape: "diamond", color: "cache" },
  { label: "Queue", shape: "queue", color: "queue" },
  { label: "External", shape: "external", color: "external" },
];

export function ArchitectureDiagram({
  snapshot,
  onEnterDomain,
  onSelectLens,
}: {
  snapshot: WorldSnapshot;
  onEnterDomain?: (domainId: string) => void;
  onSelectLens: (lens: WorldLens) => void;
}) {
  const { knowledgeModel, worldModel } = snapshot;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(true);
  const [viewingFilePath, setViewingFilePath] = useState<string | null>(null);
  const [repoOwner, repoName] = knowledgeModel.meta.repositoryId.split("/");
  const repoRef = knowledgeModel.meta.commitSha;

  const domains = useMemo(() => computeDomains(worldModel, knowledgeModel), [worldModel, knowledgeModel]);
  const bridges = useMemo(() => computeDomainBridges(domains, knowledgeModel), [domains, knowledgeModel]);
  const connectivity = useMemo(() => computeDomainConnectivity(domains, knowledgeModel), [domains, knowledgeModel]);
  const infraNodes = useMemo(() => computeInfrastructureNodes(knowledgeModel, domains), [knowledgeModel, domains]);
  const filesById = useMemo(() => new Map(knowledgeModel.files.map((f) => [f.id, f])), [knowledgeModel]);
  const moduleById = useMemo(() => new Map(knowledgeModel.modules.map((m) => [m.id, m])), [knowledgeModel]);

  const { nodes, edges, hiddenDomainCount } = useMemo(
    () => buildArchGraph(domains, bridges, connectivity, infraNodes),
    [domains, bridges, connectivity, infraNodes]
  );
  const { positions, width, height } = useMemo(() => layoutGraph(nodes), [nodes]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;

  const connectedIds = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>([selectedId]);
    for (const e of edges) {
      if (e.from === selectedId) set.add(e.to);
      if (e.to === selectedId) set.add(e.from);
    }
    return set;
  }, [selectedId, edges]);

  function selectNode(id: string) {
    setViewingFilePath(null);
    setSelectedId((cur) => (cur === id ? null : id));
  }

  const selectedFiles = useMemo(() => {
    if (!selected) return { list: [] as Array<{ id: string; loc: number; ext: string }>, total: 0 };
    let ids: string[];
    if (selected.kind === "infra") {
      ids = selected.infraRef!.fileIds;
    } else {
      const seen = new Set<string>();
      for (const moduleId of selected.domainRef!.moduleIds) {
        for (const fid of moduleById.get(moduleId)?.fileIds ?? []) seen.add(fid);
      }
      ids = [...seen];
    }
    const withMeta = ids.map((id) => {
      const f = filesById.get(id);
      const ext = id.includes(".") ? id.split(".").pop()! : "";
      return { id, loc: f?.linesOfCode ?? 0, ext };
    });
    withMeta.sort((a, b) => b.loc - a.loc);
    const cap = selected.kind === "domain" ? 8 : 20;
    return { list: withMeta.slice(0, cap), total: withMeta.length };
  }, [selected, moduleById, filesById]);

  if (nodes.length === 0) {
    return (
      <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden", background: "#0A0D12", color: "#9CA6AC", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, textAlign: "center", padding: 24 }}>
        <ForestBackdrop />
        <WorldHud repoName={knowledgeModel.repository.name} activeLens="architecture" onSelectLens={onSelectLens} />
        <div style={{ position: "relative" }}>No connected architecture detected yet.</div>
        <div style={{ position: "relative", fontSize: 11.5, color: "#6B7580", maxWidth: 420 }}>
          This view only shows frameworks, technologies, and code domains with a real, detected relationship — none were found in this repository.
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", minHeight: "100vh", overflow: "hidden", background: "#0A0D12", color: "#F3F1EA" }}>
      <ForestBackdrop />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "72px 24px 24px" }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", maxWidth: width, height: "auto", maxHeight: "100%", overflow: "visible" }}
          role="img"
          aria-label="Architecture diagram of the repository's detected frameworks, technologies, and code domains"
        >
          <defs>
            <marker id="cb-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={LINE_STRONG} />
            </marker>
            <marker id="cb-arrow-active" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={FOCUS} />
            </marker>
            <marker id="cb-arrow-dim" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={LINE} />
            </marker>
            <pattern id="cb-dapple" width="46" height="46" patternUnits="userSpaceOnUse">
              <circle cx="7" cy="9" r="1.5" fill={LINE_STRONG} opacity="0.25" />
              <circle cx="27" cy="23" r="2" fill={LINE_STRONG} opacity="0.16" />
              <circle cx="38" cy="5" r="1.1" fill={LINE_STRONG} opacity="0.2" />
              <circle cx="16" cy="35" r="1.4" fill={LINE_STRONG} opacity="0.18" />
            </pattern>
            <pattern id="cb-honeycomb" width="22" height="12.7" patternUnits="userSpaceOnUse">
              <path d="M5.5,0 L16.5,0 L22,6.35 L16.5,12.7 L5.5,12.7 L0,6.35 Z" fill="none" stroke={COLOR.app.strong} strokeWidth="1" />
            </pattern>
          </defs>

          <rect x={0} y={0} width={width} height={height} fill="url(#cb-dapple)" opacity="0.6" />

          {TIER_ORDER.map((tier) => (
            <text key={tier} x={TIER_X[tier]} y={26} textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontSize={10.5} letterSpacing={1.5} fill={INK_SOFT}>
              {TIER_LABEL[tier]}
            </text>
          ))}

          <g>
            {edges.map((e, i) => {
              const from = positions.get(e.from);
              const to = positions.get(e.to);
              if (!from || !to) return null;
              const fromNode = nodeById.get(e.from)!;
              const toNode = nodeById.get(e.to)!;
              const sameColumn = TIER_X[fromNode.tier] === TIER_X[toNode.tier];
              const leftFirst = sameColumn ? from.y <= to.y : from.x <= to.x;
              const [a, b] = leftFirst ? [from, to] : [to, from];
              const x1 = sameColumn ? a.x + a.w : a.x + a.w;
              const y1 = sameColumn ? a.y + a.h / 2 : a.y + a.h / 2;
              const x2 = sameColumn ? b.x + b.w : b.x;
              const y2 = sameColumn ? b.y + b.h / 2 : b.y + b.h / 2;
              const isActive = connectedIds && connectedIds.has(e.from) && connectedIds.has(e.to);
              const isDim = connectedIds && !isActive;
              const stroke = isActive ? FOCUS : isDim ? LINE : LINE_STRONG;
              const marker = e.kind === "uses" ? (isActive ? "cb-arrow-active" : isDim ? "cb-arrow-dim" : "cb-arrow") : undefined;
              const strokeWidth = e.kind === "relates" ? 1.4 + e.weight * 2.4 : isActive ? 2.2 : 1.7;
              return (
                <g key={i} opacity={isDim ? 0.3 : 1}>
                  <path
                    d={edgePath(x1, y1, x2, y2, sameColumn)}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    fill="none"
                    strokeLinecap="round"
                    markerEnd={marker ? `url(#${marker})` : undefined}
                  />
                  {e.label && (
                    <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontSize={9.5} fill={isActive ? INK : INK_SOFT}>
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          <g>
            {nodes.map((node) => {
              const pos = positions.get(node.id);
              if (!pos) return null;
              const dimmed = connectedIds ? !connectedIds.has(node.id) : false;
              const isSelected = selectedId === node.id;
              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x},${pos.y})`}
                  onClick={() => selectNode(node.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectNode(node.id);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${node.title}, ${node.badge}`}
                  style={{ cursor: "pointer" }}
                  opacity={dimmed ? 0.35 : 1}
                >
                  <NodeGlyph node={node} w={pos.w} h={pos.h} selected={isSelected} />
                  <text x={pos.w / 2} y={pos.h + 19} textAnchor="middle" fontFamily="'Space Grotesk',system-ui,sans-serif" fontSize={13} fontWeight={600} fill={INK}>
                    {node.title}
                  </text>
                  <text x={pos.w / 2} y={pos.h + 33} textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontSize={10.5} fill={INK_SOFT}>
                    {node.subtitle}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <WorldHud repoName={knowledgeModel.repository.name} activeLens="architecture" onSelectLens={onSelectLens} />

      {/* legend */}
      {legendOpen ? (
        <div style={{ position: "absolute", left: 24, top: 82, background: "rgba(18,23,29,0.82)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "14px 16px", backdropFilter: "blur(6px)", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: TEAL }}>ARCHITECTURE LENS</div>
            <button
              onClick={() => setLegendOpen(false)}
              aria-label="Close legend"
              style={{ background: "transparent", border: 0, color: "#6B7580", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {LEGEND_ITEMS.map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "#B7BDC3" }}>
                <svg width={20} height={16} viewBox="0 0 20 16">
                  <g transform="scale(0.13)">
                    <NodeGlyph node={{ id: "", tier: "client", shape: item.shape, color: item.color, title: "", subtitle: "", badge: "", description: "", kind: "infra" }} w={150} h={h_for(item.shape)} selected={false} />
                  </g>
                </svg>
                {item.label}
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "#B7BDC3", marginTop: 2 }}>
              <svg width={20} height={10}>
                <line x1="1" y1="5" x2="19" y2="5" stroke={LINE_STRONG} strokeWidth="1.7" strokeLinecap="round" markerEnd="url(#cb-arrow)" />
              </svg>
              real dependency
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "#B7BDC3" }}>
              <svg width={20} height={10}>
                <line x1="1" y1="5" x2="19" y2="5" stroke={LINE_STRONG} strokeWidth="3" strokeLinecap="round" />
              </svg>
              code relationship
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setLegendOpen(true)}
          aria-label="Show legend"
          style={{
            position: "absolute",
            left: 24,
            top: 82,
            zIndex: 1,
            background: "rgba(18,23,29,0.82)",
            border: "0.5px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            padding: "8px 12px",
            backdropFilter: "blur(6px)",
            color: TEAL,
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 10,
            letterSpacing: 1.2,
            cursor: "pointer",
          }}
        >
          LEGEND
        </button>
      )}

      {/* footer stats */}
      <div style={{ position: "absolute", right: 24, bottom: 24 }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#6B7580", background: "rgba(18,23,29,0.7)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 9, padding: "9px 14px" }}>
          {nodes.filter((n) => n.kind === "domain").length} domain{nodes.filter((n) => n.kind === "domain").length === 1 ? "" : "s"} · {nodes.filter((n) => n.kind === "infra").length} technology dependenc{nodes.filter((n) => n.kind === "infra").length === 1 ? "y" : "ies"} · {edges.length} relationship{edges.length === 1 ? "" : "s"} shown
          {hiddenDomainCount > 0 && ` · ${hiddenDomainCount} more domain${hiddenDomainCount === 1 ? "" : "s"} not shown`}
        </div>
      </div>

      {/* bottom hint */}
      <div style={{ position: "absolute", left: 24, bottom: 24, display: "flex", alignItems: "center", gap: 8, background: "rgba(18,23,29,0.7)", border: "0.5px solid rgba(255,255,255,0.09)", borderRadius: 9, padding: "10px 14px" }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M2 8h12M8 2l6 6-6 6" stroke={TEAL} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, color: "#9CA6AC" }}>Click a component to see the files behind it</span>
      </div>

      {/* inspector panel */}
      {selected && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: viewingFilePath ? 640 : 340,
            maxWidth: "90vw",
            zIndex: 2,
            background: "rgba(13,17,22,0.96)",
            borderLeft: `0.5px solid ${COLOR[selected.color].strong}55`,
            padding: "88px 24px 24px",
            overflowY: "auto",
            backdropFilter: "blur(8px)",
            transition: "width 0.15s ease",
          }}
        >
          <button
            onClick={() => (viewingFilePath ? setViewingFilePath(null) : setSelectedId(null))}
            style={{ position: "absolute", top: 24, right: 24, background: "transparent", border: 0, color: "#6B7580", cursor: "pointer", fontSize: 13 }}
          >
            {viewingFilePath ? "← back" : "✕ close"}
          </button>

          {viewingFilePath ? (
            <>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1.2, color: COLOR[selected.color].strong, marginBottom: 8 }}>
                {selected.title.toUpperCase()} · SOURCE
              </div>
              <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{viewingFilePath.split("/").pop()}</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#6B7580", marginBottom: 20 }}>{viewingFilePath}</div>
              <CodeViewer owner={repoOwner} repo={repoName} gitRef={repoRef} path={viewingFilePath} />
            </>
          ) : (
            <>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: COLOR[selected.color].strong,
                  background: COLOR[selected.color].soft,
                  borderRadius: 999,
                  padding: "3px 10px",
                  marginBottom: 10,
                }}
              >
                {selected.badge}
              </div>
              <div style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 20, fontWeight: 700 }}>{selected.title}</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#6B7580", marginBottom: 14 }}>{selected.subtitle}</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: "#B7BDC3", marginBottom: 18, paddingBottom: 18, borderBottom: "0.5px solid rgba(255,255,255,0.08)" }}>
                {selected.description}
              </div>

              {selected.kind === "domain" && onEnterDomain && (
                <button
                  onClick={() => onEnterDomain(selected.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: COLOR[selected.color].soft,
                    color: COLOR[selected.color].strong,
                    border: `0.5px solid ${COLOR[selected.color].strong}55`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontFamily: "'Space Grotesk',system-ui,sans-serif",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    marginBottom: 20,
                  }}
                >
                  Open domain view →
                </button>
              )}

              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: 1, color: "#6B7580", marginBottom: 8 }}>
                FILES IN THIS COMPONENT · {selectedFiles.total}
              </div>
              {selectedFiles.list.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setViewingFilePath(f.id)}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: "transparent", border: 0, padding: "5px 0", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.75")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
                >
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, fontWeight: 500, color: "#0A0D12", background: "#8A9199", borderRadius: 4, padding: "2px 4px", minWidth: 24, textAlign: "center", flexShrink: 0 }}>
                    {f.ext.toUpperCase()}
                  </span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: "#D8DBDE", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.id}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "#6B7580", flexShrink: 0 }}>{f.loc} loc</span>
                </button>
              ))}
              {selectedFiles.total > selectedFiles.list.length && (
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "#6B7580", marginTop: 6 }}>
                  +{selectedFiles.total - selectedFiles.list.length} more file{selectedFiles.total - selectedFiles.list.length === 1 ? "" : "s"}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function h_for(shape: ArchShape): number {
  return SHAPE_SIZE[shape].h;
}
