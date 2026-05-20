import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEPTH_PROFILES, SOUNDSPACE, STEMS } from './soundbox-data.js';
import { getFrameAtTime, mapFrameToSoundboxPosition } from './soundbox-analyzer.js';

function createTextSprite(text, color = '#e8e6f0') {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = 256 * dpr;
  canvas.height = 72 * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, 256, 72);
  ctx.font = '600 18px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(5, 6, 12, 0.72)';
  ctx.roundRect(46, 18, 164, 36, 18);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.62;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 37);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.35, 0.38, 1);
  return sprite;
}

function addLine(points, a, b) {
  points.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

export class SoundboxScene {
  constructor({ container, onSelect }) {
    this.container = container;
    this.onSelect = onSelect;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerStart = null;
    this.stemObjects = new Map();
    this.analyses = {};
    this.currentFrames = {};
    this.selectedStemId = 'vocals';
    this.showTrails = true;
    this.selectedRing = null;
    this.resizeObserver = null;
  }

  init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05060c');
    this.scene.fog = new THREE.Fog('#05060c', 9, 18);

    const { width, height } = this._getSize();
    this.camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 100);
    this.camera.position.set(5.2, 3.9, 6.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 13;
    this.controls.target.set(0, 0.35, 0);
    this.controls.update();

    this._addLights();
    this._addRoom();
    this._addDepthZones();
    this._bindPointerEvents();

    this.selectedRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.52, 0.018, 8, 64),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.88 })
    );
    this.selectedRing.visible = false;
    this.scene.add(this.selectedRing);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
  }

  _addLights() {
    this.scene.add(new THREE.AmbientLight('#8790ff', 0.42));
    const key = new THREE.PointLight('#f0766b', 1.8, 12);
    key.position.set(-3, 4, 5);
    this.scene.add(key);
    const fill = new THREE.PointLight('#4fd1d9', 1.1, 12);
    fill.position.set(4, 2, -4);
    this.scene.add(fill);
  }

  _addRoom() {
    const { xMax, yMin, yMax, zMin, zMax } = SOUNDSPACE;
    const points = [];
    const corners = [
      new THREE.Vector3(-xMax, yMin, zMin),
      new THREE.Vector3(xMax, yMin, zMin),
      new THREE.Vector3(xMax, yMin, zMax),
      new THREE.Vector3(-xMax, yMin, zMax),
      new THREE.Vector3(-xMax, yMax, zMin),
      new THREE.Vector3(xMax, yMax, zMin),
      new THREE.Vector3(xMax, yMax, zMax),
      new THREE.Vector3(-xMax, yMax, zMax),
    ];

    [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
      .forEach(([a, b]) => addLine(points, corners[a], corners[b]));

    for (let i = 1; i < 4; i++) {
      const x = -xMax + (i * xMax * 2) / 4;
      addLine(points, new THREE.Vector3(x, yMin, zMin), new THREE.Vector3(x, yMin, zMax));
      const z = zMin + (i * (zMax - zMin)) / 4;
      addLine(points, new THREE.Vector3(-xMax, yMin, z), new THREE.Vector3(xMax, yMin, z));
      const y = yMin + (i * (yMax - yMin)) / 4;
      addLine(points, new THREE.Vector3(-xMax, y, zMin), new THREE.Vector3(xMax, y, zMin));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18 });
    this.scene.add(new THREE.LineSegments(geometry, material));

    this._addAxis('LEFT', new THREE.Vector3(-xMax - 0.45, yMin, zMax + 0.15), '#f0766b');
    this._addAxis('RIGHT', new THREE.Vector3(xMax + 0.45, yMin, zMax + 0.15), '#f0766b');
    this._addAxis('LOW REGISTER', new THREE.Vector3(-xMax - 0.3, yMin - 0.05, zMin), '#5b87f5');
    this._addAxis('HIGH REGISTER', new THREE.Vector3(-xMax - 0.3, yMax + 0.1, zMin), '#5b87f5');
    this._addAxis('DISTANT', new THREE.Vector3(xMax + 0.2, yMin, zMin - 0.4), '#4fd1d9');
    this._addAxis('CLOSE', new THREE.Vector3(xMax + 0.2, yMin, zMax + 0.55), '#4fd1d9');
  }

  _addAxis(text, position, color) {
    const sprite = createTextSprite(text, color);
    sprite.position.copy(position);
    sprite.scale.multiplyScalar(0.68);
    this.scene.add(sprite);
  }

  _addDepthZones() {
    const zoneMaterial = new THREE.MeshBasicMaterial({
      color: '#9b6dff',
      transparent: true,
      opacity: 0.035,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const { xMax, yMin, yMax } = SOUNDSPACE;
    [-1.35, 0.05, 2.15].forEach((z) => {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(xMax * 2, yMax - yMin), zoneMaterial.clone());
      plane.position.set(0, (yMin + yMax) / 2, z);
      this.scene.add(plane);
    });
  }

  _bindPointerEvents() {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (event) => {
      this.pointerStart = { x: event.clientX, y: event.clientY };
    });
    dom.addEventListener('pointerup', (event) => {
      if (!this.pointerStart) return;
      const distance = Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y);
      this.pointerStart = null;
      if (distance > 6) return;
      this._selectFromPointer(event);
    });
  }

  _selectFromPointer(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [...this.stemObjects.values()].map((item) => item.sphere);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return;
    this.selectStem(hit.object.userData.stemId);
    if (this.onSelect) this.onSelect(hit.object.userData.stemId);
  }

  setAnalyses(analyses) {
    this.analyses = analyses;
    STEMS.forEach((stem) => this._createStemObject(stem));
  }

  _createStemObject(stem) {
    if (this.stemObjects.has(stem.id)) return;

    const color = new THREE.Color(stem.color);
    const group = new THREE.Group();
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 18),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.9,
        roughness: 0.32,
        metalness: 0.08,
      })
    );
    sphere.userData.stemId = stem.id;

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 18),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    glow.userData.stemId = stem.id;

    const label = createTextSprite(stem.name, stem.color);
    const trail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.22 })
    );

    group.add(trail, glow, sphere, label);
    this.scene.add(group);
    this.stemObjects.set(stem.id, { group, sphere, glow, label, trail, stem });
  }

  setTrailsVisible(showTrails) {
    this.showTrails = showTrails;
  }

  selectStem(stemId) {
    this.selectedStemId = stemId;
    this._updateSelectionRing();
  }

  focusStem(stemId) {
    const current = this.currentFrames[stemId];
    if (!current) return;
    this.controls.target.set(current.x, current.y, current.z);
    this.controls.update();
  }

  resetCamera() {
    this.camera.position.set(5.2, 3.9, 6.5);
    this.controls.target.set(0, 0.35, 0);
    this.controls.update();
  }

  getCurrentFrame(stemId) {
    return this.currentFrames[stemId] || null;
  }

  update(time, visibility = {}) {
    this.stemObjects.forEach((item, stemId) => {
      const visible = visibility[stemId] !== false;
      const frame = this._positionForStemAtTime(stemId, time);
      item.group.visible = visible;
      if (!frame) return;

      this.currentFrames[stemId] = frame;
      item.sphere.position.set(frame.x, frame.y, frame.z);
      item.sphere.scale.setScalar(frame.radius);
      item.glow.position.copy(item.sphere.position);
      item.glow.scale.setScalar(frame.radius * 2.45);
      item.glow.material.opacity = 0.015 + frame.energyNorm * 0.22;
      item.label.position.set(frame.x, frame.y + frame.radius + 0.34, frame.z);
      item.label.visible = visible;
      item.trail.visible = visible && this.showTrails;

      if (item.trail.visible) {
        this._updateTrail(item.trail, stemId, time);
      }
    });

    this._updateSelectionRing();
  }

  _positionForStemAtTime(stemId, time) {
    const analysis = this.analyses[stemId];
    if (!analysis) return null;
    const frame = getFrameAtTime(analysis.frames, time);
    return frame ? mapFrameToSoundboxPosition(frame, DEPTH_PROFILES[stemId] || {}) : null;
  }

  _updateTrail(trail, stemId, time) {
    const analysis = this.analyses[stemId];
    if (!analysis) return;
    const positions = analysis.positions
      .filter((point, index) => point.time <= time && index % 2 === 0)
      .map((point) => new THREE.Vector3(point.x, point.y, point.z));

    if (positions.length < 2) {
      trail.geometry.setFromPoints([]);
      return;
    }
    trail.geometry.dispose();
    trail.geometry = new THREE.BufferGeometry().setFromPoints(positions);
  }

  _updateSelectionRing() {
    if (!this.selectedRing) return;
    const current = this.currentFrames[this.selectedStemId];
    const selected = this.stemObjects.get(this.selectedStemId);
    if (!current || !selected || !selected.group.visible) {
      this.selectedRing.visible = false;
      return;
    }
    this.selectedRing.visible = true;
    this.selectedRing.position.set(current.x, current.y, current.z);
    this.selectedRing.scale.setScalar(Math.max(0.14, current.radius * 1.75));
    this.selectedRing.quaternion.copy(this.camera.quaternion);
  }

  render() {
    this.controls.update();
    if (this.selectedRing && this.selectedRing.visible) {
      this.selectedRing.quaternion.copy(this.camera.quaternion);
    }
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const { width, height } = this._getSize();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  _getSize() {
    const rect = this.container.getBoundingClientRect();
    return {
      width: Math.max(320, rect.width),
      height: Math.max(320, rect.height),
    };
  }

  dispose() {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.renderer?.dispose();
  }
}
