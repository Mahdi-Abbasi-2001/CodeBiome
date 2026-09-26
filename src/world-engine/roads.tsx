"use client";

import { useMemo } from "react";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { Vec3 } from "@/lib/worldLayout";

/**
 * Dependencies as physical roads (product brief §10/§11/§12): a real
 * paved-surface mesh with visible width — not a thin line floating in
 * space. Built as a ribbon (a triangle strip offset perpendicular to the
 * path at every sample point), so width genuinely varies with `weight`
 * ("stronger coupling = wider road") rather than relying on a stylistic
 * line-width hack.
 */

function ribbonGeometry(points: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dir = new THREE.Vector3().subVectors(next, prev).normalize();
    const side = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(width / 2);
    const p = points[i];
    positions.push(p.x + side.x, p.y, p.z + side.z, p.x - side.x, p.y, p.z - side.z);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function sampleCurve(from: Vec3, to: Vec3, arcHeight: number, segments = 20): THREE.Vector3[] {
  const mid: Vec3 = [(from[0] + to[0]) / 2, arcHeight, (from[2] + to[2]) / 2];
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(from[0], 0.03, from[2]),
    new THREE.Vector3(...mid),
    new THREE.Vector3(to[0], 0.03, to[2])
  );
  return curve.getPoints(segments);
}

/**
 * One road/bridge between two real structures. `kind: "road"` hugs the
 * ground within a district; `kind: "bridge"` arcs over a real gap between
 * two different districts, with pylons planted at each end. A `cyclic`
 * (bidirectional) dependency becomes a divided carriageway — two parallel
 * lanes, a real structural property of the road, not a decorative loop.
 */
export function RoadRibbon({
  kind,
  from,
  to,
  cyclic,
  confidence,
  weight = 0.4,
  highlighted,
  dimmed,
}: {
  kind: "road" | "bridge";
  from: Vec3;
  to: Vec3;
  cyclic: boolean;
  confidence: number;
  weight?: number;
  highlighted: boolean;
  dimmed: boolean;
}) {
  const isBridge = kind === "bridge";
  const arcHeight = isBridge ? 1.8 : 0.03;
  const baseWidth = isBridge ? 0.9 + weight * 0.9 : 0.35 + weight * 0.55;
  const laneOffset = cyclic ? baseWidth * 0.65 : 0;

  const { points, leftPoints, rightPoints } = useMemo(() => {
    if (!cyclic) {
      return { points: sampleCurve(from, to, arcHeight), leftPoints: null, rightPoints: null };
    }
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3(to[0] - from[0], 0, to[2] - from[2]).normalize();
    const side = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(laneOffset);
    const fromL: Vec3 = [from[0] + side.x, from[1], from[2] + side.z];
    const toL: Vec3 = [to[0] + side.x, to[1], to[2] + side.z];
    const fromR: Vec3 = [from[0] - side.x, from[1], from[2] - side.z];
    const toR: Vec3 = [to[0] - side.x, to[1], to[2] - side.z];
    return {
      points: null,
      leftPoints: sampleCurve(fromL, toL, arcHeight),
      rightPoints: sampleCurve(fromR, toR, arcHeight),
    };
  }, [from, to, cyclic, arcHeight, laneOffset]);

  // A bridge is a real, physically legible structure — a lit concrete/steel
  // deck with railings, not a dark ribbon whose only visible trace is a
  // bright dashed accent line (that reads as a graph edge). A local road
  // stays dark asphalt with a lane-marking accent, since it's seen up close
  // within one district. `dimmed` goes nearly to zero (not just "faded") so
  // an unrelated bridge genuinely recedes rather than remaining a crisp
  // line drawn across the frame.
  const baseColor = isBridge ? "#4A5560" : "#1B2420";
  const laneColor = isBridge ? "#DCE3FF" : "#4FD1C5";
  const surfaceOpacity = (dimmed ? 0.05 : highlighted ? 1 : isBridge ? 0.85 : 0.55) * (0.5 + 0.5 * confidence);
  const laneOpacity = isBridge ? surfaceOpacity * 0.5 : surfaceOpacity;
  const laneWidth = isBridge ? 0.8 : 1.4;

  const surfaces = cyclic ? [leftPoints!, rightPoints!] : [points!];

  return (
    <group>
      {surfaces.map((pts, i) => {
        const geometry = ribbonGeometry(pts, baseWidth);
        const railGeomLeft = isBridge ? ribbonGeometry(pts.map((p) => new THREE.Vector3(p.x, p.y + 0.14, p.z)), 0.05) : null;
        return (
          <group key={i}>
            <mesh geometry={geometry} castShadow receiveShadow>
              <meshStandardMaterial color={baseColor} roughness={0.7} metalness={isBridge ? 0.2 : 0} transparent opacity={surfaceOpacity} />
            </mesh>
            {isBridge && railGeomLeft && (
              <mesh geometry={railGeomLeft}>
                <meshStandardMaterial color="#7C9CFF" emissive="#7C9CFF" emissiveIntensity={0.4} transparent opacity={surfaceOpacity} />
              </mesh>
            )}
            <Line
              points={pts.map((p) => [p.x, p.y + 0.015, p.z] as Vec3)}
              color={laneColor}
              lineWidth={laneWidth}
              transparent
              opacity={laneOpacity}
              dashed={!isBridge}
              dashSize={0.25}
              gapSize={0.18}
            />
          </group>
        );
      })}
      {isBridge && (
        <>
          <mesh position={[from[0], arcHeight * 0.35, from[2]]}>
            <cylinderGeometry args={[0.14, 0.2, arcHeight * 0.7, 8]} />
            <meshStandardMaterial color="#2A333D" transparent opacity={surfaceOpacity} />
          </mesh>
          <mesh position={[to[0], arcHeight * 0.35, to[2]]}>
            <cylinderGeometry args={[0.14, 0.2, arcHeight * 0.7, 8]} />
            <meshStandardMaterial color="#2A333D" transparent opacity={surfaceOpacity} />
          </mesh>
        </>
      )}
    </group>
  );
}

/** The Flow/Onboarding lens route: the SAME road geometry, relit — a brighter, wider glowing overlay riding on top of the existing road surface, never a second/approximate path. */
export function LitRoute({ points, color = "#4FD1C5" }: { points: Vec3[]; color?: string }) {
  const raised = points.map((p) => [p[0], p[1] + 0.04, p[2]] as Vec3);
  return (
    <>
      <Line points={raised} color={color} lineWidth={5} transparent opacity={0.9} />
      <Line points={raised.map((p) => [p[0], p[1] + 0.01, p[2]] as Vec3)} color="#EAFBF8" lineWidth={1.6} transparent opacity={0.85} dashed dashSize={0.22} gapSize={0.16} />
    </>
  );
}
