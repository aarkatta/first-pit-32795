import { Canvas, useFrame } from '@react-three/fiber';
import { Float, RoundedBox, ContactShadows } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';

/*
 * Floating First Pit bricks + a block robot, rendered behind the board preview.
 * Palette only: acid, forest, orange, purple, paper. Lights are flat (no HDR),
 * so nothing needs the network and it runs fine inside the Capacitor web view.
 */

const ACID = '#c8f135';
const FOREST = '#1f392e';
const ORANGE = '#ff6b35';
const PURPLE = '#7759ff';
const PAPER = '#eef1eb';

type Brick = {
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
  color: string;
  speed: number;
};

function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

function useBricks(count: number): Brick[] {
  return useMemo(() => {
    const rand = seeded(7);
    const colors = [ACID, FOREST, ORANGE, PURPLE, ACID, PAPER];
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 + rand() * 0.6;
      const radius = 2.4 + rand() * 1.8;
      const height = (rand() - 0.5) * 4.2;
      const scale = 0.16 + rand() * 0.22;
      return {
        position: [Math.cos(angle) * radius, height, -1.5 - Math.abs(Math.sin(angle)) * 2.5],
        rotation: [rand() * Math.PI, rand() * Math.PI, rand() * Math.PI],
        size: [scale * (1 + rand()), scale, scale * (0.6 + rand() * 0.6)],
        color: colors[index % colors.length],
        speed: 0.6 + rand() * 1.2
      };
    });
  }, [count]);
}

function BrickField() {
  const bricks = useBricks(26);
  const group = useRef<Group>(null);

  useFrame((state, delta) => {
    if (!group.current) return;
    group.current.rotation.y += delta * 0.05;
    const targetX = state.pointer.y * 0.18;
    const targetZ = state.pointer.x * 0.12;
    group.current.rotation.x += (targetX - group.current.rotation.x) * 0.04;
    group.current.rotation.z += (targetZ - group.current.rotation.z) * 0.04;
  });

  return (
    <group ref={group}>
      {bricks.map((brick, index) => (
        <Float key={index} speed={brick.speed} rotationIntensity={0.8} floatIntensity={1.2}>
          <RoundedBox args={brick.size} radius={0.06} smoothness={4} position={brick.position} rotation={brick.rotation}>
            <meshStandardMaterial color={brick.color} roughness={0.55} metalness={0.05} />
          </RoundedBox>
        </Float>
      ))}
    </group>
  );
}

function Robot() {
  const body = useRef<Group>(null);

  useFrame((state) => {
    if (!body.current) return;
    const t = state.clock.elapsedTime;
    body.current.position.y = Math.sin(t * 1.1) * 0.12;
    body.current.rotation.y = Math.sin(t * 0.5) * 0.25 + state.pointer.x * 0.35;
    body.current.rotation.x = -state.pointer.y * 0.15;
  });

  return (
    <group ref={body} position={[0, -0.2, 0]}>
      {/* Head */}
      <RoundedBox args={[2.2, 1.7, 1.4]} radius={0.28} smoothness={6} rotation={[0, 0, -0.06]}>
        <meshStandardMaterial color={ACID} roughness={0.4} />
      </RoundedBox>
      {/* Eyes */}
      <mesh position={[-0.45, 0.2, 0.72]}>
        <sphereGeometry args={[0.17, 24, 24]} />
        <meshStandardMaterial color="#142119" roughness={0.3} />
      </mesh>
      <mesh position={[0.45, 0.2, 0.72]}>
        <sphereGeometry args={[0.17, 24, 24]} />
        <meshStandardMaterial color="#142119" roughness={0.3} />
      </mesh>
      {/* Smile */}
      <mesh position={[0, -0.32, 0.72]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.32, 0.055, 12, 32, Math.PI]} />
        <meshStandardMaterial color="#142119" roughness={0.3} />
      </mesh>
      {/* Antennae */}
      <mesh position={[-0.7, 1.15, 0]} rotation={[0, 0, 0.28]}>
        <cylinderGeometry args={[0.09, 0.09, 0.7, 16]} />
        <meshStandardMaterial color={ACID} roughness={0.4} />
      </mesh>
      <mesh position={[0.7, 1.15, 0]} rotation={[0, 0, -0.28]}>
        <cylinderGeometry args={[0.09, 0.09, 0.7, 16]} />
        <meshStandardMaterial color={ACID} roughness={0.4} />
      </mesh>
      <mesh position={[-0.8, 1.5, 0]}>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshStandardMaterial color={ORANGE} roughness={0.35} />
      </mesh>
      <mesh position={[0.8, 1.5, 0]}>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshStandardMaterial color={PURPLE} roughness={0.35} />
      </mesh>
      {/* Torso base */}
      <RoundedBox args={[1.5, 0.5, 1]} radius={0.12} smoothness={4} position={[0, -1.15, 0]}>
        <meshStandardMaterial color={FOREST} roughness={0.5} />
      </RoundedBox>
    </group>
  );
}

export default function HeroScene() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0.3, 8], fov: 34 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[4, 6, 5]} intensity={1.6} />
      <directionalLight position={[-5, -2, -4]} intensity={0.5} color="#dfe8ff" />
      <Float speed={1.4} rotationIntensity={0.15} floatIntensity={0.6}>
        <Robot />
      </Float>
      <BrickField />
      <ContactShadows position={[0, -2.4, 0]} opacity={0.28} scale={12} blur={2.6} far={4} color="#101d18" />
    </Canvas>
  );
}
