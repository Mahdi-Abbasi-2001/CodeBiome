"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line, Text } from "@react-three/drei";
import * as THREE from "three";
import type { BuildingRole } from "@/world-engine/buildingRoles";
import type { Vec3 } from "@/lib/worldLayout";

/**
 * Role-specific architectural primitives — the approved Claude Design
 * concept's core requirement: "the object itself should communicate
 * something about the software role," not one primitive recolored per
 * type. Every shape here is a small, cheap, procedural mesh group (no
 * external assets), built once per building and otherwise static —
 * `useFrame` is used only for the handful of genuinely animated accents
 * (a beacon's glow, a risk pulse), never for idle motion on every object.
 *
 * Health/risk is never color-only: a damaged building gets a visibly
 * different silhouette (a crack, a lean, a broken facet) in addition to
 * the ember palette swap (product brief §20/§9 — the no-label test).
 */

const HEALTHY_PALETTE = { deep: "#123B2C", mid: "#237556", light: "#3FA672", trim: "#4FD1C5" };
const STRESSED_PALETTE = { deep: "#3A3320", mid: "#5C4A22", light: "#8A672B", trim: "#F2B84B" };
const DAMAGED_PALETTE = { deep: "#2A1613", mid: "#4A1C15", light: "#7A2E22", trim: "#E0553F" };

function paletteFor(healthTier: string, damaged: boolean) {
  if (damaged || healthTier === "critical") return DAMAGED_PALETTE;
  if (healthTier === "stressed") return STRESSED_PALETTE;
  return HEALTHY_PALETTE;
}

/** A crack decal — the structural (not just color) risk signal. A jagged line lying flat at the building's base. */
function CrackDecal({ scale, color }: { scale: number; color: string }) {
  const points: Vec3[] = [
    [-scale * 0.5, 0.02, scale * 0.1],
    [-scale * 0.15, 0.02, -scale * 0.15],
    [scale * 0.1, 0.02, scale * 0.05],
    [scale * 0.45, 0.02, -scale * 0.2],
  ];
  return <Line points={points} color={color} lineWidth={1.6} />;
}

/** Controller/handler — a gate: the district (or repository) entrance. Traffic visibly enters here. */
export function GateBuilding({ scale, healthTier, damaged = false }: { scale: number; healthTier: string; damaged?: boolean }) {
  const p = paletteFor(healthTier, damaged);
  const h = 1.7 * scale;
  return (
    <group rotation={damaged ? [0, 0, 0.05] : [0, 0, 0]}>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * scale * 0.6, h / 2, 0]} castShadow>
          <boxGeometry args={[scale * 0.22, h, scale * 0.22]} />
          <meshStandardMaterial color={p.deep} emissive={p.trim} emissiveIntensity={0.3} />
        </mesh>
      ))}
      <mesh position={[0, h + scale * 0.05, 0]} castShadow>
        <boxGeometry args={[scale * 1.6, scale * 0.18, scale * 0.24]} />
        <meshStandardMaterial color={p.deep} />
      </mesh>
      <mesh position={[0, scale * 0.35, 0]}>
        <boxGeometry args={[scale * 0.7, scale * 0.28, 0.03]} />
        <meshStandardMaterial color={p.trim} emissive={p.trim} emissiveIntensity={0.55} transparent opacity={0.85} />
      </mesh>
      {damaged && <CrackDecal scale={scale} color={p.trim} />}
    </group>
  );
}

/** Service — the central hub: a stepped ziggurat tower, tallest and most ornamented, the plaza is built around it. */
export function HubBuilding({ scale, healthTier, damaged = false, isPrimary = false }: { scale: number; healthTier: string; damaged?: boolean; isPrimary?: boolean }) {
  const p = paletteFor(healthTier, damaged);
  const beaconRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (beaconRef.current) {
      const m = beaconRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.18 + Math.sin(Date.now() * 0.0006) * 0.07;
    }
  });
  const tier1 = 1.5 * scale;
  const tier2 = 0.95 * scale;
  const tier3 = 0.5 * scale;
  return (
    <group rotation={damaged ? [0, 0, 0.04] : [0, 0, 0]}>
      <mesh position={[0, tier1 / 2, 0]} castShadow>
        <boxGeometry args={[scale * 1.5, tier1, scale * 1.5]} />
        <meshStandardMaterial color={p.mid} flatShading />
      </mesh>
      <mesh position={[0, tier1 + tier2 / 2, 0]} castShadow>
        <boxGeometry args={[scale * 0.95, tier2, scale * 0.95]} />
        <meshStandardMaterial color={p.light} emissive={p.trim} emissiveIntensity={0.22} flatShading />
      </mesh>
      <mesh position={[0, tier1 + tier2 + tier3 / 2, 0]} castShadow>
        <boxGeometry args={[scale * 0.55, tier3, scale * 0.55]} />
        <meshStandardMaterial color={p.mid} flatShading />
      </mesh>
      {isPrimary && (
        <>
          <mesh ref={beaconRef} position={[0, tier1 + tier2 + tier3 + scale * 0.35, 0]}>
            <sphereGeometry args={[scale * 1.1, 16, 16]} />
            <meshBasicMaterial color="#F2B84B" transparent opacity={0.2} depthWrite={false} />
          </mesh>
          <mesh position={[0, tier1 + tier2 + tier3 + scale * 0.18, 0]}>
            <sphereGeometry args={[scale * 0.16, 12, 12]} />
            <meshStandardMaterial color="#F2B84B" emissive="#F2B84B" emissiveIntensity={0.9} />
          </mesh>
          <pointLight position={[0, tier1 + tier2 + tier3 + scale * 0.3, 0]} color="#F2B84B" intensity={2} distance={scale * 8} />
        </>
      )}
      {damaged && <CrackDecal scale={scale} color={p.trim} />}
    </group>
  );
}

