"use client";

import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { Vec3 } from "@/lib/worldLayout";
import type { Domain } from "@/world-engine/domains";

/**
 * ONE continuous landmass (product brief §4: "Do NOT use separate floating
 * circular islands for each domain... they should visually belong to one
 * connected world"). An organic, non-circular blob (deterministic per-angle
 * radius jitter, seeded so it's stable across renders — never random per
 * frame) sized to contain every district position with margin. Districts
 * are flat color zones painted ON this ground (§4: "do not make domain
 * elevation the primary encoding of importance") — never separate meshes
 * with their own floating edge.
 */

function seededJitter(seed: number, angle: number): number {
  return 0.85 + 0.16 * (Math.sin(angle * 3.1 + seed) * 0.5 + Math.sin(angle * 7.3 + seed * 2.7) * 0.3 + Math.sin(angle * 1.7 + seed * 5.1) * 0.2);
}

export function landmassOutline(extent: number, seed: number, segments = 48): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const r = extent * seededJitter(seed, angle);
    points.push([Math.cos(angle) * r, 0, Math.sin(angle) * r]);
  }
  return points;
}

function groundTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#182B20";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(63,166,114,0.10)";
  ctx.lineWidth = 1;
  const step = 32;
  for (let x = 0; x <= size; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = 0; y <= size; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** The one shared ground mesh every district sits on. */
export function Landmass({ extent, seed }: { extent: number; seed: number }) {
  const map = useMemo(() => groundTexture(), []);
  const geometry = useMemo(() => {
    const outline = landmassOutline(extent, seed);
    const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p[0], p[2])));
    const geo = new THREE.ShapeGeometry(shape, 1);
    geo.rotateX(-Math.PI / 2);
    // UVs from world-space XZ so the tiled texture reads at a consistent scale regardless of blob size.
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / 8;
      uv[i * 2 + 1] = pos.getZ(i) / 8;
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    return geo;
  }, [extent, seed]);
  const outlinePoints = useMemo(() => landmassOutline(extent, seed), [extent, seed]);

  return (
    <group>
      <mesh geometry={geometry} receiveShadow position={[0, -0.02, 0]}>
        <meshStandardMaterial map={map} roughness={0.92} />
      </mesh>
      <Line points={[...outlinePoints, outlinePoints[0]]} color="#2E3A32" transparent opacity={0.7} lineWidth={1.2} />
    </group>
  );
}

function radialAlphaTexture(color: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.72, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const ZONE_COLOR: Record<string, string> = {
  thriving: "rgba(27,90,65,0.85)",
  healthy: "rgba(27,90,65,0.85)",
  stressed: "rgba(92,74,34,0.85)",
  critical: "rgba(74,32,25,0.85)",
};
const INFRA_ZONE_COLOR = "rgba(37,49,58,0.85)";

/** A district's ground zone — a soft-edged color wash on the shared landmass, never a separate elevated disc. Its own boundary ring stays visible so district edges read clearly even though the ground itself is continuous. */
export function DistrictZone({
  domain,
  radius,
  position,
  selected,
  hovered,
  dimmed,
  onSelect,
  onHover,
}: {
  domain: Domain;
  radius: number;
  position: Vec3;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
  onSelect: () => void;
  onHover: (v: boolean) => void;
}) {
  const color = domain.isInfra ? INFRA_ZONE_COLOR : ZONE_COLOR[domain.healthTier] ?? ZONE_COLOR.healthy;
  const map = useMemo(() => radialAlphaTexture(color), [color]);
  const edgeColor = domain.isInfra ? "#5E7A9E" : domain.healthTier === "critical" ? "#E0553F" : "#4FD1C5";

  return (
    <group
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        onHover(false);
        document.body.style.cursor = "auto";
      }}
    >
      {/* Once a domain is entered, every OTHER district recedes to a quiet
          silhouette — barely present — so the scene reads as "one place
          I'm standing in, with a city in the distance," not a field of
          equally-weighted nodes. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[radius, 32]} />
        <meshBasicMaterial map={map} transparent opacity={dimmed ? 0.12 : 1} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <ringGeometry args={[radius * 0.96, radius, 40]} />
        <meshBasicMaterial color={edgeColor} transparent opacity={dimmed ? 0.1 : selected || hovered ? 0.9 : 0.5} />
      </mesh>
      {domain.hasRisk && <RiskCracks radius={radius} dimmed={dimmed} />}
    </group>
  );
}

/** Ground cracks — the structural (not just red-ring) risk signal on a district's own terrain. */
function RiskCracks({ radius, dimmed }: { radius: number; dimmed: boolean }) {
  const seed = radius * 13.7;
  const branch = (cx: number, cz: number, angle: number, len: number, depth: number): Vec3[] => {
    const pts: Vec3[] = [[cx, 0.03, cz]];
    let x = cx;
    let z = cz;
    let a = angle;
    for (let i = 0; i < depth; i++) {
      a += Math.sin(seed + i) * 0.5;
      x += Math.cos(a) * len;
      z += Math.sin(a) * len;
      pts.push([x, 0.03, z]);
    }
    return pts;
  };
  const lines = [branch(0, 0, seed, radius * 0.18, 4), branch(radius * 0.1, -radius * 0.1, seed + 2, radius * 0.15, 3)];
  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#E0553F" transparent opacity={dimmed ? 0.2 : 0.65} lineWidth={1.4} />
      ))}
    </>
  );
}

