// CINDERFALL — controls: keyboard, mouse and pointer lock, plain browser APIs only.
// The game asks the canvas for pointer lock and reads movementX/Y while it holds it.
// Most keys are level reads (held down), but a few are one-shot actions — buy menu,
// grenade, weapon slots — so those are kept in a pressed queue the simulation drains
// once per fixed step, and a key held down never fires twice.
export function makeInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = [];
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };
  const ONE_SHOT = new Set(['KeyB', 'KeyG', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']);

  function setKey(event, down) {
    if (down) {
      if (!keys.has(event.code) && ONE_SHOT.has(event.code)) pressed.push(event.code);
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    takePressed() {
      if (pressed.length === 0) return [];
      const out = pressed.slice();
      pressed.length = 0;
      return out;
    },
  };
}
