import * as THREE from 'https://unpkg.com/three@0.166.1/build/three.module.js';

const canvas = document.querySelector('#game-canvas');
const caughtEl = document.querySelector('#caught-count');
const totalEl = document.querySelector('#total-count');
const timerEl = document.querySelector('#timer');
const messageEl = document.querySelector('#message');
const suspicionEl = document.querySelector('#suspicion');
const shotStatusEl = document.querySelector('#shot-status');
const restartButton = document.querySelector('#restart');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc8ff);
scene.fog = new THREE.Fog(0x8fc8ff, 26, 86);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 160);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const hemi = new THREE.HemisphereLight(0xdff4ff, 0x365326, 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1cc, 2.2);
sun.position.set(18, 32, 16);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const arenaSize = 58;
const clock = new THREE.Clock();
const keys = new Set();
const obstacles = [];
const hiders = [];
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);
let currentSuspicion = 0;
let shotCooldown = 0;
const chameleonPalettes = [
  { name: 'leaf', color: new THREE.Color(0x5fce5a), emissive: new THREE.Color(0x123b16) },
  { name: 'moss', color: new THREE.Color(0x8abf48), emissive: new THREE.Color(0x263510) },
  { name: 'stone', color: new THREE.Color(0x75818c), emissive: new THREE.Color(0x1d2228) },
  { name: 'shadow', color: new THREE.Color(0x3d5275), emissive: new THREE.Color(0x101827) },
  { name: 'panic', color: new THREE.Color(0xff6f9a), emissive: new THREE.Color(0x4a1227) },
];
let yaw = 0;
let pitch = 0;
let caught = 0;
let timeLeft = 120;
let running = false;
let finished = false;
let timerAccumulator = 0;
const shotDelay = 0.85;

const player = {
  position: new THREE.Vector3(0, 1.7, 24),
  velocity: new THREE.Vector3(),
  speed: 13,
  radius: 0.8,
};

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(arenaSize, arenaSize),
  new THREE.MeshStandardMaterial({ color: 0x4e9b50, roughness: 0.9 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(arenaSize, 29, 0xdaf7a6, 0x2e6f42);
grid.position.y = 0.02;
scene.add(grid);

function addWall(x, z, w, d) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(w, 3.2, d),
    new THREE.MeshStandardMaterial({ color: 0x6f7b89, roughness: 0.75 })
  );
  wall.position.set(x, 1.6, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);
  obstacles.push({ mesh: wall, halfX: w / 2, halfZ: d / 2, radius: Math.hypot(w, d) / 2 });
}

function buildArena() {
  addWall(0, -arenaSize / 2, arenaSize, 1.2);
  addWall(0, arenaSize / 2, arenaSize, 1.2);
  addWall(-arenaSize / 2, 0, 1.2, arenaSize);
  addWall(arenaSize / 2, 0, 1.2, arenaSize);

  [
    [-17, -17, 10, 3], [8, -19, 4, 12], [19, -7, 11, 3],
    [-7, -3, 4, 13], [-22, 8, 9, 4], [7, 10, 15, 3],
    [21, 17, 4, 11], [-5, 22, 12, 3], [16, 4, 3, 7],
  ].forEach(([x, z, w, d]) => addWall(x, z, w, d));

  for (let i = 0; i < 22; i += 1) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.5, 2.7, 9),
      new THREE.MeshStandardMaterial({ color: 0x7b4b2a })
    );
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(1.8, 4.8, 10),
      new THREE.MeshStandardMaterial({ color: 0x1e6b3b })
    );
    const angle = i * 2.399;
    const radius = 10 + (i % 6) * 3.1;
    trunk.position.set(Math.cos(angle) * radius, 1.35, Math.sin(angle) * radius);
    crown.position.set(trunk.position.x, 5, trunk.position.z);
    trunk.castShadow = crown.castShadow = true;
    scene.add(trunk, crown);
  }
}


function createChameleonMaterial(index) {
  const palette = chameleonPalettes[index % (chameleonPalettes.length - 1)];
  return new THREE.MeshStandardMaterial({
    color: palette.color.clone(),
    emissive: palette.emissive.clone(),
    emissiveIntensity: 0.18,
    roughness: 0.65,
    metalness: 0.02,
  });
}


