// 3D viewer: STL part, voxel result fields (stress / topology), boundary markers, process animations.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

// turbo colormap (polynomial approximation), t in [0,1]
export function turbo(t) {
  t = Math.min(1, Math.max(0, t));
  const r = 0.13572 + t * (4.6154 + t * (-42.6603 + t * (132.1311 + t * (-152.9424 + t * 59.2864))));
  const g = 0.09140 + t * (2.1942 + t * (4.8430 + t * (-14.1850 + t * (4.2773 + t * 2.8296))));
  const b = 0.10667 + t * (12.6419 + t * (-60.5820 + t * (110.3628 + t * (-89.9031 + t * 27.3482))));
  return new THREE.Color(Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b)));
}

function cellPos(grid, idx, out) {
  const [, ny, nz] = grid.shape, p = grid.pitch, o = grid.origin;
  const i = Math.floor(idx / (ny * nz)), j = Math.floor(idx / nz) % ny, k = idx % nz;
  return out.set(o[0] + (i + 0.5) * p, o[1] + (j + 0.5) * p, o[2] + (k + 0.5) * p);
}

export class Viewer {
  constructor(el) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.prepend(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1e5);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(1, -2, 3); this.scene.add(d);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.layers = {};
    this.onPick = null;
    new ResizeObserver(() => this.resize()).observe(el);
    this.renderer.domElement.addEventListener("click", (e) => this._click(e));
    this.resize();
    const loop = () => { requestAnimationFrame(loop); this._tick?.(); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  clear(name) { if (this.layers[name]) { this.group.remove(this.layers[name]); this.layers[name] = null; } }
  show(name, on) { if (this.layers[name]) this.layers[name].visible = on; }
  async loadSTL(url) {
    const buf = await (await fetch(url)).arrayBuffer();
    const geo = new STLLoader().parse(buf); geo.computeVertexNormals();
    this.clear("mesh");
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb8c2cc, metalness: 0.35, roughness: 0.55, transparent: true, opacity: 1 }));
    this.layers.mesh = mesh; this.group.add(mesh);
    geo.computeBoundingBox(); this.bbox = geo.boundingBox; this.fit();
    return mesh;
  }
  fit() {
    const b = this.bbox, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(new THREE.Vector3(0.9, -1.3, 0.8).multiplyScalar(s));
    this.camera.near = s / 100; this.camera.far = s * 50; this.camera.updateProjectionMatrix();
    this.size = s;
  }
  meshOpacity(a) { const m = this.layers.mesh; if (m) { m.material.opacity = a; m.material.depthWrite = a > 0.9; } }

  // voxel set (grid payload from the server); colorFn(val, bc) -> THREE.Color
  voxels(name, grid, colorFn, order = null) {
    this.clear(name);
    const idx = order || grid.idx, n = idx.length;
    const geo = new THREE.BoxGeometry(grid.pitch * 0.96, grid.pitch * 0.96, grid.pitch * 0.96);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), n);
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      m.makeTranslation(cellPos(grid, idx[i], v)); mesh.setMatrixAt(i, m);
      if (colorFn) mesh.setColorAt(i, colorFn(grid.val ? grid.val[i] : 0, grid.bc ? grid.bc[i] : 0, i));
    }
    this.layers[name] = mesh; this.group.add(mesh);
    return mesh;
  }
  stress(grid) {
    return this.voxels("field", grid, (v, bc) => bc === 1 ? new THREE.Color(0x2b6cb0) : turbo(v / 255));
  }
  markers(fixedC, loadC, force) {
    this.clear("markers");
    const g = new THREE.Group(), r = this.size / 45;
    const ball = (c, col) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: col })); s.position.set(...c); g.add(s); };
    if (fixedC) ball(fixedC, 0x2b6cb0);
    if (loadC) {
      ball(loadC, 0xd9342b);
      if (force) {
        const f = new THREE.Vector3(...force);
        if (f.length() > 0) {
          const L = this.size / 4, dir = f.clone().normalize();
          const from = new THREE.Vector3(...loadC).addScaledVector(dir, -L);
          g.add(new THREE.ArrowHelper(dir, from, L, 0xd9342b, L * 0.3, L * 0.15));
        }
      }
    }
    this.layers.markers = g; this.group.add(g);
  }
  pickSphere(name, c, r, color) {
    this.clear(name);
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }));
    s.position.set(...c); this.layers[name] = s; this.group.add(s);
  }
  _click(e) {
    if (!this.onPick || !this.layers.mesh) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(p, this.camera);
    const hit = ray.intersectObject(this.layers.mesh)[0];
    if (hit) this.onPick([hit.point.x, hit.point.y, hit.point.z]);
  }

  // process animation: mode "remove" (stock disappears in visit order) or "add" (part grows in order)
  animate(grid, order, mode, opts = {}) {
    this.stop();
    const n = order.length;
    if (!n) return;
    const seq = mode === "remove" ? order.slice().reverse() : order;
    const col = new THREE.Color(mode === "remove" ? 0xe0913f : opts.color || 0x2fa6a6);
    const mesh = this.voxels("anim", { ...grid, idx: seq }, () => col);
    if (mode === "remove") { mesh.material.transparent = true; mesh.material.opacity = 0.8; }
    mesh.count = mode === "remove" ? n : 0;
    this.clear("markers");
    let tool = null;
    if (opts.setups) {
      tool = new THREE.Mesh(new THREE.CylinderGeometry(grid.pitch * 1.2, grid.pitch * 1.2, this.size / 5, 16), new THREE.MeshStandardMaterial({ color: 0x555b63, metalness: 0.8, roughness: 0.3 }));
      this.group.add(tool); this.layers.tool = tool;
    }
    this.meshOpacity(mode === "remove" ? 0.35 : 0.12);
    const perFrame = Math.max(1, Math.ceil(n / (60 * (opts.seconds || 12))));
    let done = 0; const v = new THREE.Vector3();
    const axis = { "+z": [0, 0, 1], "-z": [0, 0, -1], "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0] };
    this._tick = () => {
      if (done >= n) { this._tick = null; opts.onEnd?.(); return; }
      done = Math.min(n, done + perFrame);
      mesh.count = mode === "remove" ? n - done : done;
      if (tool && done < n) {
        const s = opts.setups.find((s) => done - 1 >= s.start && done - 1 < s.start + s.count) || opts.setups[0];
        const a = new THREE.Vector3(...axis[s.dir]);
        cellPos(grid, order[done - 1], v);
        tool.position.copy(v).addScaledVector(a, this.size / 10 + grid.pitch / 2);
        tool.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a);
        opts.onStep?.(s, done / n);
      } else opts.onStep?.(null, done / n);
    };
  }
  stop() { this._tick = null; this.clear("anim"); this.clear("tool"); this.meshOpacity(1); }
}
