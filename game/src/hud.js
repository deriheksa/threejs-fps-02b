// CINDERFALL — the HUD: every DOM write the game makes, in one place.
// The simulation never touches the DOM; it calls these setters, and each setter
// skips the write when the value has not changed, so the HUD costs nothing on a
// quiet frame. The kill feed keeps four lines and each fades after six seconds.
import { clockText } from './util.js';

const COPY = {
  start: {
    title: 'CINDERFALL',
    copy: 'Slagworks Yard. Plant the charge at Kiln or Depot, or eliminate the Cinder crew. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'CINDERFALL',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  round: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  match: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function makeHud() {
  const el = (id) => document.getElementById(id);
  const overlay = el('overlay');
  const title = el('overlay-title');
  const copy = el('overlay-copy');
  const play = el('play');
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const healthNum = el('health-num');
  const healthFill = el('health-fill');
  const armorNum = el('armor-num');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const weaponName = el('weapon-name');
  const money = el('money');
  const timer = el('timer');
  const roundLabel = el('round-label');
  const scoreS = el('score-s');
  const scoreC = el('score-c');
  const aliveS = el('alive-s');
  const aliveC = el('alive-c');
  const chargeStatus = el('charge-status');
  const banner = el('banner');
  const killfeed = el('killfeed');
  const buy = el('buy');
  const buyMoney = el('buy-money');
  const buyItems = el('buy-items');
  const plantBar = el('plant-bar');
  const plantFill = el('plant-fill');
  const plantLabel = el('plant-label');

  const last = {};
  let playCallback = null;

  function setText(node, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  }

  play.addEventListener('click', () => {
    if (playCallback) playCallback();
  });

  return {
    onPlay(callback) {
      playCallback = callback;
    },
    setHealth(hp) {
      setText(healthNum, 'hp', String(Math.max(0, Math.ceil(hp))));
      const pct = Math.max(0, Math.min(100, hp));
      if (last.hpPct !== pct) {
        last.hpPct = pct;
        healthFill.style.width = `${pct}%`;
      }
    },
    setArmor(value) {
      setText(armorNum, 'armor', value > 0 ? `+${Math.ceil(value)}` : '');
    },
    setAmmo(mag, reserve) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
    },
    setWeapon(name) {
      setText(weaponName, 'gun', name);
    },
    setMoney(value) {
      setText(money, 'money', `$${value}`);
    },
    setTimer(seconds) {
      setText(timer, 'timer', clockText(seconds));
    },
    setRound(round, max) {
      setText(roundLabel, 'round', `ROUND ${round}/${max}`);
    },
    setScore(s, c) {
      setText(scoreS, 'ss', String(s));
      setText(scoreC, 'sc', String(c));
    },
    setAlive(s, c) {
      setText(aliveS, 'as', '●'.repeat(s) + '○'.repeat(Math.max(0, 3 - s)));
      setText(aliveC, 'ac', '●'.repeat(c) + '○'.repeat(Math.max(0, 4 - c)));
    },
    setCharge(text) {
      setText(chargeStatus, 'charge', text);
    },
    setCrosshairGap(px) {
      const value = `${px.toFixed(1)}px`;
      if (last.gap !== value) {
        last.gap = value;
        crosshair.style.setProperty('--gap', value);
      }
    },
    hitMarker(killed) {
      hitmarker.classList.toggle('kill', killed);
      hitmarker.classList.add('on');
      window.setTimeout(() => hitmarker.classList.remove('on'), killed ? 220 : 120);
    },
    banner(text) {
      setText(banner, 'banner', text);
      banner.classList.toggle('show', text.length > 0);
    },
    feed(text) {
      const line = document.createElement('div');
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      window.setTimeout(() => {
        if (line.parentNode) line.parentNode.removeChild(line);
      }, 6000);
    },
    showOverlay(kind, detail) {
      const row = COPY[kind];
      title.textContent = row.title;
      copy.textContent = detail ?? row.copy;
      play.textContent = row.action;
      overlay.hidden = false;
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    showBuy(open, moneyValue, owned, grenades, vest) {
      buy.hidden = !open;
      if (!open) return;
      setText(buyMoney, 'bmoney', `$${moneyValue}`);
      buyItems.querySelectorAll('[data-item]').forEach((node) => {
        const id = node.getAttribute('data-item');
        const ownedGun = id !== 'ember' && id !== 'vest' && owned[id];
        const ownedNades = id === 'ember' && grenades >= 2;
        const ownedVest = id === 'vest' && vest >= 50;
        node.classList.toggle('owned', Boolean(ownedGun || ownedNades || ownedVest));
        node.classList.toggle('poor', moneyValue < Number(node.getAttribute('data-cost')));
      });
    },
    setPlant(label, fraction) {
      if (fraction <= 0) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      setText(plantLabel, 'plabel', label);
      plantFill.style.width = `${Math.round(fraction * 100)}%`;
    },
  };
}