/**
 * The plaza — a real raised deck under the application tier (entrance/hub/
 * entity, at grade), the hub built at its center. A distinct octagonal
 * platform with its own ground treatment, not implied by the surrounding
 * district color alone (locked reference WorldDomain.dc.html: "the plaza
 * is built around the hub").
 */
/** The plaza deck's own height — exported so buildings placed on it (WorldView.tsx) stand on its real surface instead of floating just above or sinking slightly into it. */
export const PLAZA_HEIGHT = 0.4;

export function Plaza({ center, radius, healthTier }: { center: Vec3; radius: number; healthTier: string }) {
  const color = healthTier === "critical" ? "#3A1712" : healthTier === "stressed" ? "#3A3320" : "#245E48";
  const edgeColor = healthTier === "critical" ? "#E0553F" : "#4FD1C5";
  const sides = 8;
  const height = PLAZA_HEIGHT;

  // Radiating spokes from the hub at center to each of the plaza's 8
  // vertices — "the plaza is built AROUND the hub" as a visible structural
  // fact, not just a color implying it (locked reference WorldDomain.dc.html).
  const spokes = useMemo(() => {
    const lines: Vec3[][] = [];
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2;
      lines.push([
        [0, height + 0.02, 0],
        [Math.cos(angle) * radius * 0.94, height + 0.02, Math.sin(angle) * radius * 0.94],
      ]);
    }
    return lines;
  }, [radius, height]);

  return (
    <group position={center}>
      <mesh position={[0, height / 2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[radius, radius * 1.04, height, sides]} />
        <meshStandardMaterial color={color} flatShading />
      </mesh>
      <mesh position={[0, height + 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.96, radius, sides]} />
        <meshBasicMaterial color={edgeColor} transparent opacity={0.75} />
      </mesh>
      {spokes.map((pts, i) => (
        <Line key={i} points={pts} color={edgeColor} transparent opacity={0.3} lineWidth={1} />
      ))}
    </group>
  );
}

/**
 * The persistence yard — a real, recessed lower level a domain's
 * repository/database structures sit in, separated from the application
 * plaza by a retaining wall with a ramp cut through it (product brief §8:
 * "entrance -> application hub -> data boundary -> persistence interface ->
 * infrastructure", locked reference WorldDomain.dc.html). Purely geometric
 * (box/cylinder primitives) — no sculpting — but the elevation drop and
 * the physical wall are real, not implied by color alone.
 */
export function PersistenceYard({
  center,
  wallCenter,
  facingAngle,
  width,
  depth,
  drop,
}: {
  /** Center of the sunken yard floor. */
  center: Vec3;
  /** Where the wall/ramp sits, between the plaza and the yard. */
  wallCenter: Vec3;
  /** Direction (radians) the wall faces, away from the plaza. */
  facingAngle: number;
  width: number;
  depth: number;
  drop: number;
}) {
  const wallThickness = 0.4;
  const rampWidth = width * 0.32;

  return (
    <group>
      {/* sunken floor */}
      <mesh position={[center[0], -drop / 2, center[2]]} receiveShadow>
        <boxGeometry args={[width, drop, depth]} />
        <meshStandardMaterial color="#081F16" />
      </mesh>
      <mesh position={[center[0], -drop + 0.02, center[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width * 0.94, depth * 0.94]} />
        <meshStandardMaterial color="#0F3324" />
      </mesh>
      {/* the retaining wall, facing the plaza */}
      <mesh position={[wallCenter[0], -drop / 2, wallCenter[2]]} rotation={[0, facingAngle, 0]} castShadow>
        <boxGeometry args={[width * 1.05, drop, wallThickness]} />
        <meshStandardMaterial color="#0F3324" />
      </mesh>
      <mesh position={[wallCenter[0], 0.03, wallCenter[2]]} rotation={[0, facingAngle, 0]}>
        <boxGeometry args={[width * 1.05, 0.04, wallThickness + 0.05]} />
        <meshStandardMaterial color="#4FD1C5" emissive="#4FD1C5" emissiveIntensity={0.4} transparent opacity={0.6} />
      </mesh>
      {/* the ramp cut through the wall */}
      <mesh
        position={[wallCenter[0] + Math.sin(facingAngle) * 0, -drop / 2, wallCenter[2]]}
        rotation={[Math.atan2(drop, depth * 0.6), facingAngle, 0]}
      >
        <boxGeometry args={[rampWidth, 0.15, depth * 0.75]} />
        <meshStandardMaterial color="#2E7A54" />
      </mesh>
    </group>
  );
}

/** Reads the renderer's DPR so callers can cap expensive effects on constrained devices — used sparingly. */
export function useIsLowPower(): boolean {
  const { gl } = useThree();
  return gl.getPixelRatio() < 1.5 && typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent);
}