function makeEye(x) {
  const eye = new THREE.Group();
  const turret = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 18, 12),
    new THREE.MeshStandardMaterial({ color: 0x9fd35f, roughness: 0.7 })
  );
  turret.scale.set(1.05, 0.9, 1.25);
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 10),
    new THREE.MeshStandardMaterial({ color: 0xf8ffe8, roughness: 0.25 })
  );
  const pupil = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x101315 })
  );
  ball.position.set(0, 0.02, -0.18);
  pupil.position.set(0, 0.02, -0.29);
  eye.position.set(x, 0.36, -0.54);
  eye.add(turret, ball, pupil);
  return { eye, pupil, turret };
}

function makeLeg(x, z, material) {
  const leg = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.5, 5, 8), material);
  upper.rotation.z = x > 0 ? -0.9 : 0.9;
  upper.rotation.x = z > 0 ? 0.45 : -0.45;
  upper.position.set(x * 0.55, -0.32, z);

  const foot = new THREE.Group();
  foot.position.set(x * 0.88, -0.62, z + (z > 0 ? 0.1 : -0.1));
  for (const spread of [-0.22, 0.22]) {
    const toe = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.28, 4, 6), material);
    toe.rotation.x = Math.PI / 2;
    toe.rotation.z = spread * (x > 0 ? 1 : -1);
    toe.position.set(0, 0, spread);
    foot.add(toe);
  }
  leg.add(upper, foot);
  return leg;
}

function makeStripe(z, hueShift) {
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.92, 0.04),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0xd9ff62).offsetHSL(hueShift, 0, 0), emissive: 0x223400, emissiveIntensity: 0.15 })
  );
  stripe.position.set(0, 0.02, z);
  stripe.rotation.y = Math.PI / 2;
  stripe.userData.isPaintStripe = true;
  return stripe;
}

function copyStagePaint(position, stripes) {
  const palette = paletteForPosition(position);
  const sampled = palette.color.clone();
  stripes.forEach((stripe, index) => {
    const offset = Math.sin(position.x * 0.21 + position.z * 0.17 + index) * 0.09;
    stripe.material.color.copy(sampled).offsetHSL(offset, 0.08, index % 2 ? 0.1 : -0.06);
  });
  return sampled;
}

function choosePoseForCover(position) {
  const nearest = obstacles.slice(4).reduce((best, obstacle) => {
    const distance = obstacle.mesh.position.distanceToSquared(position);
    return distance < best.distance ? { distance, obstacle } : best;
  }, { distance: Infinity, obstacle: null });
  if (!nearest.obstacle) return 'blob';
  return nearest.obstacle.halfX > nearest.obstacle.halfZ ? 'wide' : 'tall';
}

