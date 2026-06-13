// Three.js flight-replay scene (design_doc §4.4). Framework-agnostic class the
// Svelte component drives: build once from a FlightPath, then update the
// aircraft + camera each cursor tick. Coordinates: ENU → Three (X=East,
// Y=up/altitude, Z=South so North is -Z, right-handed).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FlightPath } from '../geo/project';
import { PHASE_ORDER } from '../model/types';
import { PHASE_COLORS } from '../util/phaseColors';

export type CameraMode = 'orbit' | 'chase' | 'top';

const ALT_SCALE = 1; // metres → world units (1:1)

export class ReplayScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private aircraft: THREE.Group;
  private path: FlightPath;
  private mode: CameraMode = 'orbit';
  private raf = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, path: FlightPath) {
    this.path = path;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene.background = new THREE.Color('#0b0f17');

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100000);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    // lighting
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1, 2, 1);
    this.scene.add(dir);

    this.buildGround();
    this.buildPathLine();
    this.aircraft = this.buildAircraft();
    this.scene.add(this.aircraft);

    // frame the whole path
    this.fitView();
    this.start();
  }

  // ENU(e,n,up) → world(x,y,z)
  private toWorld(e: number, n: number, up: number): THREE.Vector3 {
    return new THREE.Vector3(e, up * ALT_SCALE, -n);
  }

  private buildGround() {
    const b = this.path.bounds;
    const spanE = Math.max(50, b.maxE - b.minE);
    const spanN = Math.max(50, b.maxN - b.minN);
    const size = Math.max(spanE, spanN) * 1.5;
    const divisions = 20;
    const grid = new THREE.GridHelper(size, divisions, 0x334155, 0x1e293b);
    // center grid under the path
    grid.position.set((b.minE + b.maxE) / 2, 0, -(b.minN + b.maxN) / 2);
    this.scene.add(grid);
  }

  private buildPathLine() {
    const pts = this.path.points;
    // one line segment per pair, colored by phase (vertex colors)
    const positions = new Float32Array(pts.length * 3);
    const colors = new Float32Array(pts.length * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pts.length; i++) {
      const w = this.toWorld(pts[i].e, pts[i].n, pts[i].up);
      positions[i * 3] = w.x; positions[i * 3 + 1] = w.y; positions[i * 3 + 2] = w.z;
      const ph = pts[i].phase;
      c.set(ph >= 0 ? PHASE_COLORS[PHASE_ORDER[ph]] : '#64748b');
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true });
    this.scene.add(new THREE.Line(geom, mat));

    // takeoff marker
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(1, this.sceneScale() * 0.01), 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xe6edf3 }),
    );
    marker.position.copy(this.toWorld(pts[0].e, pts[0].n, pts[0].up));
    this.scene.add(marker);
  }

  private sceneScale(): number {
    const b = this.path.bounds;
    return Math.max(50, b.maxE - b.minE, b.maxN - b.minN, b.maxUp - b.minUp);
  }

  private buildAircraft(): THREE.Group {
    const g = new THREE.Group();
    const s = Math.max(2, this.sceneScale() * 0.02);
    // a cone pointing +Z (we'll orient via heading); nose forward
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(s * 0.4, s * 1.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8 }),
    );
    body.rotation.x = Math.PI / 2; // cone's +Y → +Z (forward)
    g.add(body);
    // small wing bar
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(s * 1.6, s * 0.1, s * 0.4),
      new THREE.MeshStandardMaterial({ color: 0xe6edf3 }),
    );
    g.add(wing);
    return g;
  }

  private fitView() {
    const b = this.path.bounds;
    const cx = (b.minE + b.maxE) / 2;
    const cz = -(b.minN + b.maxN) / 2;
    const cy = (b.minUp + b.maxUp) / 2;
    const r = this.sceneScale();
    this.controls.target.set(cx, cy, cz);
    this.camera.position.set(cx + r * 0.8, cy + r * 0.8, cz + r * 0.8);
    this.controls.update();
  }

  setMode(mode: CameraMode) {
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    if (mode === 'orbit') this.fitView();
  }

  /** Update aircraft position/orientation to the path point at index i. */
  update(i: number) {
    const pts = this.path.points;
    if (i < 0 || i >= pts.length) return;
    const p = pts[i];
    const pos = this.toWorld(p.e, p.n, p.up);
    this.aircraft.position.copy(pos);

    // heading from GPS course (0°=North=-Z, 90°=East=+X)
    const hd = (p.course * Math.PI) / 180;
    // pitch estimate from climb between neighbors
    let pitch = 0;
    if (i > 0) {
      const prev = pts[i - 1];
      const dUp = p.up - prev.up;
      const dHoriz = Math.hypot(p.e - prev.e, p.n - prev.n) || 1;
      pitch = Math.atan2(dUp, dHoriz);
    }
    // build orientation: yaw around Y by heading, then pitch
    const q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(pitch, hd, 0, 'YXZ'));
    this.aircraft.quaternion.copy(q);

    // camera follow modes
    const scale = this.sceneScale();
    if (this.mode === 'chase') {
      const back = new THREE.Vector3(-Math.sin(hd), 0, Math.cos(hd)).multiplyScalar(scale * 0.15);
      const cam = pos.clone().add(back).add(new THREE.Vector3(0, scale * 0.06, 0));
      this.camera.position.lerp(cam, 0.2);
      this.camera.lookAt(pos);
    } else if (this.mode === 'top') {
      this.camera.position.set(pos.x, pos.y + scale * 0.9, pos.z + 0.01);
      this.camera.up.set(0, 0, -1);
      this.camera.lookAt(pos);
    }
  }

  private start() {
    const loop = () => {
      if (this.disposed) return;
      if (this.mode === 'orbit') this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    });
  }
}
