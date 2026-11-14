// CINDERFALL — boot and the one loop: a fixed 60 Hz simulation feeding a render
// at the display's rate. You fight with two Sentinel allies against four Cinder bots
// in the Slagworks Yard. Rounds are won by elimination or by the charge: plant it at
// Kiln or Depot, defend the fuse, and the round is yours.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { THEME } from './theme.js';
import { makeSeeded } from './util.js';
import { buildYard } from './world.js';
import { makeBody } from './body.js';
import { makeViewGun, makeGrenade, makeBlast, GRENADE } from './guns.js';
import { makeSquads, DEFUSE_SECONDS } from './bots.js';
import { makeMatch, BUY_SECONDS, ROUND_SECONDS, FUSE_SECONDS, PLANT_SECONDS, PRIZES } from './match.js';
import { makeHud } from './hud.js';
import { makeInput } from './input.js';

const STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const rng = makeSeeded(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(THEME.sky);
scene.fog = new THREE.Fog(new THREE.Color(THEME.sky), 22, 55);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const yard = buildYard(scene);
const hud = makeHud();
const input = makeInput(renderer.domElement, onLockChange);
const matchApi = makeMatch();
const { match, startRound, goLive, endRound, nextRound, buy, addKill } = matchApi;
const squads = makeSquads(scene, yard, rng);
const playerBody = makeBody(yard.solids, yard.spawns.sentinel[0]);
const viewGun = makeViewGun(camera);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

// --- The player, wrapped to look like any other fighter to the bots.
const player = {
  fighter: playerBody,
  hp: 100,
  vest: 0,
  alive: true,
  side: 'sentinel',
  isPlayer: true,
  name: 'You',
  eye(out) { return playerBody.eyePosition(out); },
  speed() { return playerBody.speed(); },
};

const fighters = [player];
for (const ally of squads.allies) fighters.push(ally);
for (const enemy of squads.enemies) fighters.push(enemy);

const world = {
  time: 0,
  rng,
  shootables: yard.targets,
  fighters,
  player,
  charge: match.charge,
  noises: [],
  defuser: null,
  fireShot,
  losClear,
  onDefused,
};

let time = 0;
let started = false;
let frozen = false;
let wasFiring = false;
let accumulator = 0;
let lastTime = performance.now();
let damageFlash = 0;
let audio = null;

const tracers = [];
const grenades = [];
const blasts = [];
const tmpDir = new THREE.Vector3();
const tmpFrom = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
const tmpBox = new THREE.Box3();
const tmpRay = new THREE.Ray();

// The planted charge: a small dark box with a blinking lamp, shown at the site.
const chargeMesh = new THREE.Group();
const chargeBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.3, 0.35),
  new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c1c1c'), roughness: 0.5, metalness: 0.5 }),
);
const chargeLamp = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 8, 6),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(THEME.enemy) }),
);
chargeLamp.position.set(0, 0.22, 0);
chargeMesh.add(chargeBody, chargeLamp);
chargeMesh.visible = false;
scene.add(chargeMesh);

// --- Tiny synth sounds, made in code (no audio assets). Created on the first gesture.
function blip(freq, length, type, volume) {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + length);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + length);
  } catch (error) {
    audio = null;
  }
}

function addTracer(from, to, color) {
  const geometry = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  scene.add(line);
  tracers.push({ line, until: time + 0.07 });
}

function losClear(from, to) {
  tmpDir.copy(to).sub(from);
  const dist = tmpDir.length();
  if (dist < 0.01) return true;
  tmpDir.normalize();
  raycaster.set(from, tmpDir);
  raycaster.far = dist - 0.3;
  const hit = raycaster.intersectObjects(yard.targets, false)[0];
  raycaster.far = 90;
  return !hit;
}

