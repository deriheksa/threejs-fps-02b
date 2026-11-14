// CINDERFALL — the map: "Slagworks Yard", a 44 x 36 m industrial yard.
// North is -z. Sentinels spawn in the south and push north; the Cinder crew spawns
// in the north and holds. Three lanes cross the yard: Kiln Row along the west wall,
// the slag trench through the middle, and Depot Alley along the east wall.
// Every solid block is registered twice: once as a collision box fighters bump into,
// once as a mesh a bullet can strike — so cover always works both ways.
import * as THREE from 'three';
import { THEME } from './theme.js';

const HALF_W = 22;
const HALF_D = 18;
const FENCE_H = 5;

export function buildYard(scene) {
  const yard = new THREE.Group();
  scene.add(yard);

  const paint = {};
  for (const key of ['floor', 'wall', 'steel', 'steelDark', 'rust', 'crate', 'crateDark']) {
    paint[key] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(THEME[key]),
      roughness: key === 'rust' ? 0.55 : 0.92,
      metalness: key === 'steel' || key === 'steelDark' ? 0.35 : 0.05,
    });
  }

  const solids = []; // Box3 list for movement collision
  const targets = []; // meshes a bullet ray can hit

  function block(w, h, d, x, y, z, colour) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), paint[colour]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    yard.add(mesh);
    solids.push(new THREE.Box3().setFromObject(mesh));
    targets.push(mesh);
    return mesh;
  }

  // Ground slab and the four perimeter fences.
  block(HALF_W * 2 + 1, 0.4, HALF_D * 2 + 1, 0, -0.2, 0, 'floor');
  block(0.6, FENCE_H, HALF_D * 2 + 1, -HALF_W - 0.3, FENCE_H / 2, 0, 'wall');
  block(0.6, FENCE_H, HALF_D * 2 + 1, HALF_W + 0.3, FENCE_H / 2, 0, 'wall');
  block(HALF_W * 2 + 1, FENCE_H, 0.6, 0, FENCE_H / 2, -HALF_D - 0.3, 'wall');
  block(HALF_W * 2 + 1, FENCE_H, 0.6, 0, FENCE_H / 2, HALF_D + 0.3, 'wall');

  // Site A "Kiln", west-north: a rusted kiln drum, a low retaining wall, crate cover.
  block(3.6, 3.4, 3.6, -17.8, 1.7, -14.8, 'rust');
  block(1.5, 1.5, 1.5, -12.2, 0.75, -13.8, 'crate');
  block(1.5, 1.5, 1.5, -12.2, 0.75, -11.0, 'crate');
  block(1.5, 3.0, 1.5, -13.8, 1.5, -12.4, 'crateDark');
  block(5.2, 1.0, 0.9, -15.2, 0.5, -7.2, 'steelDark');
  block(2.4, 1.0, 2.4, -18.6, 0.5, -6.2, 'crate');

  // Site B "Depot", east-north: two stacked shipping boxes and a crate nest.
  block(6.2, 2.5, 2.5, 17.4, 1.25, -14.8, 'steel');
  block(6.2, 2.5, 2.5, 17.4, 3.75, -14.8, 'steelDark');
  block(1.5, 1.5, 1.5, 12.2, 0.75, -13.2, 'crate');
  block(1.5, 1.5, 1.5, 12.2, 0.75, -10.4, 'crateDark');
  block(5.2, 1.0, 0.9, 15.2, 0.5, -6.8, 'steelDark');
  block(2.4, 1.0, 2.4, 10.6, 0.5, -5.8, 'crate');

  // The slag trench: a staggered pair of steel boxes that splits mid into two gaps.
  block(2.6, 2.6, 6.4, -3.2, 1.3, -0.6, 'steelDark');
  block(2.6, 2.6, 6.4, 3.2, 1.3, -0.6, 'steel');
  block(1.5, 1.5, 1.5, 0, 0.75, -6.8, 'crate');
  block(1.5, 3.0, 1.5, -6.8, 1.5, 4.0, 'crateDark');
  block(1.5, 1.5, 1.5, 6.8, 0.75, 4.0, 'crate');

  // Lane cover: low walls on both flanks and crates on the south approach.
  block(0.9, 1.2, 5.2, -19.2, 0.6, 3.0, 'steelDark');
  block(0.9, 1.2, 5.2, 19.2, 0.6, 3.0, 'steelDark');
  block(2.6, 1.0, 1.3, -9.2, 0.5, 8.8, 'crate');
  block(2.6, 1.0, 1.3, 9.2, 0.5, 8.8, 'crate');
  block(1.5, 1.5, 1.5, -14.2, 0.75, 6.2, 'crateDark');
  block(1.5, 1.5, 1.5, 14.2, 0.75, 6.2, 'crate');
  block(3.2, 1.2, 1.1, -4.2, 0.6, 12.4, 'steelDark');
  block(3.2, 1.2, 1.1, 4.2, 0.6, 12.4, 'steelDark');

  // Glowing site rings so the objective reads at a glance from spawn.
  function ring(x, z) {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.4, 0.06, 28),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(THEME.rustBright), transparent: true, opacity: 0.2 }),
    );
    disc.position.set(x, 0.04, z);
    yard.add(disc);
    const beacon = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 2.8, 0.28),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(THEME.rustBright) }),
    );
    beacon.position.set(x, 1.4, z);
    yard.add(beacon);
  }
  ring(-15, -11);
  ring(15, -11);

  // Cold dusk lighting: a low amber key from the west, a cool fill from the east.
  scene.add(new THREE.HemisphereLight(new THREE.Color('#8a97a3'), new THREE.Color(THEME.sky), 1.6));
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 3.2);
  sun.position.set(-16, 15, 9);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#6e86a8'), 0.9);
  fill.position.set(13, 11, 13);
  scene.add(fill);

  const sites = {
    A: { label: 'Kiln', center: new THREE.Vector3(-15, 0, -11), radius: 3.4 },
    B: { label: 'Depot', center: new THREE.Vector3(15, 0, -11), radius: 3.4 },
  };
  const spawns = {
    sentinel: [
      new THREE.Vector3(0, 0, 14.5),
      new THREE.Vector3(-3.5, 0, 15.0),
      new THREE.Vector3(3.5, 0, 15.0),
    ],
    cinder: [
      new THREE.Vector3(-6, 0, -14.5),
      new THREE.Vector3(0, 0, -15.0),
      new THREE.Vector3(6, 0, -14.5),
      new THREE.Vector3(-13, 0, -13.0),
    ],
  };
  const lanes = {
    kilnRow: [
      new THREE.Vector3(-19, 0, 6), new THREE.Vector3(-19, 0, -3),
      new THREE.Vector3(-17, 0, -8), new THREE.Vector3(-15, 0, -11),
    ],
    trench: [
      new THREE.Vector3(0, 0, 6), new THREE.Vector3(0, 0, -4),
      new THREE.Vector3(-1, 0, -9), new THREE.Vector3(0, 0, -12),
    ],
    depotAlley: [
      new THREE.Vector3(19, 0, 6), new THREE.Vector3(19, 0, -3),
      new THREE.Vector3(17, 0, -8), new THREE.Vector3(15, 0, -11),
    ],
  };
  const posts = {
    A: [new THREE.Vector3(-12, 0, -13), new THREE.Vector3(-18, 0, -8), new THREE.Vector3(-13, 0, -7)],
    B: [new THREE.Vector3(12, 0, -13), new THREE.Vector3(18, 0, -8), new THREE.Vector3(13, 0, -7)],
    mid: [new THREE.Vector3(-6, 0, -4), new THREE.Vector3(6, 0, -4), new THREE.Vector3(0, 0, 8)],
  };

  return { solids, targets, group: yard, sites, spawns, lanes, posts };
}