function createHider(index, x, z) {
  const group = new THREE.Group();
  const material = createChameleonMaterial(index);
  const bellyMaterial = material.clone();
  bellyMaterial.color.offsetHSL(0.04, -0.18, 0.18);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.25, 8, 18), material);
  body.rotation.z = Math.PI / 2;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 12), material);
  head.scale.set(1, 0.85, 1.18);
  head.position.set(0, 0.08, -0.7);
  head.castShadow = true;
  group.add(head);

  const casque = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.9, 5), material);
  casque.scale.set(0.75, 1.35, 0.55);
  casque.rotation.x = Math.PI;
  casque.position.set(0, 0.86, -0.48);
  casque.castShadow = true;
  group.add(casque);

  const dorsalSpines = [];
  for (let i = 0; i < 7; i += 1) {
    const spine = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 5), material);
    spine.position.set(0, 0.63, -0.35 + i * 0.22);
    spine.rotation.x = Math.PI;
    spine.castShadow = true;
    dorsalSpines.push(spine);
    group.add(spine);
  }

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.48, 18, 10), bellyMaterial);
  belly.scale.set(1.15, 0.5, 0.78);
  belly.position.set(0, -0.08, 0.08);
  group.add(belly);

  const tail = new THREE.Mesh(new THREE.TorusKnotGeometry(0.26, 0.055, 56, 8, 2, 3), material);
  tail.scale.set(1.15, 1.15, 0.45);
  tail.rotation.set(Math.PI / 2, 0, Math.PI * 0.8);
  tail.position.set(0, 0.02, 1.05);
  tail.castShadow = true;
  group.add(tail);

  const legs = [makeLeg(-1, -0.35, material), makeLeg(1, -0.35, material), makeLeg(-1, 0.45, material), makeLeg(1, 0.45, material)];
  legs.forEach((leg) => group.add(leg));

  const stripes = [-0.28, -0.02, 0.24, 0.5].map((z, stripeIndex) => makeStripe(z, stripeIndex * 0.08));
  stripes.forEach((stripe) => group.add(stripe));

  const tongue = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.02, 1.15, 8),
    new THREE.MeshStandardMaterial({ color: 0xff7aac, emissive: 0x5a1232, emissiveIntensity: 0.25 })
  );
  tongue.rotation.x = Math.PI / 2;
  tongue.position.set(0, 0.02, -1.35);
  tongue.visible = false;
  group.add(tongue);

  const leftEye = makeEye(-0.28);
  const rightEye = makeEye(0.28);
  group.add(leftEye.eye, rightEye.eye);
  group.position.set(x, 1, z);
  scene.add(group);
  const hiderData = {
    group,
    bodyParts: [body, head, casque, belly, tail, ...dorsalSpines, ...legs],
    stripeParts: stripes,
    eyes: [leftEye, rightEye],
    tongue,
    material,
    bellyMaterial,
    velocity: new THREE.Vector3(),
    caught: false,
    panic: Math.random() * 2,
    speed: 5.8 + Math.random() * 1.8,
    camouflage: copyStagePaint(new THREE.Vector3(x, 1, z), stripes),
    camouflageQuality: 0.35,
    poseMode: 'blob',
    wasSpotted: false,
  };
  group.traverse((child) => {
    if (child.isMesh) child.userData.hider = hiderData;
  });
  hiders.push(hiderData);
}


function resetGame() {
  hiders.forEach((hider) => scene.remove(hider.group));
  hiders.length = 0;
  [[-23, -22], [22, -22], [-24, 18], [24, 23], [2, -24], [-12, 15], [14, 14]].forEach((p, i) => createHider(i, p[0], p[1]));
  player.position.set(0, 1.7, 24);
  yaw = Math.PI;
  pitch = 0;
  caught = 0;
  timeLeft = 120;
  timerAccumulator = 0;
  currentSuspicion = 0;
  shotCooldown = 0;
  finished = false;
  running = false;
  updateHud();
  showMessage('クリックして開始');
}

function updateHud() {
  caughtEl.textContent = String(caught);
  totalEl.textContent = String(hiders.length);
  timerEl.textContent = String(timeLeft);
  suspicionEl.textContent = String(Math.round(currentSuspicion));
  shotStatusEl.textContent = shotCooldown <= 0 ? 'READY' : `${shotCooldown.toFixed(1)}s`;
}


function showMessage(text) {
  messageEl.textContent = text;
  messageEl.classList.remove('hidden');
}

function hideMessage() {
  messageEl.classList.add('hidden');
}

function collides(position, radius = player.radius) {
  return obstacles.some(({ mesh, halfX, halfZ }) =>
    Math.abs(position.x - mesh.position.x) < halfX + radius && Math.abs(position.z - mesh.position.z) < halfZ + radius
  );
}

function moveWithCollision(position, delta) {
  const nextX = position.clone();
  nextX.x += delta.x;
  if (!collides(nextX)) position.x = nextX.x;
  const nextZ = position.clone();
  nextZ.z += delta.z;
  if (!collides(nextZ)) position.z = nextZ.z;
  position.x = THREE.MathUtils.clamp(position.x, -arenaSize / 2 + 1.7, arenaSize / 2 - 1.7);
  position.z = THREE.MathUtils.clamp(position.z, -arenaSize / 2 + 1.7, arenaSize / 2 - 1.7);
}

