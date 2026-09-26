"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const SPEED = 6;

function useKeyboardState() {
  const keys = useRef<Set<string>>(new Set());
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current.add(e.key.toLowerCase());
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  return keys;
}

/**
 * A stylized low-poly explorer. Movement is a simple, constrained
 * world-axis walk (WASD / arrow keys) rather than full free-form 3D
 * navigation — smooth and predictable beats a sophisticated character
 * controller for this vertical slice (Step 5).
 */
export function Avatar({
  positionRef,
  bounds,
  disabled,
}: {
  positionRef: React.MutableRefObject<THREE.Vector3>;
  bounds: number;
  disabled: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const keys = useKeyboardState();
  const bob = useRef(0);

  useFrame((_, delta) => {
    if (!disabled) {
      let dx = 0;
      let dz = 0;
      if (keys.current.has("w") || keys.current.has("arrowup")) dz -= 1;
      if (keys.current.has("s") || keys.current.has("arrowdown")) dz += 1;
      if (keys.current.has("a") || keys.current.has("arrowleft")) dx -= 1;
      if (keys.current.has("d") || keys.current.has("arrowright")) dx += 1;

      if (dx !== 0 || dz !== 0) {
        const len = Math.hypot(dx, dz);
        const pos = positionRef.current;
        pos.x = THREE.MathUtils.clamp(pos.x + (dx / len) * SPEED * delta, -bounds, bounds);
        pos.z = THREE.MathUtils.clamp(pos.z + (dz / len) * SPEED * delta, -bounds, bounds);
        bob.current += delta * 10;
      }
    }

    if (groupRef.current) {
      groupRef.current.position.set(positionRef.current.x, Math.sin(bob.current) * 0.05, positionRef.current.z);
    }
    if (ringRef.current) {
      const s = 1 + Math.sin(Date.now() * 0.002) * 0.08;
      ringRef.current.scale.set(s, 1, s);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.42, 0.52, 32]} />
        <meshBasicMaterial color="#4FD1C5" transparent opacity={0.55} />
      </mesh>
      <mesh position={[0, 0.55, 0]} castShadow>
        <capsuleGeometry args={[0.24, 0.5, 4, 8]} />
        <meshStandardMaterial color="#E3DACC" />
      </mesh>
      <mesh position={[0, 0.62, 0.2]}>
        <boxGeometry args={[0.5, 0.16, 0.05]} />
        <meshStandardMaterial color="#4FD1C5" emissive="#4FD1C5" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0, 1.02, 0]} castShadow>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color="#F3F1EA" />
      </mesh>
    </group>
  );
}
