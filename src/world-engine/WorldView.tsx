"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import type { WorldModel, WorldLandmark } from "@/types/world-model";
import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { Flow } from "@/types/flow";
import type { Lens } from "@/world-engine/lens";
import { computeDomains, computeDomainBridges, type Domain } from "@/world-engine/domains";
import { hasStructuralRisk, type BuildingRole } from "@/world-engine/buildingRoles";
import { computeDomainSequence, buildingForFile, type DomainSequence, type PlacedBuilding } from "@/world-engine/sequenceLayout";
import { layoutDomains, domainRadius, gatePosition, maxLayoutRadius, type Vec3 } from "@/lib/worldLayout";
import { Landmass, DistrictZone, PersistenceYard, Plaza, PLAZA_HEIGHT } from "@/world-engine/terrain";
import { BuildingByRole, BuildingLabel, SkylineBlock } from "@/world-engine/buildings";
import { RoadRibbon, LitRoute } from "@/world-engine/roads";
import { Avatar } from "./Avatar";
import { Bob } from "./Bob";

/**
 * The world renderer — an explorable architectural landscape (product
 * brief: "a place, not a graph rendered in 3D"). One continuous landmass;
 * districts are ground zones on it; entering one reveals an avenue of
 * role-specific buildings (gate, hub, crystal, archive, silo, ...)
 * connected by physical roads, with persistence roles sunk into a real
 * recessed yard behind a retaining wall. The Flow lens lights the SAME
 * avenue rather than approximating a second layout.
 *
 * This file (and its siblings in `world-engine/`) is the ONLY place in the
 * app that imports `three`/`@react-three/*`.
 */

export interface ExplorationUpdate {
  nearestRegionName: string | null;
  visitedCount: number;
  totalCount: number;
  avatarPosition: [number, number];
}

export interface BobFocus {
  moduleId: string;
  /** A specific FlowStep/file id when a finer-grained position is resolvable — falls back to the module's own position otherwise. */
  fileId: string | null;
}

const MODULE_LANDMARK_ROLE: Record<WorldLandmark["type"], BuildingRole | "ruins" | "training-ground" | "generic"> = {
  landmark: "generic",
  cave: "database",
  portal: "external-api",
  library: "repository",
  "training-ground": "training-ground",
  ruins: "ruins",
  gate: "controller",
  factory: "middleware",
};

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function ExplorationTracker({
  domains,
  domainPositions,
  avatarPositionRef,
  visitedRef,
  onUpdate,
}: {
  domains: Domain[];
  domainPositions: Map<string, Vec3>;
  avatarPositionRef: React.MutableRefObject<THREE.Vector3>;
  visitedRef: React.MutableRefObject<Set<string>>;
  onUpdate: (u: ExplorationUpdate) => void;
}) {
  const acc = useRef(0);
  useFrame((_, delta) => {
    acc.current += delta;
    if (acc.current < 0.35) return;
    acc.current = 0;

    const pos = avatarPositionRef.current;
    let nearest: Domain | null = null;
    let nearestDist = Infinity;
    for (const d of domains) {
      const p = domainPositions.get(d.id) ?? [0, 0, 0];
      const dist = Math.hypot(pos.x - p[0], pos.z - p[2]);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = d;
      }
      if (dist < domainRadius(d) + 1.5) visitedRef.current.add(d.id);
    }

    onUpdate({
      nearestRegionName: nearest && nearestDist < domainRadius(nearest) + 4 ? nearest.name : null,
      visitedCount: visitedRef.current.size,
      totalCount: domains.length,
      avatarPosition: [pos.x, pos.z],
    });
  });
  return null;
}