function hurtPlayer(amount) {
  if (!player.alive) return;
  let left = amount;
  if (player.vest > 0) {
    const soaked = Math.min(player.vest, left * 0.5);
    player.vest -= soaked;
    left -= soaked;
  }
  player.hp -= left;
  damageFlash = 0.55;
  blip(140, 0.12, 'sawtooth', 0.05);
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
    match.deaths += 1;
    hud.feed('You were eliminated');
    if (match.charge.state === 'carried') {
      match.charge.state = 'lost';
      hud.setCharge('Charge lost — elimination only');
    }
    checkRoundEnd();
  }
}

function hurtBot(bot, amount, shooterName) {
  const killed = bot.damageFn(amount);
  if (killed) {
    hud.feed(`${shooterName} eliminated ${bot.name}`);
    if (shooterName === 'You') addKill();
    checkRoundEnd();
  }
  return killed;
}

// A shot from any fighter: raycast against the yard, the bots and the player, and
// take the nearest hit. Returns the hit point for the tracer.
function fireShot(shooter, from, direction, weapon) {
  raycaster.set(from, direction);
  const meshes = yard.targets.slice();
  for (const fighter of fighters) {
    if (fighter.isPlayer) continue;
    if (fighter.state === shooter) continue; // a bot never shoots its own body
    if (fighter.alive) meshes.push(...fighter.hitMeshes);
  }
  const hits = raycaster.intersectObjects(meshes, false);
  let hitPoint = null;
  let hitDist = Infinity;
  if (hits.length > 0) {
    hitPoint = hits[0].point;
    hitDist = hits[0].distance;
  }
  // The player has no hit mesh: test the ray against the player's body box.
  // Only Cinder bots can hurt the player; Sentinel fire never tests the player.
  if (shooter.side === 'cinder') {
    const body = playerBody.pose;
    tmpBox.min.set(body.position.x - 0.36, body.position.y, body.position.z - 0.36);
    tmpBox.max.set(body.position.x + 0.36, body.position.y + body.height, body.position.z + 0.36);
    tmpRay.set(from, direction);
    const bodyHit = tmpRay.intersectBox(tmpBox, tmpTo);
    if (bodyHit && player.alive) {
      const d = from.distanceTo(bodyHit);
      if (d < hitDist) {
        const headTop = body.position.y + body.eye + 0.12;
        const isHead = bodyHit.y > headTop - 0.3;
        hurtPlayer(isHead ? weapon.head : weapon.body);
        hitPoint = bodyHit.clone();
        hitDist = d;
      }
    }
  }
  if (hits.length > 0 && hits[0].distance <= hitDist && hits[0].object.userData.hit) {
    const { bot, part } = hits[0].object.userData.hit;
    const damage = part === 'head' ? weapon.head : weapon.body;
    hurtBot(bot, damage, shooter.name || 'You');
    if (shooter.isPlayer) {
      hud.hitMarker(bot.hp <= 0);
      blip(bot.hp <= 0 ? 1320 : 880, 0.05, 'square', 0.04);
    }
  }
  if (!hitPoint) {
    hitPoint = from.clone().addScaledVector(direction, 80);
  }
  const color = shooter.side === 'sentinel' ? THEME.ally : THEME.enemy;
  addTracer(from, hitPoint, color);
  world.noises.push({ pos: from.clone(), at: time });
  if (world.noises.length > 8) world.noises.shift();
}

function onDefused(bot) {
  if (match.charge.state !== 'planted') return;
  match.charge.state = 'defused';
  hud.feed(`${bot.name} defused the charge`);
  endRound('cinder', 'Charge defused');
  finishRound();
}

function playerShoot() {
  const def = viewGun.def;
  if (!viewGun.takeRound()) {
    viewGun.reload();
    return;
  }
  const spread = viewGun.spread(playerBody.speed()) * (playerBody.pose.crouched ? 0.6 : 1);
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    camera.getWorldDirection(tmpDir);
    tmpDir.x += (rng() * 2 - 1) * spread;
    tmpDir.y += (rng() * 2 - 1) * spread;
    tmpDir.z += (rng() * 2 - 1) * spread;
    tmpDir.normalize();
    camera.getWorldPosition(tmpFrom);
    fireShot(player, tmpFrom, tmpDir.clone(), def);
  }
  viewGun.fire();
  playerBody.recoil(0.009 + rng() * 0.004, (rng() * 2 - 1) * 0.004);
  blip(190, 0.06, 'square', 0.05);
  hud.setAmmo(viewGun.state.mag, viewGun.state.reserve);
}

