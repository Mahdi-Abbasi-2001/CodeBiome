"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Vec3 } from "@/lib/worldLayout";

/**
 * Bob, rendered as a small periwinkle guide orb that physically travels
 * through the world to whatever landmark it is currently investigating
 * (product brief: "Bob is not merely a chat panel... Bob should physically
 * move through the architecture"). `targetPosition` is driven entirely by
 * the SAME state WorldExperience already derives from real MCP tool calls
 * and the active Flow/Onboarding walkthrough step — this component invents
 * no position and no activity of its own; it only interpolates toward
 * wherever the rest of the app says Bob is looking.
 */
export function Bob({ targetPosition, active }: { targetPosition: Vec3 | null; active: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const current = useRef(new THREE.Vector3(0, 2.4, 0));
  const initialized = useRef(false);
  const bob = useRef(0);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (targetPosition) {
      const target = new THREE.Vector3(targetPosition[0], targetPosition[1] + 2.2, targetPosition[2]);
      if (!initialized.current) {
        current.current.copy(target);
        initialized.current = true;
      } else {
        current.current.lerp(target, Math.min(1, delta * 2.4));
      }
    }
    bob.current += delta * 2.2;
    if (groupRef.current) {
      groupRef.current.position.set(current.current.x, current.current.y + Math.sin(bob.current) * 0.14, current.current.z);
      groupRef.current.visible = active;
    }
    if (glowRef.current) {
      const material = glowRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.14 + Math.sin(Date.now() * 0.0025) * 0.05;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[0.22, 20, 20]} />
        <meshStandardMaterial color="#7C9CFF" emissive="#7C9CFF" emissiveIntensity={0.9} />
      </mesh>
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.42, 16, 16]} />
        <meshBasicMaterial color="#B9C8FF" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <pointLight color="#7C9CFF" intensity={1.3} distance={6} />
    </group>
  );
}