function CameraDirector({
  avatarPositionRef,
  focusTarget,
  focusExtent,
}: {
  avatarPositionRef: React.MutableRefObject<THREE.Vector3>;
  focusTarget: Vec3 | null;
  /** Null = a tight close-up on one specific building. A number = "pull back far enough to frame a district roughly this wide" — scaled to the district's REAL avenue/plaza/yard span, never a fixed constant (an avenue can be 5 units or 30). */
  focusExtent: number | null;
}) {
  const controls = useRef<CameraControls | null>(null);
  const prevFocus = useRef<Vec3 | null>(null);
  const resumeAt = useRef(0);
  const initialized = useRef(false);

  useFrame((state) => {
    if (!controls.current) return;
    const now = state.clock.elapsedTime;

    if (!initialized.current) {
      const p = avatarPositionRef.current;
      controls.current.setLookAt(p.x - 7, 6, p.z + 9, p.x, 1, p.z, false);
      initialized.current = true;
    }

    if (focusTarget && focusTarget !== prevFocus.current) {
      const [x, y, z] = focusTarget;
      // A close-up on one building uses a fixed tight offset; a district-
      // level view scales its pull-back distance to the district's actual
      // size so the whole avenue/plaza/yard sequence fits in frame instead
      // of showing one building with the rest cropped out.
      const pull = focusExtent === null ? 5 : Math.max(9, focusExtent * 0.85);
      const height = focusExtent === null ? 3.2 : Math.max(7, focusExtent * 0.55);
      const d = [pull * 0.75, height, pull];
      controls.current.setLookAt(x + d[0], y + d[1], z + d[2], x, y + 0.8, z, true);
      prevFocus.current = focusTarget;
      resumeAt.current = now + 900;
    }

    if (!focusTarget && prevFocus.current) {
      const p = avatarPositionRef.current;
      controls.current.setLookAt(p.x - 7, 6, p.z + 9, p.x, 1, p.z, true);
      prevFocus.current = null;
      resumeAt.current = now + 900;
    }

    if (!focusTarget && now * 1000 > resumeAt.current) {
      const p = avatarPositionRef.current;
      controls.current.moveTo(p.x, 1, p.z, false);
    }
  });

  return <CameraControls ref={controls} makeDefault minDistance={3} maxDistance={70} maxPolarAngle={Math.PI / 2.1} />;
}

function SkyDome() {
  const geometry = useMemo(() => {
    const geo = new THREE.SphereGeometry(220, 24, 16);
    const top = new THREE.Color("#1B2740");
    const horizon = new THREE.Color("#141C27");
    const bottom = new THREE.Color("#05070A");
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(pos.getY(i) / 220, -1, 1);
      const c = t >= 0 ? horizon.clone().lerp(top, t) : horizon.clone().lerp(bottom, -t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, []);
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} />
    </mesh>
  );
}

function Horizon() {
  const rings = [
    { radius: 90, height: 16, color: "#161F2C" },
    { radius: 118, height: 24, color: "#0F1620" },
    { radius: 150, height: 34, color: "#080D13" },
  ];
  return (
    <>
      {rings.map((ring, ri) => {
        const count = 14 + ri * 3;
        return (
          <group key={ri}>
            {Array.from({ length: count }).map((_, i) => {
              const angle = (i / count) * Math.PI * 2 + ri * 0.5;
              const jitter = 0.55 + 0.45 * Math.sin(i * 12.9898 + ri * 4.23);
              const h = ring.height * jitter;
              return (
                <mesh key={i} position={[Math.cos(angle) * ring.radius, h / 2 - 1.5, Math.sin(angle) * ring.radius]}>
                  <coneGeometry args={[ring.radius * 0.18, h, 4]} />
                  <meshBasicMaterial color={ring.color} fog />
                </mesh>
              );
            })}
          </group>
        );
      })}
    </>
  );
}