function throwGrenade() {
  if (match.grenades <= 0) return;
  match.grenades -= 1;
  camera.getWorldDirection(tmpDir);
  camera.getWorldPosition(tmpFrom);
  grenades.push(makeGrenade(scene, tmpFrom, tmpDir));
  hud.feed('Ember grenade thrown');
}

function detonateGrenade(grenade) {
  const pos = grenade.mesh.position.clone();
  blasts.push(makeBlast(scene, pos));
  blip(90, 0.3, 'sawtooth', 0.08);
  for (const fighter of fighters) {
    if (!fighter.alive) continue;
    const targetPos = fighter.isPlayer
      ? playerBody.pose.position.clone().setY(playerBody.pose.position.y + 1)
      : fighter.fighter.pose.position.clone().setY(fighter.fighter.pose.position.y + 1);
    const dist = pos.distanceTo(targetPos);
    if (dist > GRENADE.radius) continue;
    const falloff = 1 - dist / GRENADE.radius;
    const damage = Math.round(GRENADE.minDamage + (GRENADE.maxDamage - GRENADE.minDamage) * falloff);
    if (fighter.isPlayer) hurtPlayer(damage);
    else hurtBot(fighter.state, damage, 'You');
  }
}

function checkRoundEnd() {
  if (match.phase !== 'live') return;
  const cinderAlive = squads.enemies.filter((bot) => bot.alive).length;
  const sentinelAlive = (player.alive ? 1 : 0) + squads.allies.filter((bot) => bot.alive).length;
  if (cinderAlive === 0) {
    endRound('sentinel', 'Cinder crew eliminated');
    finishRound();
  } else if (sentinelAlive === 0) {
    endRound('cinder', 'Sentinel squad eliminated');
    finishRound();
  }
}

function finishRound() {
  hud.showBuy(false, match.money, match.owned, match.grenades, match.vest);
  hud.setPlant('', 0);
  chargeMesh.visible = false;
  const reason = match.lastReason;
  const leader = match.score.sentinel > match.score.cinder ? 'Sentinel' : 'Cinder';
  if (match.over) {
    hud.showOverlay('match', `${match.winner === 'sentinel' ? 'Sentinel' : 'Cinder'} takes the match ${match.score.sentinel}–${match.score.cinder}. ${reason}`);
  } else {
    hud.showOverlay('round', `${leader} takes round ${match.round} — ${reason}`);
  }
  input.releaseLock();
}

function assignLanes() {
  const lanes = yard.lanes;
  const picks = [
    { lane: lanes.kilnRow, site: 'A' },
    { lane: lanes.trench, site: 'A' },
    { lane: lanes.depotAlley, site: 'B' },
    { lane: lanes.trench, site: 'B' },
  ];
  squads.enemies.forEach((enemy, index) => {
    enemy.state.lane = picks[index].lane;
    enemy.state.laneSite = picks[index].site;
    enemy.state.laneIndex = 0;
  });
  squads.allies[0].state.shadow.set(-2.5, 0, 1.5);
  squads.allies[1].state.shadow.set(2.5, 0, 1.5);
}

function resetPositions() {
  playerBody.pose.position.copy(yard.spawns.sentinel[0]);
  playerBody.pose.velocity.set(0, 0, 0);
  playerBody.pose.yaw = 0;
  playerBody.pose.pitch = 0;
  player.hp = 100;
  player.vest = match.vest;
  player.alive = true;
  viewGun.restock();
  squads.allies.forEach((ally, i) => ally.reset(yard.spawns.sentinel[i + 1]));
  squads.enemies.forEach((enemy, i) => enemy.reset(yard.spawns.cinder[i]));
  assignLanes();
  world.defuser = null;
  world.noises.length = 0;
  for (const grenade of grenades) grenade.remove();
  grenades.length = 0;
}

