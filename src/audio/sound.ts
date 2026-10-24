// WebAudio: ball rattle, pocket chimes, reel ticks and stops, and the
// jackpot fanfare, all synthesised (no sample files). Plays the cues
// audio/cues.ts collects.
//
// No AudioContext exists until the first user interaction (M6 acceptance):
// browsers refuse to start audio before one, and a page that makes no sound
// until it is touched is the polite default anyway. bindUnlock creates the
// context from inside that first gesture's handler. Until then, play()
// drops its cues: nothing queues up to blare out on the first click.

import type { ChimePocket, Cue } from './cues';

/** Overall level into the speakers. Each voice's level is relative to it. */
export const MASTER_GAIN = 0.5;
/** Rattle level at RATTLE_FULL_SPEED_MPS and above; slower impacts are quieter. */
const RATTLE_GAIN = 0.35;
const RATTLE_FULL_SPEED_MPS = 1.5;
/** Length of the white-noise burst a rattle is cut from. */
const NOISE_S = 0.05;

/** Bell partials per pocket, Hz: the tulips ring lowest, the attacker brightest. */
const CHIME_HZ: Record<ChimePocket, readonly number[]> = {
  start: [1318.5, 1975.5, 2637],
  tulip: [1046.5, 1568, 2093],
  attacker: [1568, 2349.3, 3136],
};
/** Fanfare: a rising C-major arpeggio, then the top chord held. */
const FANFARE_HZ = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
const FANFARE_STEP_S = 0.09;

export interface AudioHost {
  /** Make the context. Only ever called from a user gesture's handler, at most once. */
  createContext(): AudioContext;
}

export interface Sound {
  /** True once the first interaction has created the audio context. */
  readonly unlocked: boolean;
  readonly muted: boolean;
  /** Create the audio context (once) and resume it. Call from a user gesture. */
  unlock(): void;
  setMuted(muted: boolean): void;
  /** Sound the cues now. Dropped while locked or muted. */
  play(cues: readonly Cue[]): void;
}

export function createSound(host: AudioHost, options: { muted?: boolean } = {}): Sound {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let muted = options.muted ?? false;

  const applyMute = (): void => {
    if (ctx && master) master.gain.setValueAtTime(muted ? 0 : MASTER_GAIN, ctx.currentTime);
  };

  return {
    get unlocked() {
      return ctx !== null;
    },
    get muted() {
      return muted;
    },
    unlock() {
      if (!ctx) {
        ctx = host.createContext();
        master = ctx.createGain();
        master.connect(ctx.destination);
        noise = makeNoise(ctx);
        applyMute();
      }
      if (ctx.state === 'suspended') void ctx.resume();
    },
    setMuted(value) {
      muted = value;
      applyMute();
    },
    play(cues) {
      if (!ctx || !master || !noise || muted || ctx.state !== 'running') return;
      const voice = { ctx, out: master, noise, t: ctx.currentTime };
      for (const cue of cues) {
        switch (cue.kind) {
          case 'rattle':
            rattle(voice, cue.speedMps);
            break;
          case 'chime':
            chime(voice, CHIME_HZ[cue.pocket]);
            break;
          case 'reel-tick':
            tone(voice, 'square', 1800, voice.t, 0.012, 0.03);
            break;
          case 'reel-stop':
            tone(voice, 'triangle', 330, voice.t, 0.09, 0.25);
            break;
          case 'fanfare':
            fanfare(voice);
            break;
        }
      }
    },
  };
}

/**
 * Unlock on the first pointer, touch, or key press anywhere, then stop
 * listening. Capture phase, so a handler that stops propagation can't keep
 * the sound locked. Returns an unbind function.
 */
export function bindUnlock(target: EventTarget, sound: Pick<Sound, 'unlock'>): () => void {
  // An abort signal removes all three at once (and, unlike a matching
  // removeEventListener call, also works on Node's EventTarget in tests).
  const listening = new AbortController();
  const unbind = (): void => listening.abort();
  const unlock = (): void => {
    sound.unlock();
    unbind();
  };
  for (const type of ['pointerdown', 'touchend', 'keydown']) {
    target.addEventListener(type, unlock, { capture: true, signal: listening.signal });
  }
  return unbind;
}

interface Voice {
  readonly ctx: AudioContext;
  readonly out: AudioNode;
  readonly noise: AudioBuffer;
  /** Start time, the context's clock, s. */
  readonly t: number;
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(NOISE_S * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A gain node that strikes to `peak` at `t` and decays exponentially over `decayS`. */
function envelope(v: Voice, t: number, decayS: number, peak: number): GainNode {
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decayS);
  g.connect(v.out);
  return g;
}

function tone(
  v: Voice,
  type: OscillatorType,
  hz: number,
  t: number,
  decayS: number,
  peak: number,
): void {
  const osc = v.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, t);
  osc.connect(envelope(v, t, decayS, peak));
  osc.start(t);
  osc.stop(t + decayS);
}

/** Steel on brass: a few milliseconds of band-passed noise, its pitch varied so repeats don't buzz. */
function rattle(v: Voice, speedMps: number): void {
  const level = Math.min(1, speedMps / RATTLE_FULL_SPEED_MPS);
  const src = v.ctx.createBufferSource();
  src.buffer = v.noise;
  const filter = v.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(3500 + Math.random() * 3000, v.t);
  filter.Q.setValueAtTime(8, v.t);
  src.connect(filter);
  const decayS = 0.02 + 0.02 * level;
  filter.connect(envelope(v, v.t, decayS, RATTLE_GAIN * level * level));
  src.start(v.t);
  src.stop(v.t + decayS);
}

function chime(v: Voice, partialsHz: readonly number[]): void {
  partialsHz.forEach((hz, i) => tone(v, 'sine', hz, v.t, 0.7 - 0.15 * i, 0.22 / (i + 1)));
}

function fanfare(v: Voice): void {
  FANFARE_HZ.forEach((hz, i) => {
    const t = v.t + i * FANFARE_STEP_S;
    tone(v, 'square', hz, t, 0.16, 0.08);
    tone(v, 'triangle', hz, t, 0.2, 0.12);
  });
  const chordT = v.t + FANFARE_HZ.length * FANFARE_STEP_S;
  for (const hz of FANFARE_HZ.slice(-3)) {
    tone(v, 'square', hz, chordT, 0.9, 0.06);
    tone(v, 'triangle', hz, chordT, 1.1, 0.1);
  }
}