function Environment() {
  const { scene } = useThree();
  useMemo(() => {
    scene.fog = new THREE.Fog("#0A0D12", 34, 130);
  }, [scene]);
  return (
    <>
      <SkyDome />
      <Horizon />
      <hemisphereLight args={["#5A6E96", "#233A2B", 1.1]} />
      <ambientLight intensity={0.6} color="#96A6D9" />
      <directionalLight position={[-20, 30, -10]} intensity={0.85} color="#C7D2FF" />
      <mesh position={[55, 45, -70]}>
        <sphereGeometry args={[7, 24, 24]} />
        <meshBasicMaterial color="#F6E7C9" fog={false} />
      </mesh>
      <mesh position={[55, 45, -70]}>
        <sphereGeometry args={[14, 24, 24]} />
        <meshBasicMaterial color="#F2B84B" transparent opacity={0.12} fog={false} depthWrite={false} />
      </mesh>
      <Sparkles count={40} scale={[80, 6, 80]} size={2.2} speed={0.2} color="#F2B84B" opacity={0.5} />
    </>
  );
}

// A role's relative prominence within a skyline — mirrors MAIN_SEQUENCE_ORDER
// (the service/hub is the tallest, matching "importance = building height,"
// never platform elevation) but scaled down for the overview's simple
// block silhouettes rather than the full domain-view role shapes.
const SKYLINE_ROLE_HEIGHT: Partial<Record<string, number>> = {
  service: 1.5,
  repository: 1.15,
  entity: 1.0,
  database: 0.95,
  controller: 0.75,
  handler: 0.75,
  "external-api": 0.85,
  event: 0.8,
  middleware: 0.6,
};

/** A compact, low-detail skyline for the overview level — simple pitched-roof
 *  blocks clustered tightly (a real skyline silhouette), not the full
 *  role-specific architecture reserved for once a district is entered. */
function MiniSkyline({ domain, sequence, dimmed }: { domain: Domain; sequence: DomainSequence; dimmed: boolean }) {
  const items = useMemo(() => {
    if (sequence.isGeneric) {
      // No recognizable role anywhere — still show a real skyline sized by
      // the domain's own footprint/importance, never an empty district.
      const count = Math.max(1, Math.min(3, Math.round(domain.footprint / 2)));
      return Array.from({ length: count }).map((_, i) => ({
        height: 0.7 + domain.height * 0.5 - i * 0.15,
        position: [(i - (count - 1) / 2) * 0.5, 0, (i % 2) * 0.3 - 0.15] as Vec3,
      }));
    }
    const capped = sequence.buildings.slice(0, 6);
    const cols = Math.ceil(Math.sqrt(capped.length));
    return capped.map((b, i) => ({
      height: SKYLINE_ROLE_HEIGHT[b.role] ?? 0.7,
      position: [(i % cols) * 0.55 - (cols - 1) * 0.275, 0, Math.floor(i / cols) * 0.55] as Vec3,
    }));
  }, [sequence, domain]);

  const tallestIndex = items.reduce((best, it, i) => (it.height > items[best].height ? i : best), 0);

  return (
    <group scale={dimmed ? 0.98 : 1}>
      {items.map((it, i) => (
        <group key={i} position={it.position}>
          <SkylineBlock height={it.height} healthTier={domain.healthTier} isPrimary={i === tallestIndex} />
        </group>
      ))}
    </group>
  );
}