function syncCamera() {
  camera.position.set(
    playerBody.pose.position.x,
    playerBody.pose.position.y + playerBody.pose.eye,
    playerBody.pose.position.z,
  );
  camera.rotation.set(playerBody.pose.pitch, playerBody.pose.yaw, 0, 'YXZ');
}

function syncHud() {
  hud.setHealth(player.hp);
  hud.setArmor(player.vest);
  hud.setAmmo(viewGun.state.mag, viewGun.state.reserve);
  hud.setWeapon(viewGun.def.name);
  hud.setMoney(match.money);
  hud.setTimer(match.phaseLeft);
  hud.setRound(match.round, 9);
  hud.setScore(match.score.sentinel, match.score.cinder);
  const cinderAlive = squads.enemies.filter((bot) => bot.alive).length;
  const sentinelAlive = (player.alive ? 1 : 0) + squads.allies.filter((bot) => bot.alive).length;
  hud.setAlive(sentinelAlive, cinderAlive);
  hud.setCrosshairGap(4 + viewGun.spread(playerBody.speed()) * 900);
  const charge = match.charge;
  if (charge.state === 'carried') hud.setCharge('Charge carried — plant at Kiln (A) or Depot (B)');
  else if (charge.state === 'planted') hud.setCharge(`Planted at ${yard.sites[charge.siteKey].label} — ${Math.ceil(charge.fuseLeft)}s`);
  else if (charge.state === 'lost') hud.setCharge('Charge lost — elimination only');
  else if (charge.state === 'defused') hud.setCharge('Charge defused');
  else if (charge.state === 'detonated') hud.setCharge('Charge detonated');
  const damageEl = document.getElementById('damage');
  if (damageEl) damageEl.style.opacity = String(Math.max(0, damageFlash));
}

