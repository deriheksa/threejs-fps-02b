// CINDERFALL — the bots: one fighter body, one box-built soldier, one small brain.
// A bot walks a lane, holds a post, and scans for enemies on a staggered timer so
// four bots never raycast on the same frame. When it spots an enemy it reacts after
// a human-ish delay, then fires in bursts while strafing. Gunfire it hears becomes
// a place to hunt. After a plant, the nearest Cinder bot walks to the site and
// channels a defuse while the rest converge; Sentinel bots shadow the player and
// defend a planted charge.
//
// Shape note for the shooter: the wrapper returned here exposes `fighter` (the body)
// and `hitMeshes` (the torso and head meshes). The meshes' userData points at the
// inner state object, and that state object carries `damageFn`, so a ray hit can
// hurt the bot through the very object the meshes reference.
import * as THREE from 'three';
import { makeBody } from './body.js';
import { THEME } from './theme.js';
import { GUNS } from './guns.js';

const SCAN_EVERY = 0.15;
const SIGHT_RANGE = 46;
const HEAR_RANGE = 28;
const DEFUSE_SECONDS = 5;

const CINDER_NAMES = ['Ash', 'Coal', 'Flint', 'Smolder'];
const SENTINEL_NAMES = ['Rook', 'Sable'];

export function makeBot(scene, yard, side, index, start, rng) {
  const isCinder = side === 'cinder';
  const name = isCinder
    ? CINDER_NAMES[index % CINDER_NAMES.length]
    : SENTINEL_NAMES[index % SENTINEL_NAMES.length];
  const gunKey = isCinder
    ? ['carbine', 'hornet', 'carbine', 'scatter'][index % 4]
    : ['carbine', 'hornet'][index % 2];
  const gun = GUNS[gunKey];

  const fighter = makeBody(yard.solids, start);
  // South spawn (Sentinel) looks north: yaw 0. North spawn (Cinder) looks south: yaw PI.
  fighter.pose.yaw = isCinder ? Math.PI : 0;

  // The soldier: legs, torso, head and a gun, coloured by team. Torso and head are
  // the hit meshes; their userData says what a ray struck and who it struck.
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color(isCinder ? THEME.enemy : THEME.ally), roughness: 0.8, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#211a14'), roughness: 0.7, metalness: 0.2 });
  const visor = new THREE.MeshStandardMaterial({ color: new THREE.Color(THEME.rustBright), roughness: 0.3, metalness: 0.4 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.32), suit);
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), dark);
  head.position.y = 1.6;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.05), visor);
  strip.position.set(0, 1.62, -0.16);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), dark);
  legL.position.set(-0.14, 0.35, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), dark);
  legR.position.set(0.14, 0.35, 0);
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.62), dark);
  weapon.position.set(0.28, 1.15, -0.3);
  group.add(torso, head, strip, legL, legR, weapon);
  group.position.copy(start);
  scene.add(group);

  const hitMeshes = [torso, head];

  // The inner state: everything the brain and the shooter need, in one object.
  const state = {
    fighter,
    mesh: group,
    hitMeshes,
    side,
    name,
    gunKey,
    gun,
    hp: 100,
    vest: 0,
    alive: true,
    lane: null,
    laneIndex: 0,
    laneSite: 'A',
    post: null,
    shadow: new THREE.Vector3(),
    target: null,
    reactAt: 0,
    burstLeft: 0,
    pauseUntil: 0,
    cooldown: 0,
    scanAt: rng() * SCAN_EVERY,
    strafeDir: rng() > 0.5 ? 1 : -1,
    strafeAt: 0,
    heard: null,
    defuseLeft: 0,
    // Stuck watch: if the bot keeps trying to walk but barely moves, it sidesteps
    // around the cover instead of pushing into it forever.
    progressAt: 0,
    markX: start.x,
    markZ: start.z,
    sidestepUntil: 0,
    sideDir: 1,
  };
  torso.userData.hit = { bot: state, part: 'body' };
  head.userData.hit = { bot: state, part: 'head' };

  const eyeSelf = new THREE.Vector3();
  const eyeOther = new THREE.Vector3();
  const aimPoint = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const drive = { forward: 0, strafe: 0, jump: false, crouch: false };

  function reset(startPos) {
    state.hp = 100;
    state.vest = 0;
    state.alive = true;
    state.lane = null;
    state.laneIndex = 0;
    state.post = null;
    state.target = null;
    state.reactAt = 0;
    state.burstLeft = 0;
    state.pauseUntil = 0;
    state.cooldown = 0;
    state.heard = null;
    state.defuseLeft = 0;
    state.progressAt = 0;
    state.markX = startPos.x;
    state.markZ = startPos.z;
    state.sidestepUntil = 0;
    fighter.pose.position.copy(startPos);
    fighter.pose.velocity.set(0, 0, 0);
    fighter.pose.yaw = isCinder ? Math.PI : 0;
    fighter.pose.pitch = 0;
    group.position.copy(startPos);
    group.rotation.set(0, fighter.pose.yaw, 0);
    group.visible = true;
  }

  function damage(amount) {
    if (!state.alive) return false;
    let left = amount;
    if (state.vest > 0) {
      const soaked = Math.min(state.vest, left * 0.5);
      state.vest -= soaked;
      left -= soaked;
    }
    state.hp -= left;
    if (state.hp <= 0) {
      state.hp = 0;
      state.alive = false;
      group.rotation.set(0, fighter.pose.yaw, Math.PI / 2);
      group.position.y = 0.25;
      return true;
    }
    return false;
  }
  // The hit meshes reference `state`, so the damage function lives on `state` too.
  state.damageFn = damage;

  function slot() {
    return isCinder ? CINDER_NAMES.indexOf(name) : SENTINEL_NAMES.indexOf(name);
  }

  // Face a point on the ground, then walk forward toward it. Returns the distance.
  function walkToward(point, pace = 1) {
    const dx = point.x - fighter.pose.position.x;
    const dz = point.z - fighter.pose.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return 0;
    fighter.pose.yaw = Math.atan2(-dx, -dz);
    drive.forward = pace;
    drive.strafe = 0;
    return dist;
  }

  function scan(world) {
    state.target = null;
    const eyePos = fighter.eyePosition(eyeSelf);
    let best = null;
    let bestDist = SIGHT_RANGE;
    for (const other of world.fighters) {
      if (!other.alive || other.side === side) continue;
      const otherEye = other.eye(eyeOther);
      const dist = eyePos.distanceTo(otherEye);
      if (dist > bestDist) continue;
      if (!world.losClear(eyePos, otherEye)) continue;
      best = other;
      bestDist = dist;
    }
    if (best) {
      state.target = best;
      if (state.reactAt === 0) state.reactAt = world.time + 0.45 + rng() * 0.4;
    } else {
      state.reactAt = 0;
    }
  }

  function shootAt(world) {
    if (!state.target || !state.target.alive) return;
    if (world.time < state.reactAt) return;
    if (world.time < state.pauseUntil) return;
    if (state.cooldown > 0) return;
    const targetEye = state.target.eye(eyeOther);
    const from = fighter.eyePosition(new THREE.Vector3());
    const dist = from.distanceTo(targetEye);
    const goHead = rng() < 0.25;
    aimPoint.copy(targetEye);
    aimPoint.y += goHead ? 0.32 : -0.25;
    // Aim error grows with range and with how fast the target moves.
    const error = 0.05 + dist * 0.004 + state.target.speed() * 0.012;
    aimPoint.x += (rng() * 2 - 1) * error * dist * 0.5;
    aimPoint.y += (rng() * 2 - 1) * error * dist * 0.4;
    aimPoint.z += (rng() * 2 - 1) * error * dist * 0.5;
    toTarget.copy(aimPoint).sub(from).normalize();
    world.fireShot(state, from, toTarget, state.gun, goHead);
    state.cooldown = state.gun.gap * (1 + rng() * 0.3);
    state.burstLeft -= 1;
    if (state.burstLeft <= 0) {
      state.pauseUntil = world.time + 0.7 + rng() * 0.6;
      state.burstLeft = 3 + Math.floor(rng() * 3);
    }
  }

  function update(dt, world) {
    if (!state.alive) return;
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.scanAt -= dt;
    if (state.scanAt <= 0) {
      state.scanAt = SCAN_EVERY;
      scan(world);
    }
    // A recent gunshot nearby becomes a place to hunt.
    if (!state.target) {
      for (const noise of world.noises) {
        if (world.time - noise.at > 1.5) continue;
        if (fighter.pose.position.distanceTo(noise.pos) < HEAR_RANGE) {
          state.heard = noise.pos;
          break;
        }
      }
    }

    drive.forward = 0;
    drive.strafe = 0;
    drive.jump = false;
    drive.crouch = false;

    const charge = world.charge;
    if (isCinder && charge.state === 'planted') {
      // The closest Cinder bot defuses; the rest push the site.
      const site = charge.siteCenter;
      const dist = fighter.pose.position.distanceTo(site);
      if (world.defuser === state) {
        if (dist < 2.5) {
          state.defuseLeft -= dt;
          if (state.defuseLeft <= 0) world.onDefused(state);
        } else {
          walkToward(site);
        }
      } else if (dist > 6) {
        walkToward(site);
      } else {
        walkToward(yard.posts[charge.siteKey][slot() % 3], 0.5);
      }
    } else if (state.target) {
      // Engage: face the target, strafe, close or open the distance.
      const targetEye = state.target.eye(eyeOther);
      const from = fighter.eyePosition(new THREE.Vector3());
      const dx = targetEye.x - from.x;
      const dz = targetEye.z - from.z;
      fighter.pose.yaw = Math.atan2(-dx, -dz);
      const dist = Math.hypot(dx, dz);
      if (world.time > state.strafeAt) {
        state.strafeAt = world.time + 0.8 + rng() * 0.8;
        state.strafeDir = rng() > 0.5 ? 1 : -1;
      }
      drive.strafe = state.strafeDir * 0.7;
      drive.forward = dist > 20 ? 0.5 : dist < 6 ? -0.4 : 0;
      if (state.burstLeft === 0 && world.time >= state.pauseUntil) {
        state.burstLeft = 3 + Math.floor(rng() * 3);
      }
      shootAt(world);
    } else if (!isCinder && charge.state === 'planted') {
      const site = charge.siteCenter;
      if (fighter.pose.position.distanceTo(site) > 5) walkToward(site, 0.8);
      else walkToward(yard.posts[charge.siteKey][slot() % 3], 0.4);
    } else if (!isCinder) {
      // Sentinel bots shadow the player at an offset, and fight what they see.
      const anchor = world.player.fighter.pose.position;
      const goalX = anchor.x + state.shadow.x;
      const goalZ = anchor.z + state.shadow.z;
      const dx = goalX - fighter.pose.position.x;
      const dz = goalZ - fighter.pose.position.z;
      if (Math.hypot(dx, dz) > 3.5) {
        walkToward({ x: goalX, z: goalZ }, 0.85);
      } else {
        fighter.pose.yaw = world.player.fighter.pose.yaw;
      }
    } else if (state.heard) {
      const dist = walkToward(state.heard, 0.9);
      if (dist < 1.5) state.heard = null;
    } else if (state.lane) {
      const point = state.lane[state.laneIndex];
      const dist = walkToward(point, 0.85);
      if (dist < 1.3) {
        state.laneIndex += 1;
        if (state.laneIndex >= state.lane.length) {
          state.lane = null;
          state.post = yard.posts[state.laneSite][slot() % 3];
        }
      }
    } else if (state.post) {
      const dist = walkToward(state.post, 0.6);
      if (dist < 1.0) {
        // Hold: face the lane the route came down.
        fighter.pose.yaw = isCinder ? Math.PI : 0;
      }
    }

    // Sidestepping around cover overrides the strafe the mode logic set.
    if (world.time < state.sidestepUntil) drive.strafe = state.sideDir;

    fighter.step(dt, null, drive);
    group.position.copy(fighter.pose.position);
    group.rotation.y = fighter.pose.yaw;

    // Stuck watch: walking hard but not getting anywhere means a crate or wall
    // is in the way — sidestep for a moment, then try the route again.
    if (drive.forward > 0.3) {
      if (world.time - state.progressAt > 0.5) {
        const moved = Math.hypot(fighter.pose.position.x - state.markX, fighter.pose.position.z - state.markZ);
        if (moved < 0.2) {
          state.sidestepUntil = world.time + 0.8;
          state.sideDir = -state.sideDir;
        }
        state.markX = fighter.pose.position.x;
        state.markZ = fighter.pose.position.z;
        state.progressAt = world.time;
      }
    } else {
      state.progressAt = world.time;
      state.markX = fighter.pose.position.x;
      state.markZ = fighter.pose.position.z;
    }
  }

  return {
    state, fighter, hitMeshes, reset, damage, update,
    get alive() { return state.alive; },
    get hp() { return state.hp; },
    get name() { return name; },
    get side() { return side; },
    eye(out) {
      return fighter.eyePosition(out);
    },
    speed() {
      return fighter.speed();
    },
  };
}

// Build the two squads for a round: two Sentinel allies and four Cinder enemies.
export function makeSquads(scene, yard, rng) {
  const allies = [];
  const enemies = [];
  for (let i = 0; i < 2; i += 1) {
    allies.push(makeBot(scene, yard, 'sentinel', i, yard.spawns.sentinel[i + 1], rng));
  }
  for (let i = 0; i < 4; i += 1) {
    enemies.push(makeBot(scene, yard, 'cinder', i, yard.spawns.cinder[i], rng));
  }
  return { allies, enemies };
}

export { DEFUSE_SECONDS };
