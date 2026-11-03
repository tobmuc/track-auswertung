<script setup lang="ts">
import * as THREE from 'three';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { buildGlider } from '../three/glider';
import type { GliderDesign } from '../three/gliderDesigns';

/** Small turntable view of the selected glider, so colours can be judged before rendering */
const props = defineProps<{ design: GliderDesign }>();
const canvas = ref<HTMLCanvasElement>();
let renderer: THREE.WebGLRenderer | null = null;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 2, 0.5, 200);
let model: THREE.Group | null = null;
let raf = 0;

scene.add(new THREE.HemisphereLight('#ffffff', '#666655', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 2);
sun.position.set(5, 12, 8);
scene.add(sun);

function rebuild() {
  if (model) {
    scene.remove(model);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }
  model = buildGlider({ ...props.design });
  scene.add(model);
}

function frame(ts: number) {
  if (!renderer || !canvas.value) return;
  // seen from above and in front, so the top surface with the pattern shows; slowly swinging
  const a = Math.sin(ts / 2500) * 0.7;
  camera.position.set(Math.sin(a) * 15, 24, Math.cos(a) * 15);
  camera.lookAt(0, 4.5, 0);
  renderer.render(scene, camera);
  raf = requestAnimationFrame(frame);
}

onMounted(() => {
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(canvas.value!.clientWidth, canvas.value!.clientHeight, false);
  rebuild();
  raf = requestAnimationFrame(frame);
});
watch(() => ({ ...props.design }), rebuild);
onUnmounted(() => {
  cancelAnimationFrame(raf);
  renderer?.dispose();
  renderer = null;
});
</script>

<template>
  <canvas ref="canvas" class="glider-preview" />
</template>

<style scoped>
.glider-preview { width: 100%; height: 150px; display: block; border-radius: 8px; background: linear-gradient(#9ec3e6, #dbe9f6); }
</style>
