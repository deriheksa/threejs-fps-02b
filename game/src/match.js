// CINDERFALL — the match: rounds, the charge, and the money.
// A match is first to 5 round wins, at most 9 rounds. A round has three phases:
// buy (the shop is open, the clock is short), live (100 seconds, plant or
// eliminate), and over (a short banner, then the next buy). The charge is carried
// by the player; planting it starts a 35-second fuse, and the round ends on
// elimination, detonation, a defuse, or the clock running out with no plant.
import { SHOP } from './guns.js';

export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
export const BUY_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const FUSE_SECONDS = 35;
export const PLANT_SECONDS = 3;

export const PRIZES = { kill: 300, roundWin: 900, roundLoss: 600, plant: 300 };

export function makeMatch() {
  const match = {
    round: 1,
    phase: 'buy',
    phaseLeft: BUY_SECONDS,
    score: { sentinel: 0, cinder: 0 },
    money: 800,
    kills: 0,
    deaths: 0,
    owned: { sidearm: true },
    grenades: 0,
    vest: 0,
    charge: {
      state: 'carried', // carried | planted | defused | detonated | lost
      siteKey: null,
      siteCenter: null,
      fuseLeft: 0,
      plantLeft: 0,
    },
    lastReason: '',
    over: false,
    winner: null,
  };

  function startRound() {
    match.phase = 'buy';
    match.phaseLeft = BUY_SECONDS;
    match.charge.state = 'carried';
    match.charge.siteKey = null;
    match.charge.siteCenter = null;
    match.charge.fuseLeft = 0;
    match.charge.plantLeft = 0;
    match.lastReason = '';
  }

  function goLive() {
    match.phase = 'live';
    match.phaseLeft = ROUND_SECONDS;
  }

  function endRound(winner, reason) {
    if (match.phase === 'over') return;
    match.phase = 'over';
    match.phaseLeft = 4;
    match.score[winner] += 1;
    match.money += winner === 'sentinel' ? PRIZES.roundWin : PRIZES.roundLoss;
    match.lastReason = reason;
    if (match.score.sentinel >= WIN_ROUNDS || match.score.cinder >= WIN_ROUNDS || match.round >= MAX_ROUNDS) {
      match.over = true;
      match.winner = match.score.sentinel > match.score.cinder ? 'sentinel' : 'cinder';
    }
  }

  function nextRound() {
    match.round += 1;
    startRound();
  }

  function buy(itemId) {
    const item = SHOP.find((row) => row.id === itemId);
    if (!item) return { ok: false, why: 'no such item' };
    if (match.phase !== 'buy') return { ok: false, why: 'the shop is closed' };
    if (item.kind === 'gun' && match.owned[item.id]) return { ok: false, why: 'already owned' };
    if (item.kind === 'grenade' && match.grenades >= 2) return { ok: false, why: 'carrying two already' };
    if (item.kind === 'vest' && match.vest >= 50) return { ok: false, why: 'vest is full' };
    if (match.money < item.cost) return { ok: false, why: 'not enough money' };
    match.money -= item.cost;
    if (item.kind === 'gun') match.owned[item.id] = true;
    if (item.kind === 'grenade') match.grenades += 1;
    if (item.kind === 'vest') match.vest = 50;
    return { ok: true, item };
  }

  function addKill() {
    match.kills += 1;
    match.money += PRIZES.kill;
  }

  return { match, startRound, goLive, endRound, nextRound, buy, addKill };
}