/** Entity/model — a faceted crystal: the data boundary, deliberately NOT a building. */
export function EntityBuilding({ scale, healthTier, damaged = false }: { scale: number; healthTier: string; damaged?: boolean }) {
  const p = paletteFor(healthTier, damaged);
  return (
    <group position={[0, scale * 0.75, 0]} rotation={[0, Math.PI / 6, damaged ? 0.3 : 0]}>
      <mesh castShadow>
        <octahedronGeometry args={[scale * 0.7, 0]} />
        <meshStandardMaterial color={p.mid} emissive={p.trim} emissiveIntensity={0.35} flatShading />
      </mesh>
      <mesh position={[0, scale * 0.55, 0]}>
        <sphereGeometry args={[scale * 0.09, 10, 10]} />
        <meshStandardMaterial color="#EAFFF6" emissive="#EAFFF6" emissiveIntensity={0.8} />
      </mesh>
      {damaged && <CrackDecal scale={scale} color={p.trim} />}
    </group>
  );
}

/** Repository — an archive: a boxy interface building with a ribbed/slatted facade (file cabinets). */
export function ArchiveBuilding({ scale, healthTier, damaged = false }: { scale: number; healthTier: string; damaged?: boolean }) {
  const p = paletteFor(healthTier, damaged);
  const h = 1.1 * scale;
  const slats = [-0.35, -0.15, 0.05, 0.25];
  return (
    <group rotation={damaged ? [0, 0, 0.04] : [0, 0, 0]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[scale * 1.5, h, scale * 1.0]} />
        <meshStandardMaterial color={p.mid} flatShading />
      </mesh>
      <mesh position={[0, h + scale * 0.08, 0]}>
        <boxGeometry args={[scale * 1.6, scale * 0.16, scale * 1.08]} />
        <meshStandardMaterial color={p.deep} />
      </mesh>
      {slats.map((x) => (
        <mesh key={x} position={[x * scale, h * 0.5, scale * 0.51]}>
          <boxGeometry args={[scale * 0.1, h * 0.7, 0.02]} />
          <meshStandardMaterial color={p.deep} />
        </mesh>
      ))}
      {damaged && <CrackDecal scale={scale} color={p.trim} />}
    </group>
  );
}

/** Database — a silo: visible storage infrastructure, capped, glowing at the base. */
export function SiloBuilding({ scale, healthTier, damaged = false }: { scale: number; healthTier: string; damaged?: boolean }) {
  const p = paletteFor(healthTier, damaged);
  const h = 1.3 * scale;
  return (
    <group rotation={damaged ? [0.05, 0, 0.03] : [0, 0, 0]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[scale * 0.55, scale * 0.6, h, 16]} />
        <meshStandardMaterial color={p.mid} />
      </mesh>
      <mesh position={[0, h + scale * 0.06, 0]}>
        <cylinderGeometry args={[scale * 0.4, scale * 0.55, scale * 0.18, 16]} />
        <meshStandardMaterial color={p.light} emissive={p.trim} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[scale * 0.6, scale * 0.85, 24]} />
        <meshBasicMaterial color={p.trim} transparent opacity={0.18} />
      </mesh>
      {damaged && <CrackDecal scale={scale} color={p.trim} />}
    </group>
  );
}