function step(dt) {
  time += dt;
  world.time = time;
  // Keep every mesh's world matrix current before any raycast this step runs:
  // in capture mode no render happens between steps, so without this the hit
  // meshes would still sit at the origin and every shot would miss.
  scene.updateMatrixWorld();
  match.phaseLeft -= dt;

  // Phase clock.
  if (match.phase === 'buy' && match.phaseLeft <= 0) {
    goLive();
    hud.showBuy(false, match.money, match.owned, match.grenades, match.vest);
    hud.banner('Round live — plant the charge or eliminate Cinder');
    window.setTimeout(() => hud.banner(''), 3000);
  } else if (match.phase === 'over' && match.phaseLeft <= 0) {
    if (!match.over) {
      nextRound();
      resetPositions();
      hud.hideOverlay();
      hud.showBuy(true, match.money, match.owned, match.grenades, match.vest);
    }
  }

  if (match.phase === 'live') {
    // The plant: hold E inside a site while carrying the charge.
    const charge = match.charge;
    if (charge.state === 'carried' && player.alive) {
      let siteKey = null;
      for (const key of ['A', 'B']) {
        const site = yard.sites[key];
        if (playerBody.pose.position.distanceTo(site.center) < site.radius) siteKey = key;
      }
      if (siteKey && input.state.keys.has('KeyE')) {
        charge.plantLeft -= dt;
        hud.setPlant(`Planting at ${yard.sites[siteKey].label}…`, 1 - charge.plantLeft / PLANT_SECONDS);
        if (charge.plantLeft <= 0) {
          charge.state = 'planted';
          charge.siteKey = siteKey;
          charge.siteCenter = yard.sites[siteKey].center;
          charge.fuseLeft = FUSE_SECONDS;
          match.money += PRIZES.plant;
          hud.feed(`Charge planted at ${yard.sites[siteKey].label}`);
          hud.setPlant('', 0);
          chargeMesh.position.copy(yard.sites[siteKey].center);
          chargeMesh.position.y = 0.35;
          chargeMesh.visible = true;
          blip(520, 0.15, 'square', 0.06);
        }
      } else {
        charge.plantLeft = PLANT_SECONDS;
        hud.setPlant('', 0);
      }
    }

    // The fuse and the clock.
    if (charge.state === 'planted') {
      charge.fuseLeft -= dt;
      if (charge.fuseLeft <= 0) {
        charge.state = 'detonated';
        blasts.push(makeBlast(scene, charge.siteCenter.clone().setY(1)));
        endRound('sentinel', 'Charge detonated');
        finishRound();
      }
      // Pick the nearest living Cinder bot as the defuser.
      if (!world.defuser || !world.defuser.alive) {
        let best = null;
        let bestDist = Infinity;
        for (const enemy of squads.enemies) {
          if (!enemy.alive) continue;
          const d = enemy.fighter.pose.position.distanceTo(charge.siteCenter);
          if (d < bestDist) {
            bestDist = d;
            best = enemy;
          }
        }
        world.defuser = best ? best.state : null;
        if (world.defuser) world.defuser.defuseLeft = DEFUSE_SECONDS;
      }
    }

    if (match.phaseLeft <= 0 && charge.state !== 'planted') {
      endRound('cinder', 'Time expired — no plant');
      finishRound();
    }
  }

  // Player movement and actions. The player can walk during the buy phase, but the
  // trigger only works once the round is live.
  if (player.alive && match.phase !== 'over') {
    playerBody.step(dt, input.state.keys, null);
    const firing = input.state.firing;
    const triggerEdge = firing && !wasFiring;
    if (match.phase === 'live' && viewGun.ready() && (viewGun.def.auto ? firing : triggerEdge)) playerShoot();
    wasFiring = firing;
    if (input.state.keys.has('KeyR')) viewGun.reload();
  }
  viewGun.step(dt);

  // One-shot keys.
  for (const code of input.takePressed()) {
    if (code === 'KeyB' && match.phase === 'buy') {
      const buyEl = document.getElementById('buy');
      hud.showBuy(buyEl.hidden, match.money, match.owned, match.grenades, match.vest);
    } else if (code === 'KeyG' && match.phase === 'live' && player.alive) {
      throwGrenade();
    } else if (code.startsWith('Digit')) {
      const slot = Number(code.slice(5)) - 1;
      const keys = ['sidearm', 'carbine', 'hornet', 'scatter', 'marksman'];
      const key = keys[slot];
      if (key && match.owned[key]) viewGun.swap(key);
    }
  }

  // Bots think and move only while the round is live.
  if (match.phase === 'live') {
    for (const ally of squads.allies) ally.update(dt, world);
    for (const enemy of squads.enemies) enemy.update(dt, world);
  }

  // Grenades and blasts.
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    grenades[i].step(dt);
    if (grenades[i].done) {
      detonateGrenade(grenades[i]);
      grenades[i].remove();
      grenades.splice(i, 1);
    }
  }
  for (let i = blasts.length - 1; i >= 0; i -= 1) {
    blasts[i].step(dt);
    if (blasts[i].gone) blasts.splice(i, 1);
  }

  // Tracers fade.
  for (let i = tracers.length - 1; i >= 0; i -= 1) {
    if (time >= tracers[i].until) {
      scene.remove(tracers[i].line);
      tracers[i].line.geometry.dispose();
      tracers.splice(i, 1);
    }
  }

  // The charge lamp blinks while the fuse runs.
  if (chargeMesh.visible) {
    chargeLamp.material.color.setHex(Math.floor(time * 4) % 2 === 0 ? 0xff4a38 : 0x881111);
  }
  damageFlash = Math.max(0, damageFlash - dt * 1.4);
  syncHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (player.alive) playerBody.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      step(STEP);
      accumulator -= STEP;
      steps += 1;
    }
    if (accumulator > STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (!match.over && match.phase !== 'over') {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (match.over) {
    // Fresh match: reset everything and start round one.
    match.round = 1;
    match.score.sentinel = 0;
    match.score.cinder = 0;
    match.money = 800;
    match.kills = 0;
    match.deaths = 0;
    match.owned = { sidearm: true };
    match.grenades = 0;
    match.vest = 0;
    match.over = false;
    match.winner = null;
    viewGun.swap('sidearm');
    startRound();
    resetPositions();
    hud.hideOverlay();
    hud.showBuy(true, match.money, match.owned, match.grenades, match.vest);
  } else if (match.phase === 'over') {
    nextRound();
    resetPositions();
    hud.hideOverlay();
    hud.showBuy(true, match.money, match.owned, match.grenades, match.vest);
  }
  input.requestLock();
});

