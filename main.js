import * as THREE from 'https://unpkg.com/three@0.166.1/build/three.module.js';

const canvas = document.querySelector('#game-canvas');
const caughtEl = document.querySelector('#caught-count');
const totalEl = document.querySelector('#total-count');
const timerEl = document.querySelector('#timer');
const messageEl = document.querySelector('#message');
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
let yaw = 0;
let pitch = 0;
let caught = 0;
let timeLeft = 120;
let running = false;
let finished = false;
let timerAccumulator = 0;

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

function createHider(index, x, z) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.55, 1.15, 6, 12),
    new THREE.MeshStandardMaterial({ color: [0xff5e7a, 0x5ee6ff, 0xffc857, 0xb388ff, 0x7dff83][index % 5] })
  );
  body.castShadow = true;
  group.add(body);
  group.position.set(x, 1, z);
  scene.add(group);
  hiders.push({ group, velocity: new THREE.Vector3(), caught: false, panic: Math.random() * 2, speed: 5.8 + Math.random() * 1.8 });
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
  finished = false;
  running = false;
  updateHud();
  showMessage('クリックして開始');
}

function updateHud() {
  caughtEl.textContent = String(caught);
  totalEl.textContent = String(hiders.length);
  timerEl.textContent = String(timeLeft);
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

function updateHiders(dt) {
  hiders.forEach((hider) => {
    if (hider.caught) return;
    const toPlayer = hider.group.position.clone().sub(player.position);
    const distance = toPlayer.length();
    const target = distance < 15 ? nearestCover(hider.group.position, player.position) : hider.group.position.clone().add(new THREE.Vector3(Math.sin(clock.elapsedTime + hider.panic), 0, Math.cos(clock.elapsedTime * 0.8 + hider.panic)).multiplyScalar(4));
    const desired = target.sub(hider.group.position).normalize().multiplyScalar(hider.speed);
    hider.velocity.lerp(desired, 0.045);
    const delta = hider.velocity.clone().multiplyScalar(dt);
    const old = hider.group.position.clone();
    hider.group.position.add(delta);
    hider.group.position.x = THREE.MathUtils.clamp(hider.group.position.x, -26, 26);
    hider.group.position.z = THREE.MathUtils.clamp(hider.group.position.z, -26, 26);
    if (collides(hider.group.position, 0.7)) hider.group.position.copy(old);
    hider.group.lookAt(hider.group.position.clone().add(hider.velocity));

    if (distance < 2.1) {
      hider.caught = true;
      hider.group.visible = false;
      caught += 1;
      updateHud();
      if (caught === hiders.length) endGame('全員発見！あなたの勝ち！');
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
    updatePlayer(dt);
    updateHiders(dt);
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
canvas.addEventListener('click', () => canvas.requestPointerLock());
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