/** External API — a portal: a freestanding glowing ring, a doorway to somewhere else. */
export function PortalBuilding({ scale, healthTier }: { scale: number; healthTier: string }) {
  const p = paletteFor(healthTier, false);
  const glowRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (glowRef.current) {
      const m = glowRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.12 + Math.sin(Date.now() * 0.0009) * 0.05;
    }
  });
  return (
    <group position={[0, scale * 0.9, 0]}>
      <mesh rotation={[0, 0, 0]}>
        <torusGeometry args={[scale * 0.65, scale * 0.08, 10, 24]} />
        <meshStandardMaterial color="#B9C8FF" emissive="#7C9CFF" emissiveIntensity={0.6} />
      </mesh>
      <mesh ref={glowRef}>
        <circleGeometry args={[scale * 0.6, 24]} />
        <meshBasicMaterial color="#7C9CFF" transparent opacity={0.15} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <pointLight color="#7C9CFF" intensity={1.4} distance={scale * 6} />
    </group>
  );
}

/** Event — a slender broadcast tower with a dish, off to the side. */
export function TowerBuilding({ scale, healthTier, damaged = false }: { scale: number; healthTier: string; damaged?: boolean }) {
  const p = paletteFor(healthTier, damaged);
  const h = 1.6 * scale;
  return (
    <group>
      <mesh position={[0, h / 2, 0]}>
        <cylinderGeometry args={[scale * 0.08, scale * 0.14, h, 6]} />
        <meshStandardMaterial color={p.deep} />
      </mesh>
      <mesh position={[0, h * 0.85, 0]} rotation={[0.5, 0, 0]}>
        <circleGeometry args={[scale * 0.28, 16]} />
        <meshStandardMaterial color={p.light} emissive={p.trim} emissiveIntensity={0.4} side={THREE.DoubleSide} />
      </mesh>
      {damaged && <CrackDecal scale={scale} color={p.trim} />}
    </group>
  );
}

/** Middleware — a small checkpoint/booth, branching off the main avenue. */
export function CheckpointBuilding({ scale, healthTier, damaged = false }: { scale: number; healthTier: string; damaged?: boolean }) {
  const p = paletteFor(healthTier, damaged);
  const h = 0.7 * scale;
  return (
    <group rotation={damaged ? [0, 0, 0.06] : [0, 0, 0]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[scale * 0.7, h, scale * 0.7]} />
        <meshStandardMaterial color={p.mid} flatShading />
      </mesh>
      <mesh position={[scale * 0.5, h * 0.75, 0]} rotation={[0, 0, damaged ? Math.PI / 3 : Math.PI / 2.2]}>
        <boxGeometry args={[scale * 0.9, scale * 0.05, scale * 0.05]} />
        <meshStandardMaterial color={p.trim} emissive={p.trim} emissiveIntensity={0.5} />
      </mesh>
      {damaged && <CrackDecal scale={scale} color={p.trim} />}
    </group>
  );
}

/** Generic fallback — a plain, quiet block. Used only for a domain with no recognizable architectural role at all. */
export function GenericBuilding({ scale, healthTier, damaged = false }: { scale: number; healthTier: string; damaged?: boolean }) {
  const p = paletteFor(healthTier, damaged);
  const h = 0.9 * scale;
  return (
    <group rotation={damaged ? [0, 0, 0.05] : [0, 0, 0]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[scale * 0.9, h, scale * 0.9]} />
        <meshStandardMaterial color={p.mid} flatShading />
      </mesh>
      {[0.3, 0.55].map((t) => (
        <mesh key={t} position={[0, h * t, scale * 0.46]}>
          <boxGeometry args={[scale * 0.4, scale * 0.06, 0.02]} />
          <meshStandardMaterial color={p.trim} emissive={p.trim} emissiveIntensity={0.5} />
        </mesh>
      ))}
      {damaged && <CrackDecal scale={scale} color={p.trim} />}
    </group>
  );
}