function nearestCover(from, threat) {
  return obstacles.slice(4).reduce((best, obstacle) => {
    const away = obstacle.mesh.position.clone().sub(threat).normalize();
    const candidate = obstacle.mesh.position.clone().add(away.multiplyScalar(obstacle.radius + 1.9));
    candidate.y = 1;
    const score = candidate.distanceToSquared(from) + 0.35 * candidate.distanceToSquared(threat);
    return score < best.score ? { point: candidate, score } : best;
  }, { point: from.clone(), score: Infinity }).point;
}


function paletteForPosition(position) {
  const nearest = obstacles.slice(4).reduce((best, obstacle) => {
    const distance = obstacle.mesh.position.distanceToSquared(position);
    return distance < best.distance ? { distance, obstacle } : best;
  }, { distance: Infinity, obstacle: null });
  if (!nearest.obstacle) return chameleonPalettes[0];
  if (nearest.distance < 18) return chameleonPalettes[2];
  if (position.z > 10) return chameleonPalettes[1];
  if (position.x > 10) return chameleonPalettes[3];
  return chameleonPalettes[0];
}

function updatePaintPose(hider, distanceToPlayer) {
  const calmPalette = paletteForPosition(hider.group.position);
  const panicMix = THREE.MathUtils.clamp((14 - distanceToPlayer) / 10, 0, 1);
  if (distanceToPlayer > 16 && hider.velocity.length() < 2.6) {
    hider.camouflage.lerp(copyStagePaint(hider.group.position, hider.stripeParts), 0.08);
    hider.poseMode = choosePoseForCover(hider.group.position);
  } else {
    hider.camouflage.lerp(calmPalette.color, 0.03);
    hider.poseMode = 'runner';
  }
  const color = hider.camouflage.clone().lerp(chameleonPalettes[4].color, panicMix * 0.65);
  const pulse = 0.5 + Math.sin(clock.elapsedTime * 10 + hider.panic) * 0.5;
  hider.material.color.copy(color).offsetHSL(0, 0.12 * pulse * panicMix, 0.06 * pulse * panicMix);
  hider.material.emissive.copy(calmPalette.emissive).lerp(chameleonPalettes[4].emissive, panicMix);
  hider.bellyMaterial.color.copy(hider.material.color).offsetHSL(0.03, -0.25, 0.2);
  hider.bodyParts.forEach((part, partIndex) => {
    part.scale.y = 1 + Math.sin(clock.elapsedTime * 6 + partIndex + hider.panic) * 0.025;
  });
  hider.camouflageQuality = THREE.MathUtils.clamp((1 - panicMix) * (hider.poseMode === 'runner' ? 0.42 : 0.86), 0.12, 0.92);
  hider.stripeParts.forEach((stripe, stripeIndex) => {
    const copied = hider.camouflage.clone().offsetHSL(stripeIndex * 0.035, 0.06, stripeIndex % 2 ? 0.12 : -0.08);
    stripe.material.color.copy(chameleonPalettes[4].color).lerp(copied, hider.camouflageQuality);
    stripe.visible = hider.camouflageQuality > 0.55 || panicMix > 0.2 || stripeIndex % 2 === 0;
  });
  hider.eyes.forEach(({ eye, pupil }, eyeIndex) => {
    eye.rotation.y = Math.sin(clock.elapsedTime * 1.7 + hider.panic + eyeIndex * 2.4) * 0.55;
    eye.rotation.x = Math.cos(clock.elapsedTime * 1.3 + hider.panic + eyeIndex) * 0.25;
    pupil.scale.setScalar(1 + panicMix * 0.55);
  });
  hider.tongue.visible = hider.wasSpotted || (distanceToPlayer < 8 && Math.sin(clock.elapsedTime * 9 + hider.panic) > 0.35);
  hider.tongue.scale.y = hider.tongue.visible ? 1 + panicMix * 1.8 : 0.35;
  if (hider.poseMode === 'wide') hider.group.scale.lerp(new THREE.Vector3(1.45, 0.72, 0.92), 0.05);
  else if (hider.poseMode === 'tall') hider.group.scale.lerp(new THREE.Vector3(0.74, 1.35, 0.84), 0.05);
  else hider.group.scale.lerp(new THREE.Vector3(1, 1, 1), 0.08);
}