export function WorldView({
  worldModel,
  knowledgeModel,
  lens,
  focusedDomainId,
  onFocusDomain,
  selectedModuleId,
  onSelectEntity,
  onDeselect,
  onExplorationUpdate,
  flowHighlightModuleIds = null,
  activeFlow = null,
  currentFlowStepId = null,
  activeOnboardingModuleIds = null,
  bobFocus = null,
  bobActive = false,
  activityModuleIds = null,
}: {
  worldModel: WorldModel;
  knowledgeModel: RepositoryKnowledgeModel;
  lens: Lens;
  focusedDomainId: string | null;
  onFocusDomain: (domainId: string | null) => void;
  selectedModuleId: string | null;
  onSelectEntity: (sourceEntityId: string, worldEntityId: string) => void;
  onDeselect: () => void;
  onExplorationUpdate: (u: ExplorationUpdate) => void;
  flowHighlightModuleIds?: Set<string> | null;
  activeFlow?: Flow | null;
  currentFlowStepId?: string | null;
  activeOnboardingModuleIds?: string[] | null;
  bobFocus?: BobFocus | null;
  bobActive?: boolean;
  activityModuleIds?: Set<string> | null;
}) {
  const domains = useMemo(() => computeDomains(worldModel, knowledgeModel), [worldModel, knowledgeModel]);
  const domainPositions = useMemo(() => layoutDomains(domains), [domains]);
  const domainBridges = useMemo(() => computeDomainBridges(domains, knowledgeModel), [domains, knowledgeModel]);
  const landmassExtent = useMemo(() => maxLayoutRadius(domainPositions) + 6, [domainPositions]);
  const landmassSeed = useMemo(() => {
    let h = 0;
    for (const ch of knowledgeModel.meta.repositoryId) h = (h * 31 + ch.charCodeAt(0)) % 97;
    return h;
  }, [knowledgeModel.meta.repositoryId]);

  const focusedDomain = focusedDomainId ? domains.find((d) => d.id === focusedDomainId) ?? null : null;
  const sequenceByDomain = useMemo(() => {
    const m = new Map<string, DomainSequence>();
    for (const d of domains) m.set(d.id, computeDomainSequence(d, knowledgeModel));
    return m;
  }, [domains, knowledgeModel]);

  const fileRiskById = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const f of knowledgeModel.files) m.set(f.id, hasStructuralRisk(f.riskIndicators));
    return m;
  }, [knowledgeModel.files]);

  const moduleById = useMemo(() => new Map(knowledgeModel.modules.map((m) => [m.id, m])), [knowledgeModel.modules]);
  const landmarkByModuleId = useMemo(() => {
    const m = new Map<string, WorldLandmark>();
    for (const l of worldModel.landmarks) if (l.sourceEntityKind === "module") m.set(l.sourceEntityId, l);
    return m;
  }, [worldModel.landmarks]);

  // Where a module "currently is" on screen, regardless of drill-down state
  // — the entered domain's own world position (buildings are positioned
  // relative to it), or a NOT-entered domain's zone center. Bob and the
  // Flow/Onboarding routes always target a real, currently-resolvable
  // point using this.
  const moduleGroundPos = useMemo(() => {
    const m = new Map<string, Vec3>();
    for (const domain of domains) {
      const domainPos = domainPositions.get(domain.id) ?? [0, 0, 0];
      for (const moduleId of domain.moduleIds) m.set(moduleId, domainPos);
    }
    return m;
  }, [domains, domainPositions]);

  const fileGroundPos = useMemo(() => {
    const m = new Map<string, Vec3>();
    if (!focusedDomain) return m;
    const domainPos = domainPositions.get(focusedDomain.id) ?? [0, 0, 0];
    const sequence = sequenceByDomain.get(focusedDomain.id);
    if (!sequence) return m;
    for (const b of sequence.buildings) m.set(b.fileId, add(domainPos, b.position));
    return m;
  }, [focusedDomain, domainPositions, sequenceByDomain]);

  // Existing selection/session-context/Bob-action state is all
  // module-granularity (InvestigationPanel, get_current_context, etc. all
  // key off moduleId — unchanged contract). A module can now correspond to
  // SEVERAL buildings (e.g. a controller + service + entity all in one
  // "user" module) — this resolves a module id to its single most
  // representative building position (the service/hub if present,
  // otherwise the earliest on the avenue) ONLY when that module's domain is
  // currently entered; otherwise falls back to the domain's own center.
  const positionForModule = (moduleId: string): Vec3 | null => {
    if (focusedDomain && focusedDomain.moduleIds.includes(moduleId)) {
      const domainPos = domainPositions.get(focusedDomain.id) ?? [0, 0, 0];
      const sequence = sequenceByDomain.get(focusedDomain.id);
      const candidates = sequence?.buildings.filter((b) => b.moduleId === moduleId) ?? [];
      if (candidates.length > 0) {
        const best = candidates.find((b) => b.role === "service") ?? [...candidates].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))[0];
        return add(domainPos, best.position);
      }
    }
    return moduleGroundPos.get(moduleId) ?? null;
  };

  const flowRoute = useMemo(() => {
    if (!activeFlow || !focusedDomain) return [];
    const sequence = sequenceByDomain.get(focusedDomain.id);
    if (!sequence) return [];
    const domainPos = domainPositions.get(focusedDomain.id) ?? [0, 0, 0];
    const pts: Vec3[] = [];
    for (const step of activeFlow.steps) {
      const b = buildingForFile(sequence, step.entityId);
      if (b) pts.push(add(domainPos, b.position));
    }
    return pts;
  }, [activeFlow, focusedDomain, sequenceByDomain, domainPositions]);

  const onboardingRoute = useMemo(
    () => (activeOnboardingModuleIds ? activeOnboardingModuleIds.map((id) => moduleGroundPos.get(id)).filter((p): p is Vec3 => !!p) : []),
    [activeOnboardingModuleIds, moduleGroundPos]
  );

  const avatarPositionRef = useRef(new THREE.Vector3());
  const initialGate = gatePosition(domainPositions);
  if (avatarPositionRef.current.lengthSq() === 0) avatarPositionRef.current.set(initialGate[0], 0, initialGate[2]);
  const visitedRef = useRef<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const selectedPos = selectedModuleId ? positionForModule(selectedModuleId) : null;

  const currentFlowStepPos =
    lens === "flow" && currentFlowStepId && activeFlow && focusedDomain
      ? (() => {
          const step = activeFlow.steps.find((s) => s.id === currentFlowStepId);
          if (!step) return null;
          const sequence = sequenceByDomain.get(focusedDomain.id);
          const b = sequence ? buildingForFile(sequence, step.entityId) : null;
          if (!b) return null;
          return add(domainPositions.get(focusedDomain.id) ?? [0, 0, 0], b.position);
        })()
      : null;

  // When a domain is focused with nothing more specific selected, frame the
  // MIDDLE of its actual avenue (not just its nominal zone center, which is
  // the entrance end) and pull the camera back far enough to fit the whole
  // sequence — a real, per-domain extent, never a fixed distance, since an
  // avenue can be one building wide or span a dozen.
  const districtFraming = useMemo(() => {
    if (!focusedDomain) return null;
    const domainPos = domainPositions.get(focusedDomain.id) ?? [0, 0, 0];
    const sequence = sequenceByDomain.get(focusedDomain.id);
    if (!sequence || sequence.isGeneric) return { target: domainPos, extent: 9 };
    const xs = sequence.avenuePoints.map((p) => p[0]);
    if (sequence.yard) xs.push(sequence.yard.center[0] - sequence.yard.width / 2, sequence.yard.center[0] + sequence.yard.width / 2);
    const minX = Math.min(0, ...xs);
    const maxX = Math.max(0, ...xs);
    const midX = (minX + maxX) / 2;
    return { target: add(domainPos, [midX, 0, 0]) as Vec3, extent: Math.max(9, maxX - minX) };
  }, [focusedDomain, domainPositions, sequenceByDomain]);

  const focusTarget: Vec3 | null = currentFlowStepPos ?? selectedPos ?? districtFraming?.target ?? null;
  const focusExtent: number | null = !currentFlowStepPos && !selectedPos && districtFraming ? districtFraming.extent : null;

  const bobModulePos = bobFocus
    ? (bobFocus.fileId ? fileGroundPos.get(bobFocus.fileId) : undefined) ?? positionForModule(bobFocus.moduleId)
    : null;

  const routeActive = (lens === "flow" && activeFlow !== null) || (lens === "onboarding" && (activeOnboardingModuleIds?.length ?? 0) > 0);
  const relevantModuleIds = lens === "flow" ? flowHighlightModuleIds : lens === "onboarding" ? new Set(activeOnboardingModuleIds ?? []) : lens === "activity" ? activityModuleIds : null;

  const disabled = selectedModuleId !== null || focusedDomainId !== null;

  return (
    <Canvas shadows camera={{ fov: 45 }} onPointerMissed={onDeselect} gl={{ toneMappingExposure: 1.4 }}>
      <Environment />
      <CameraDirector avatarPositionRef={avatarPositionRef} focusTarget={focusTarget} focusExtent={focusExtent} />
      <ExplorationTracker
        domains={domains}
        domainPositions={domainPositions}
        avatarPositionRef={avatarPositionRef}
        visitedRef={visitedRef}
        onUpdate={onExplorationUpdate}
      />
      <Avatar positionRef={avatarPositionRef} bounds={landmassExtent + 10} disabled={disabled} />
      <Bob targetPosition={bobModulePos} active={bobActive && bobModulePos !== null} />

      <Landmass extent={landmassExtent} seed={landmassSeed} />

      {/* Domain-to-domain bridges — the only cross-district connections rendered at overview scale; a real architectural gap, never a floating line. */}
      {domainBridges.map((bridge) => {
        const from = domainPositions.get(bridge.fromDomainId);
        const to = domainPositions.get(bridge.toDomainId);
        if (!from || !to) return null;
        const touchesFocused = focusedDomainId !== null && (bridge.fromDomainId === focusedDomainId || bridge.toDomainId === focusedDomainId);
        const emphasize = lens === "dependencies";
        return (
          <RoadRibbon
            key={`${bridge.fromDomainId}-${bridge.toDomainId}`}
            kind="bridge"
            from={from}
            to={to}
            cyclic={bridge.cyclic}
            confidence={bridge.confidence}
            weight={bridge.weight}
            highlighted={touchesFocused || emphasize}
            dimmed={routeActive || (focusedDomainId !== null && !touchesFocused && !emphasize)}
          />
        );
      })}

      {/* District zones — ground color washes on the ONE shared landmass. The focused one steps aside for its revealed avenue; every other stays visible but subdued. */}
      {domains.map((domain) => {
        const pos = domainPositions.get(domain.id);
        if (!pos) return null;
        const sequence = sequenceByDomain.get(domain.id)!;
        const isFocused = focusedDomain?.id === domain.id;
        return (
          <group key={domain.id} position={pos}>
            <DistrictZone
              domain={domain}
              radius={domainRadius(domain)}
              position={[0, 0, 0]}
              selected={false}
              hovered={hoveredId === domain.id}
              dimmed={(focusedDomainId !== null && !isFocused) || routeActive}
              onSelect={() => onFocusDomain(domain.id)}
              onHover={(v) => setHoveredId(v ? domain.id : null)}
            />
            {!isFocused && <MiniSkyline domain={domain} sequence={sequence} dimmed={focusedDomainId !== null || routeActive} />}
            {!isFocused && (
              <BuildingLabel
                name={domain.name}
                role={domain.isInfra ? "training-ground" : ""}
                position={[0, domainRadius(domain) * 0.15 + 1.6, 0]}
                damaged={domain.healthTier === "critical"}
              />
            )}
          </group>
        );
      })}

      {/* The focused domain's own avenue: buildings, roads, and (if it has persistence roles) the sunken yard behind its retaining wall. */}
      {focusedDomain &&
        (() => {
          const domainPos = domainPositions.get(focusedDomain.id)!;
          const sequence = sequenceByDomain.get(focusedDomain.id)!;

          if (sequence.isGeneric) {
            // No recognizable architectural role anywhere in this domain —
            // fall back to the deterministic module-level classification
            // (tests/docs/db-directory/ruins/plain) rather than inventing one.
            const moduleId = focusedDomain.moduleIds[0];
            const landmark = landmarkByModuleId.get(moduleId);
            const role = landmark ? MODULE_LANDMARK_ROLE[landmark.type] : "generic";
            const mod = moduleById.get(moduleId);
            return (
              <group position={domainPos}>
                <BuildingByRole role={role} scale={1.1} healthTier={focusedDomain.healthTier} damaged={focusedDomain.hasRisk} isPrimary />
                <BuildingLabel name={mod?.name ?? focusedDomain.name} role={String(role)} position={[0, 2.4, 0]} damaged={focusedDomain.hasRisk} />
              </group>
            );
          }

          const primaryFileId = sequence.buildings.find((b) => b.role === "service")?.fileId ?? sequence.buildings[0]?.fileId;

          return (
            <group position={domainPos}>
              {sequence.plaza && <Plaza center={sequence.plaza.center} radius={sequence.plaza.radius} healthTier={focusedDomain.healthTier} />}
              {sequence.yard && (
                <PersistenceYard
                  center={sequence.yard.center}
                  wallCenter={sequence.yard.wallCenter}
                  facingAngle={sequence.yard.facingAngle}
                  width={sequence.yard.width}
                  depth={sequence.yard.depth}
                  drop={sequence.yard.drop}
                />
              )}

              {/* the avenue itself */}
              {sequence.avenuePoints.slice(0, -1).map((p, i) => (
                <RoadRibbon
                  key={`avenue-${i}`}
                  kind="road"
                  from={p}
                  to={sequence.avenuePoints[i + 1]}
                  cyclic={false}
                  confidence={1}
                  weight={0.5}
                  highlighted={lens === "dependencies"}
                  dimmed={routeActive}
                />
              ))}
              {/* spur roads to side branches */}
              {sequence.buildings
                .filter((b) => !b.onMainSequence)
                .map((b) => (
                  <RoadRibbon
                    key={`spur-${b.fileId}`}
                    kind="road"
                    from={[b.position[0], 0, 0]}
                    to={b.position}
                    cyclic={false}
                    confidence={0.7}
                    weight={0.25}
                    highlighted={false}
                    dimmed={routeActive && !relevantModuleIds?.has(b.moduleId)}
                  />
                ))}

              {routeActive && lens === "flow" && flowRoute.length > 1 && <LitRoute points={flowRoute} color="#F2B84B" />}
              {routeActive && lens === "onboarding" && (() => {
                const local = onboardingRoute.map((p) => [p[0] - domainPos[0], p[1] - domainPos[1], p[2] - domainPos[2]] as Vec3);
                return local.length > 1 ? <LitRoute points={local} color="#7C9CFF" /> : null;
              })()}

              {sequence.buildings.map((b) => {
                const damaged = fileRiskById.get(b.fileId) ?? false;
                const inRoute = routeActive && relevantModuleIds !== null && relevantModuleIds.has(b.moduleId);
                const inActivity = lens === "activity" && activityModuleIds !== null && activityModuleIds.has(b.moduleId);
                const emphasized = inRoute || inActivity || b.fileId === selectedModuleId;
                const dimVisual = routeActive && !inRoute && b.fileId !== selectedModuleId;
                // At-grade main-sequence buildings (entrance/hub/entity) stand
                // ON the plaza's real deck surface, not floating just above
                // or sinking into it.
                const onPlaza = sequence.plaza !== null && b.onMainSequence && b.position[1] === 0;
                const renderPosition: Vec3 = onPlaza ? [b.position[0], b.position[1] + PLAZA_HEIGHT, b.position[2]] : b.position;
                return (
                  <group
                    key={b.fileId}
                    position={renderPosition}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEntity(b.moduleId, b.moduleId);
                    }}
                    onPointerOver={(e) => {
                      e.stopPropagation();
                      setHoveredId(b.fileId);
                      document.body.style.cursor = "pointer";
                    }}
                    onPointerOut={() => {
                      setHoveredId(null);
                      document.body.style.cursor = "auto";
                    }}
                  >
                    <group scale={dimVisual ? 0.96 : 1}>
                      <BuildingByRole role={b.role} scale={1} healthTier={damaged ? "critical" : focusedDomain.healthTier} damaged={damaged} isPrimary={b.fileId === primaryFileId} />
                    </group>
                    {(hoveredId === b.fileId || emphasized || !routeActive) && (
                      <BuildingLabel name={b.path.split("/").pop() ?? b.path} role={b.role} position={[0, 2.2, 0]} damaged={damaged} />
                    )}
                  </group>
                );
              })}
            </group>
          );
        })()}
    </Canvas>
  );
}