/** Ruins — a fully deprecated/dead structure: rubble, no glow, no light. */
export function RuinsBuilding({ scale }: { scale: number }) {
  return (
    <group>
      {[0, 0.5, -0.4].map((x, i) => (
        <mesh key={i} position={[x * scale, scale * 0.28, i * 0.2 * scale]} rotation={[0, 0, i * 0.35]}>
          <boxGeometry args={[scale * 0.24, scale * (0.45 + i * 0.14), scale * 0.24]} />
          <meshStandardMaterial color="#4D4C48" />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[scale * 1.0, 20]} />
        <meshBasicMaterial color="#1A1815" transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

/** Training ground (tests) and Library (docs) — module-level classifications kept from the deterministic World Model builder, given the same architectural treatment as everything else. */
export function TrainingGroundBuilding({ scale }: { scale: number }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[scale * 0.7, scale * 0.9, 32]} />
        <meshBasicMaterial color="#3FA672" transparent opacity={0.45} />
      </mesh>
      <mesh position={[-scale * 0.6, scale * 0.4, 0]}>
        <cylinderGeometry args={[0.025, 0.025, scale * 0.8, 6]} />
        <meshStandardMaterial color="#8A9199" />
      </mesh>
      <mesh position={[-scale * 0.48, scale * 0.68, 0]}>
        <coneGeometry args={[scale * 0.16, scale * 0.24, 3]} />
        <meshStandardMaterial color="#4FD1C5" />
      </mesh>
    </group>
  );
}

/**
 * A skyline block — the OVERVIEW-level silhouette (locked reference
 * WorldOverview.dc.html: simple pitched-roof blocks, varying only in
 * height/color, no per-role detail). Role differentiation is reserved for
 * the moment a district is actually entered (`BuildingByRole` below) — at
 * the repository-overview zoom, all that should read is "there's a real
 * skyline here, and this block is the tallest/most important one," not
 * eight tiny gates and crystals nobody can identify from a distance.
 */
export function SkylineBlock({ height, healthTier, isPrimary = false }: { height: number; healthTier: string; isPrimary?: boolean }) {
  const p = paletteFor(healthTier, false);
  const width = 0.34 + height * 0.12;
  const roofHeight = width * 0.55;
  return (
    <group>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[width, height, width]} />
        <meshStandardMaterial color={p.mid} emissive={p.trim} emissiveIntensity={0.15} flatShading />
      </mesh>
      <mesh position={[0, height + roofHeight / 2, 0]}>
        <coneGeometry args={[width * 0.72, roofHeight, 4]} />
        <meshStandardMaterial color={p.deep} flatShading />
      </mesh>
      {isPrimary && (
        <>
          <mesh position={[0, height + roofHeight + 0.1, 0]}>
            <sphereGeometry args={[0.08, 10, 10]} />
            <meshStandardMaterial color="#F2B84B" emissive="#F2B84B" emissiveIntensity={0.9} />
          </mesh>
          <pointLight position={[0, height + roofHeight + 0.15, 0]} color="#F2B84B" intensity={1.1} distance={3} />
        </>
      )}
    </group>
  );
}

/** The shape dispatcher — the ONLY place that maps a role to a component. */
export function BuildingByRole({
  role,
  scale,
  healthTier,
  damaged = false,
  isPrimary = false,
}: {
  role: BuildingRole | "ruins" | "training-ground" | "generic";
  scale: number;
  healthTier: string;
  damaged?: boolean;
  isPrimary?: boolean;
}) {
  switch (role) {
    case "controller":
    case "handler":
    case "entry":
      return <GateBuilding scale={scale} healthTier={healthTier} damaged={damaged} />;
    case "service":
      return <HubBuilding scale={scale} healthTier={healthTier} damaged={damaged} isPrimary={isPrimary} />;
    case "entity":
      return <EntityBuilding scale={scale} healthTier={healthTier} damaged={damaged} />;
    case "repository":
      return <ArchiveBuilding scale={scale} healthTier={healthTier} damaged={damaged} />;
    case "database":
      return <SiloBuilding scale={scale} healthTier={healthTier} damaged={damaged} />;
    case "external-api":
      return <PortalBuilding scale={scale} healthTier={healthTier} />;
    case "event":
      return <TowerBuilding scale={scale} healthTier={healthTier} damaged={damaged} />;
    case "middleware":
      return <CheckpointBuilding scale={scale} healthTier={healthTier} damaged={damaged} />;
    case "ruins":
      return <RuinsBuilding scale={scale} />;
    case "training-ground":
      return <TrainingGroundBuilding scale={scale} />;
    default:
      return <GenericBuilding scale={scale} healthTier={healthTier} damaged={damaged} />;
  }
}

const ROLE_LABEL: Record<string, string> = {
  controller: "entrance",
  handler: "entrance",
  service: "central hub",
  entity: "data boundary",
  repository: "persistence interface",
  database: "infrastructure",
  "external-api": "external",
  event: "event stream",
  middleware: "side branch",
  ruins: "deprecated",
  "training-ground": "tests",
};

export function BuildingLabel({ name, role, position, damaged = false }: { name: string; role: string; position: Vec3; damaged?: boolean }) {
  return (
    <group position={position}>
      <Text position={[0, 0.35, 0]} fontSize={0.26} color={damaged ? "#F4C6BC" : "#F8F6EF"} anchorX="center" anchorY="bottom">
        {name}
      </Text>
      {ROLE_LABEL[role] && (
        <Text position={[0, 0.08, 0]} fontSize={0.15} color={damaged ? "#E0553F" : "#F2B84B"} anchorX="center" anchorY="bottom">
          {ROLE_LABEL[role]}
        </Text>
      )}
    </group>
  );
}
