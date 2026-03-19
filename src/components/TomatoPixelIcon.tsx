"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

interface TomatoPixelIconProps {
    size?: number;
    speed?: number;
    glow?: number;
    className?: string;
}

function makeToonGradient(): THREE.DataTexture {
    const data = new Uint8Array([45, 148, 238]);
    const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
}

function getInternalRes(size: number): number {
    if (size <= 14) return size;
    if (size <= 24) return 16;
    if (size <= 36) return 20;
    if (size <= 56) return 22;
    if (size <= 80) return 26;
    if (size <= 100) return 32;
    return 40;
}

function buildPixelTomato(gradMap: THREE.DataTexture): THREE.Group {
    const group = new THREE.Group();

    const bodyGeo = new THREE.SphereGeometry(0.72, 28, 18);
    const pos = bodyGeo.attributes.position as THREE.BufferAttribute;
    const NUM_LOBES = 5;

    for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        let y = pos.getY(i);
        let z = pos.getZ(i);

        y *= 0.86;

        const longitude = Math.atan2(z, x);
        const yNorm = y / 0.72;
        const poleFade = Math.max(0, 1 - yNorm * yNorm * 1.4);
        const lobe = Math.cos(longitude * NUM_LOBES) * 0.10 * poleFade;
        x *= (1 + lobe);
        z *= (1 + lobe);

        const bottomPull = Math.max(0, -yNorm - 0.55) * 0.4;
        x *= (1 - bottomPull);
        z *= (1 - bottomPull);

        pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    bodyGeo.computeVertexNormals();

    group.add(new THREE.Mesh(bodyGeo, new THREE.MeshToonMaterial({
        color: 0xff3a1a,
        gradientMap: gradMap,
    })));

    const hlMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xffcfc0, transparent: true, opacity: 0.72 })
    );
    hlMesh.scale.set(0.155, 0.115, 0.055);
    hlMesh.position.set(-0.36, 0.28, 0.54);
    group.add(hlMesh);

    // Stalk — taller, thicker, brighter green, more sides for roundness
    const stemMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.12, 0.58, 8, 1),
        new THREE.MeshToonMaterial({ color: 0x2e8b1a, gradientMap: gradMap })
    );
    stemMesh.position.set(0.07, 0.90, 0);
    stemMesh.rotation.z = 0.16;
    group.add(stemMesh);

    // Calyx collar — a flat disc where the stalk meets the body
    const collarMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.28, 0.06, 10, 1),
        new THREE.MeshToonMaterial({ color: 0x3aad20, gradientMap: gradMap })
    );
    collarMesh.position.set(0.04, 0.68, 0);
    group.add(collarMesh);

    // Sepals — wider, longer, more spread out
    const sepalMat = new THREE.MeshToonMaterial({
        color: 0x3aad20,
        gradientMap: gradMap,
        side: THREE.DoubleSide,
    });
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.54), sepalMat);
        mesh.position.set(Math.cos(a) * 0.28, 0.66, Math.sin(a) * 0.28);
        mesh.rotation.y = -a;
        mesh.rotation.z = 0.50;
        group.add(mesh);
    }

    group.rotation.x = -0.20;
    return group;
}

export function TomatoPixelIcon({ size = 16, speed = 1.0, glow = 1.0, className }: TomatoPixelIconProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const live = useRef({ speed, glow, hovered: false, frame: 0 });

    function applyGlow(container: HTMLDivElement, glowVal: number, hovered: boolean) {
        const b = Math.round(glowVal * (hovered ? 10 : 4));
        container.style.filter = b > 0
            ? `drop-shadow(0 0 ${b}px rgba(255,58,26,.9)) drop-shadow(0 0 ${Math.round(b * 1.8)}px rgba(255,80,40,.4))`
            : "";
    }

    useEffect(() => {
        live.current.speed = speed;
    }, [speed]);

    useEffect(() => {
        live.current.glow = glow;
        if (containerRef.current) applyGlow(containerRef.current, glow, live.current.hovered);
    }, [glow]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const res = getInternalRes(size);

        const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
        renderer.setSize(res, res);
        renderer.setPixelRatio(1);
        renderer.setClearColor(0x000000, 0);

        const cv = renderer.domElement;
        cv.style.cssText = `width:${size}px;height:${size}px;display:block;image-rendering:pixelated;pointer-events:none;`;
        container.appendChild(cv);

        const scene = new THREE.Scene();
        const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
        cam.position.set(0, 0.45, 3.0);
        cam.lookAt(0, 0.18, 0);

        scene.add(new THREE.AmbientLight(0xffffff, 0.38));
        const key = new THREE.DirectionalLight(0xffffff, 1.05);
        key.position.set(2.0, 3.0, 2.5);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0x330800, 0.35);
        fill.position.set(-1.5, -1, -1);
        scene.add(fill);

        const gradMap = makeToonGradient();
        const group = buildPixelTomato(gradMap);
        scene.add(group);

        let animId: number;
        let frame = 0;
        let visible = true;

        function loop() {
            animId = requestAnimationFrame(loop);
            if (!visible) return;
            frame++;
            const spd = live.current.speed * (live.current.hovered ? 2.2 : 1.0);
            group.rotation.y += 0.022 * spd;
            group.position.y = Math.sin(frame * 0.022) * 0.038;
            renderer.render(scene, cam);
        }

        loop();

        const observer = new IntersectionObserver(
            ([entry]) => { visible = entry.isIntersecting; },
            { threshold: 0 }
        );
        observer.observe(container);

        applyGlow(container, live.current.glow, false);

        const onEnter = () => { live.current.hovered = true;  applyGlow(container, live.current.glow, true); };
        const onLeave = () => { live.current.hovered = false; applyGlow(container, live.current.glow, false); };
        container.addEventListener("mouseenter", onEnter);
        container.addEventListener("mouseleave", onLeave);

        return () => {
            cancelAnimationFrame(animId);
            observer.disconnect();
            container.removeEventListener("mouseenter", onEnter);
            container.removeEventListener("mouseleave", onLeave);
            if (cv.parentNode) cv.parentNode.removeChild(cv);
            gradMap.dispose();
            renderer.dispose();
        };
    }, [size]);

    return (
        <div
            ref={containerRef}
            className={className}
            style={{ width: size, height: size, display: "inline-flex", flexShrink: 0 }}
            aria-label="Pomodoro"
            title="Pomodoro"
        />
    );
}