function updateHiders(dt) {
  hiders.forEach((hider) => {
    if (hider.caught) return;
    const toPlayer = hider.group.position.clone().sub(player.position);
    const distance = toPlayer.length();
    updatePaintPose(hider, distance);
    const exposed = hider.wasSpotted || currentSuspicion > 72;
    const target = distance < 15 || exposed ? nearestCover(hider.group.position, player.position) : hider.group.position.clone().add(new THREE.Vector3(Math.sin(clock.elapsedTime + hider.panic), 0, Math.cos(clock.elapsedTime * 0.8 + hider.panic)).multiplyScalar(4));
    const desired = target.sub(hider.group.position).normalize().multiplyScalar(hider.speed);
    hider.velocity.lerp(desired, exposed ? 0.085 : 0.035);
    const delta = hider.velocity.clone().multiplyScalar(dt);
    const old = hider.group.position.clone();
    hider.group.position.add(delta);
    hider.group.position.x = THREE.MathUtils.clamp(hider.group.position.x, -26, 26);
    hider.group.position.z = THREE.MathUtils.clamp(hider.group.position.z, -26, 26);
    if (collides(hider.group.position, 0.7)) hider.group.position.copy(old);
    hider.group.lookAt(hider.group.position.clone().add(hider.velocity));
    hider.group.rotation.z = Math.sin(clock.elapsedTime * 2.2 + hider.panic) * 0.08;

    if (distance < 2.1) {
      hider.caught = true;
      hider.group.visible = false;
      caught += 1;
      updateHud();
      if (caught === hiders.length) endGame('全カメレオン発見！あなたの勝ち！');
    }
  });
}

function updatePlayer(dt) {
  const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
  const strafe = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const direction = new THREE.Vector3(strafe, 0, -forward).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  moveWithCollision(player.position, direction.multiplyScalar(player.speed * dt));
  camera.position.copy(player.position);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

function scanForVisualMismatch() {
  raycaster.setFromCamera(center, camera);
  const meshes = [];
  hiders.forEach((hider) => {
    if (!hider.caught) hider.group.traverse((child) => { if (child.isMesh) meshes.push(child); });
  });
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit?.object.userData.hider) {
    currentSuspicion = THREE.MathUtils.lerp(currentSuspicion, 0, 0.12);
    return null;
  }
  const hider = hit.object.userData.hider;
  const mismatch = (1 - hider.camouflageQuality) * 100;
  const distanceBonus = THREE.MathUtils.clamp((18 - hit.distance) * 3, 0, 38);
  currentSuspicion = THREE.MathUtils.lerp(currentSuspicion, mismatch + distanceBonus, 0.22);
  return hider;
}

function shootPaintDetector() {
  if (!running || finished || shotCooldown > 0) return;
  shotCooldown = shotDelay;
  const hider = scanForVisualMismatch();
  if (!hider) return;
  hider.wasSpotted = true;
  if (currentSuspicion > 34 || hider.group.position.distanceTo(player.position) < 10) {
    hider.caught = true;
    hider.group.visible = false;
    caught += 1;
    updateHud();
    if (caught === hiders.length) endGame('全カメレオン発見！あなたの勝ち！');
  }
}

function endGame(text) {
  finished = true;
  running = false;
  document.exitPointerLock?.();
  showMessage(`${text} リスタートで再挑戦`);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (running && !finished) {
    shotCooldown = Math.max(0, shotCooldown - dt);
    updatePlayer(dt);
    scanForVisualMismatch();
    updateHiders(dt);
    updateHud();
    timerAccumulator += dt;
    if (timerAccumulator >= 1) {
      timeLeft -= Math.floor(timerAccumulator);
      timerAccumulator %= 1;
      updateHud();
      if (timeLeft <= 0) endGame('時間切れ！AIの勝ち！');
    }
  }
  renderer.render(scene, camera);
}

window.addEventListener('keydown', (event) => keys.add(event.code));
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== canvas || finished) return;
  yaw -= event.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.0022, -1.25, 1.25);
});
canvas.addEventListener('click', () => {
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  else shootPaintDetector();
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas && !finished) {
    running = true;
    hideMessage();
  }
});
restartButton.addEventListener('click', resetGame);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

buildArena();
resetGame();
animate();
