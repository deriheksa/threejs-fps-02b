// CINDERFALL — the arsenal: five guns, one grenade, one vest.
// A weapon is a row of numbers. Head damage is its own number per gun (not a global
// multiplier), so each gun has its own headshot identity. The gun the player holds is
// a small box view-model rebuilt from those numbers on every swap, with a muzzle
// flash and a kick that recovers. Spread grows with speed, so standing still to aim
// is always the accurate choice; crouching tightens it further.
import * as THREE from 'three';
import { THEME } from './theme.js';

export const GUNS = {
  sidearm: {
    key: 'sidearm', name: 'P9 Sidearm', price: 0, mag: 12, reserve: 48,
    body: 30, head: 66, gap: 0.16, reload: 1.4,
    spreadStill: 0.003, spreadMove: 0.02, kick: 0.012, auto: false, pellets: 1,
    barrel: 0.16, stock: 0.1,
  },
  carbine: {
    key: 'carbine', name: 'VK-47 Carbine', price: 2000, mag: 30, reserve: 90,
    body: 30, head: 90, gap: 0.1, reload: 2.0,
    spreadStill: 0.0022, spreadMove: 0.026, kick: 0.011, auto: true, pellets: 1,
    barrel: 0.4, stock: 0.22,
  },
  hornet: {
    key: 'hornet', name: 'Hornet SMG', price: 1100, mag: 28, reserve: 112,
    body: 24, head: 48, gap: 0.068, reload: 1.8,
    spreadStill: 0.004, spreadMove: 0.03, kick: 0.008, auto: true, pellets: 1,
    barrel: 0.3, stock: 0.16,
  },
  scatter: {
    key: 'scatter', name: 'Breacher-12', price: 1400, mag: 6, reserve: 24,
    body: 12, head: 24, gap: 0.95, reload: 2.4,
    spreadStill: 0.02, spreadMove: 0.045, kick: 0.03, auto: false, pellets: 6,
    barrel: 0.34, stock: 0.2,
  },
  marksman: {
    key: 'marksman', name: 'Longbow DMR', price: 3200, mag: 8, reserve: 24,
    body: 78, head: 160, gap: 1.05, reload: 2.8,
    spreadStill: 0.0008, spreadMove: 0.035, kick: 0.035, auto: false, pellets: 1,
    barrel: 0.55, stock: 0.26,
  },
};

// The shop, in the order the buy menu shows it. The vest halves incoming damage
// until its 50 points are gone; it is not a weapon.
export const SHOP = [
  { id: 'carbine', label: 'VK-47 Carbine', cost: 2000, kind: 'gun' },
  { id: 'hornet', label: 'Hornet SMG', cost: 1100, kind: 'gun' },
  { id: 'scatter', label: 'Breacher-12', cost: 1400, kind: 'gun' },
  { id: 'marksman', label: 'Longbow DMR', cost: 3200, kind: 'gun' },
  { id: 'ember', label: 'Ember Grenade', cost: 300, kind: 'grenade' },
  { id: 'vest', label: 'Kevlar Vest', cost: 650, kind: 'vest' },
];

export const GRENADE = { price: 300, fuse: 1.6, radius: 4.5, maxDamage: 120, minDamage: 25, throwSpeed: 15 };

// The gun in the player's hands: a view model on the camera, a magazine, a reload
// timer and a muzzle flash. It owns the numbers; boot.js owns the ray and the damage.
export function makeViewGun(camera) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(THEME.line), roughness: 0.7, metalness: 0.25 });
  const pale = new THREE.MeshStandardMaterial({ color: new THREE.Color(THEME.ink), roughness: 0.45, metalness: 0.4 });

  const rig = new THREE.Group();
  rig.position.set(0.26, -0.23, -0.45);
  rig.scale.setScalar(0.72);
  camera.add(rig);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(THEME.rustBright), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.98);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(THEME.rustBright), 0, 6);
  flashLight.position.set(0.24, -0.15, -0.6);
  camera.add(flashLight);

  let def = GUNS.sidearm;
  const state = { mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };

  function rebuild() {
    while (rig.children.length > 0) rig.remove(rig.children[0]);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), pale);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), dark);
    barrel.position.set(0, 0.025, -0.21 - def.barrel / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, def.stock), dark);
    stock.position.set(0, -0.02, 0.21 + def.stock / 2);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.07), dark);
    grip.position.set(0, -0.1, 0.08);
    grip.rotation.x = 0.35;
    rig.add(receiver, barrel, stock, grip);
  }
  rebuild();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    rig.position.z = -0.45 + state.kick;
    rig.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      rig.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    get def() { return def; },
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    fire() {
      state.cooldown = def.gap;
      state.flash = 0.06;
      state.kick = 0.05;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return;
      state.reloadLeft = def.reload;
    },
    spread(speed) {
      return def.spreadStill + Math.min(1, speed / 5.4) * def.spreadMove;
    },
    swap(key) {
      def = GUNS[key];
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      rebuild();
    },
    restock() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}

// A thrown Ember grenade: a dark sphere with gravity, a floor bounce and a fuse.
// When the fuse runs out it is done; boot.js reads the blast and clears it.
export function makeGrenade(scene, origin, direction, fuse = GRENADE.fuse) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#1a1a1a'), roughness: 0.4, metalness: 0.6 }),
  );
  mesh.position.copy(origin);
  scene.add(mesh);
  const velocity = direction.clone().multiplyScalar(GRENADE.throwSpeed);
  velocity.y += 3.5;
  let left = fuse;
  let done = false;

  function step(dt) {
    if (done) return;
    left -= dt;
    velocity.y -= 12 * dt;
    mesh.position.addScaledVector(velocity, dt);
    if (mesh.position.y < 0.1) {
      mesh.position.y = 0.1;
      velocity.y = Math.abs(velocity.y) * 0.4;
      velocity.x *= 0.7;
      velocity.z *= 0.7;
    }
    if (left <= 0) done = true;
  }

  function remove() {
    scene.remove(mesh);
  }

  return { mesh, step, remove, get done() { return done; } };
}

// A blast flash that grows and fades over half a second, then removes itself.
export function makeBlast(scene, position) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(THEME.rustBright), transparent: true, opacity: 0.85, depthWrite: false }),
  );
  mesh.position.copy(position);
  scene.add(mesh);
  const light = new THREE.PointLight(new THREE.Color(THEME.rustBright), 40, 14);
  light.position.copy(position);
  scene.add(light);
  let age = 0;
  let gone = false;

  function step(dt) {
    if (gone) return;
    age += dt;
    const t = age / 0.5;
    mesh.scale.setScalar(1 + t * 8);
    mesh.material.opacity = Math.max(0, 0.85 - t * 0.85);
    light.intensity = Math.max(0, 40 - t * 40);
    if (t >= 1) {
      scene.remove(mesh);
      scene.remove(light);
      gone = true;
    }
  }

  return { step, get gone() { return gone; } };
}