// Buy menu clicks.
document.querySelectorAll('#buy-items [data-item]').forEach((node) => {
  node.addEventListener('click', () => {
    const result = buy(node.getAttribute('data-item'));
    if (!result.ok) {
      hud.feed(result.why);
      return;
    }
    if (result.item.kind === 'gun') viewGun.swap(result.item.id);
    hud.showBuy(true, match.money, match.owned, match.grenades, match.vest);
    hud.setMoney(match.money);
  });
});

function aimAt(point) {
  const pose = playerBody.pose;
  const dx = point.x - pose.position.x;
  const dy = point.y - (pose.position.y + pose.eye);
  const dz = point.z - pose.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  pose.yaw = Math.atan2(-dx, -dz);
  pose.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false, match.money, match.owned, match.grenades, match.vest);
  playerBody.pose.pitch = 0;
  playerBody.pose.yaw = 0;
  resetPositions();
  goLive();
  match.phaseLeft = ROUND_SECONDS;
  if (name === 'start') {
    playerBody.pose.position.set(0, 0, 14.5);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.showOverlay('start');
  } else if (name === 'play') {
    // Push two Cinder bots into the trench lane, in view, and trade shots with one.
    const enemy = squads.enemies[1];
    enemy.fighter.pose.position.set(1.5, 0, -4);
    enemy.fighter.pose.yaw = 0;
    const enemy2 = squads.enemies[0];
    enemy2.fighter.pose.position.set(-6, 0, -6);
    enemy2.fighter.pose.yaw = Math.PI / 4;
    playerBody.pose.position.set(0, 0, 6);
    settle(20);
    const target = new THREE.Vector3();
    enemy.eye(target);
    target.y -= 0.4; // aim at the torso, so two hits wound instead of killing
    aimAt(target);
    playerShoot();
    settle(6);
    aimAt(target);
    playerShoot();
    settle(4);
    hud.hitMarker(false);
  } else {
    // Round won at Kiln: the charge is planted, the fuse is running.
    match.charge.state = 'planted';
    match.charge.siteKey = 'A';
    match.charge.siteCenter = yard.sites.A.center;
    match.charge.fuseLeft = 22;
    chargeMesh.position.copy(yard.sites.A.center);
    chargeMesh.position.y = 0.35;
    chargeMesh.visible = true;
    playerBody.pose.position.set(-8, 0, -4);
    settle(20);
    aimAt(new THREE.Vector3(-15, 1.2, -11));
    match.round = 3;
    match.score.sentinel = 2;
    match.score.cinder = 1;
    endRound('sentinel', 'Charge detonated');
    match.phase = 'live';
    hud.showOverlay('round', 'Sentinel takes round 3 — Charge detonated');
  }
  syncHud();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

resetPositions();
hud.setAmmo(viewGun.state.mag, viewGun.state.reserve);
hud.setScore(0, 0);
hud.showBuy(true, match.money, match.owned, match.grenades, match.vest);
syncCamera();

// A small read-only handle for live testing: round state, the player, both squads.
window.__cinder = {
  match,
  player,
  allies: squads.allies,
  enemies: squads.enemies,
};

if (shot) runShot(shot);
else requestAnimationFrame(frame);
