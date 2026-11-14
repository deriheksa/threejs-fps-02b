// CINDERFALL — one body shared by the player and every bot.
// Movement is acceleration with ground friction, gravity, a jump and a crouch. The
// body is a vertical box (a radius around the feet, a height that shrinks when
// crouched) and it is resolved against the yard's solids one axis at a time, so a
// wall stops a fighter without ever swallowing one. Yaw 0 looks along -z (north).
import * as THREE from 'three';
import { clamp } from './util.js';

const RADIUS = 0.34;
const STAND_H = 1.74;
const CROUCH_H = 1.1;
const STAND_EYE = 1.62;
const CROUCH_EYE = 1.0;
const SPRINT = 5.4;
const CROUCH_V = 2.5;
const GROUND_ACCEL = 40;
const AIR_ACCEL = 10;
const FRICTION = 9.5;
const GRAVITY = 21;
const JUMP_V = 6.4;

export function makeBody(solids, start) {
  const pose = {
    position: start.clone(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    height: STAND_H,
    crouched: false,
    grounded: true,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // Would a body box at (x, y, z) touch any solid? `trim` shaves the box's bottom
  // and top so standing on the floor never reads as walking into a wall.
  function hitsSolid(x, y, z, height, trim) {
    probe.min.set(x - RADIUS, y + trim, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - trim, z + RADIUS);
    for (let i = 0; i < solids.length; i += 1) {
      if (probe.intersectsBox(solids[i])) return solids[i];
    }
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    pose.yaw -= dx * sensitivity;
    pose.pitch = clamp(pose.pitch - dy * sensitivity, -1.45, 1.45);
  }

  function recoil(pitchUp, yawSide) {
    pose.pitch = Math.min(1.45, pose.pitch + pitchUp);
    pose.yaw += yawSide;
  }

  // `keys` is a Set of event.code strings for the player; `drive` lets a bot steer
  // the same body with {forward, strafe, jump, crouch} instead of a keyboard.
  function step(dt, keys, drive) {
    const wantCrouch = drive
      ? drive.crouch
      : keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !pose.crouched) {
      pose.crouched = true;
      pose.height = CROUCH_H;
    } else if (!wantCrouch && pose.crouched) {
      if (!hitsSolid(pose.position.x, pose.position.y, pose.position.z, STAND_H, 0.02)) {
        pose.crouched = false;
        pose.height = STAND_H;
      }
    }
    const eyeGoal = pose.crouched ? CROUCH_EYE : STAND_EYE;
    pose.eye += (eyeGoal - pose.eye) * Math.min(1, dt * 12);

    let forward = 0;
    let strafe = 0;
    if (drive) {
      forward = drive.forward || 0;
      strafe = drive.strafe || 0;
    } else {
      forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    }
    wish.set(0, 0, 0);
    if (forward !== 0 || strafe !== 0) {
      const sin = Math.sin(pose.yaw);
      const cos = Math.cos(pose.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe);
      wish.normalize();
    }

    const top = pose.crouched ? CROUCH_V : SPRINT;
    const pull = pose.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const blend = Math.min(1, (pull * dt) / top);
    pose.velocity.x += (wish.x * top - pose.velocity.x) * blend;
    pose.velocity.z += (wish.z * top - pose.velocity.z) * blend;
    if (pose.grounded && wish.lengthSq() === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      pose.velocity.x *= damp;
      pose.velocity.z *= damp;
    }

    if ((drive ? drive.jump : keys.has('Space')) && pose.grounded) {
      pose.velocity.y = JUMP_V;
      pose.grounded = false;
    }
    pose.velocity.y -= GRAVITY * dt;

    const nextX = pose.position.x + pose.velocity.x * dt;
    if (!hitsSolid(nextX, pose.position.y, pose.position.z, pose.height, 0.04)) {
      pose.position.x = nextX;
    } else {
      pose.velocity.x = 0;
    }
    const nextZ = pose.position.z + pose.velocity.z * dt;
    if (!hitsSolid(pose.position.x, pose.position.y, nextZ, pose.height, 0.04)) {
      pose.position.z = nextZ;
    } else {
      pose.velocity.z = 0;
    }

    pose.position.y += pose.velocity.y * dt;
    pose.grounded = false;
    const floor = hitsSolid(pose.position.x, pose.position.y, pose.position.z, pose.height, 0);
    if (floor && pose.velocity.y <= 0) {
      pose.position.y = floor.max.y;
      pose.velocity.y = 0;
      pose.grounded = true;
    } else if (floor) {
      pose.position.y = floor.min.y - pose.height;
      pose.velocity.y = 0;
    }
    if (pose.position.y < 0) {
      pose.position.y = 0;
      pose.velocity.y = 0;
      pose.grounded = true;
    }
    pose.velocity.y = Math.max(-32, pose.velocity.y);
  }

  return {
    pose,
    step,
    look,
    recoil,
    speed() {
      return Math.hypot(pose.velocity.x, pose.velocity.z);
    },
    eyePosition(out) {
      out.set(pose.position.x, pose.position.y + pose.eye, pose.position.z);
      return out;
    },
  };
}
