// The WebAudio player (M6), against a fake AudioContext that records what
// it was asked to make. Whether it sounds right is the reviewer's ears; this
// checks when sound may happen at all.

import { describe, expect, it } from 'vitest';
import type { Cue } from '../../src/audio/cues';
import { MASTER_GAIN, bindUnlock, createSound } from '../../src/audio/sound';

/** An AudioParam that records its automation. */
function param() {
  const calls: [string, number, number][] = [];
  return {
    calls,
    value: 1,
    setValueAtTime(v: number, t: number) {
      calls.push(['set', v, t]);
    },
    exponentialRampToValueAtTime(v: number, t: number) {
      calls.push(['exp', v, t]);
    },
  };
}

function fakeContext(state: AudioContextState = 'running') {
  const started: { type: string; at: number; stop: number }[] = [];
  const gains: ReturnType<typeof param>[] = [];
  const node = () => ({ connect: () => undefined });
  const source = (type: string) => {
    const entry = { type, at: NaN, stop: NaN };
    return {
      ...node(),
      type: '',
      buffer: null as unknown,
      frequency: param(),
      start(t: number) {
        entry.at = t;
        started.push(entry);
      },
      stop(t: number) {
        entry.stop = t;
      },
    };
  };
  const ctx = {
    state,
    currentTime: 2,
    sampleRate: 8000,
    destination: node(),
    resumes: 0,
    resume() {
      ctx.resumes += 1;
      ctx.state = 'running';
      return Promise.resolve();
    },
    createGain() {
      const gain = param();
      gains.push(gain);
      return { ...node(), gain };
    },
    createOscillator: () => source('oscillator'),
    createBufferSource: () => source('noise'),
    createBiquadFilter: () => ({ ...node(), type: '', frequency: param(), Q: param() }),
    createBuffer(_channels: number, length: number) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
  };
  return { ctx, started, gains };
}

function setup(options: { muted?: boolean; state?: AudioContextState } = {}) {
  const fake = fakeContext(options.state);
  let created = 0;
  const sound = createSound(
    {
      createContext: () => {
        created += 1;
        return fake.ctx as unknown as AudioContext;
      },
    },
    { muted: options.muted ?? false },
  );
  return { sound, fake, created: () => created };
}

const EVERY_CUE: Cue[] = [
  { kind: 'rattle', speedMps: 1 },
  { kind: 'chime', pocket: 'start' },
  { kind: 'chime', pocket: 'tulip' },
  { kind: 'chime', pocket: 'attacker' },
  { kind: 'reel-tick' },
  { kind: 'reel-stop' },
  { kind: 'fanfare' },
];

describe('sound', () => {
  it('makes no audio context, and plays nothing, until unlocked', () => {
    const { sound, fake, created } = setup();
    expect(sound.unlocked).toBe(false);
    sound.play(EVERY_CUE);
    sound.setMuted(true);
    sound.setMuted(false);
    expect(created()).toBe(0);
    expect(fake.started).toEqual([]);
  });

  it('unlocking makes one context, once, and plays from then on', () => {
    const { sound, fake, created } = setup();
    sound.unlock();
    sound.unlock();
    expect(created()).toBe(1);
    expect(sound.unlocked).toBe(true);
    sound.play(EVERY_CUE);
    expect(fake.started.length).toBeGreaterThanOrEqual(EVERY_CUE.length);
    // Everything is scheduled from now, never in the past.
    expect(fake.started.every((s) => s.at >= fake.ctx.currentTime && s.stop > s.at)).toBe(true);
  });

  it('resumes a context the browser started suspended, and plays nothing until it runs', () => {
    const { sound, fake } = setup({ state: 'suspended' });
    fake.ctx.resume = () => Promise.resolve(); // stays suspended for now
    sound.unlock();
    sound.play(EVERY_CUE);
    expect(fake.started).toEqual([]);

    const other = setup({ state: 'suspended' });
    other.sound.unlock();
    expect(other.fake.ctx.resumes).toBe(1);
    other.sound.play([{ kind: 'reel-tick' }]);
    expect(other.fake.started.length).toBe(1);
  });

  it('plays nothing while muted, and again once unmuted', () => {
    const { sound, fake } = setup({ muted: true });
    expect(sound.muted).toBe(true);
    sound.unlock();
    // The master gain starts silent.
    expect(fake.gains[0]?.calls).toEqual([['set', 0, 2]]);
    sound.play(EVERY_CUE);
    expect(fake.started).toEqual([]);
    sound.setMuted(false);
    expect(fake.gains[0]?.calls.at(-1)).toEqual(['set', MASTER_GAIN, 2]);
    sound.play([{ kind: 'chime', pocket: 'start' }]);
    expect(fake.started.length).toBeGreaterThan(0);
    const before = fake.started.length;
    sound.setMuted(true);
    expect(fake.gains[0]?.calls.at(-1)).toEqual(['set', 0, 2]);
    sound.play(EVERY_CUE);
    expect(fake.started.length).toBe(before);
  });

  it('plays nothing for no cues, and a harder strike rattles louder', () => {
    const { sound, fake } = setup();
    sound.unlock();
    sound.play([]);
    expect(fake.started).toEqual([]);
    const peak = (speedMps: number) => {
      sound.play([{ kind: 'rattle', speedMps }]);
      // Each voice's envelope is the latest gain made; its first call is the strike.
      return fake.gains.at(-1)?.calls[0]?.[1] ?? NaN;
    };
    const soft = peak(0.25);
    const hard = peak(1);
    expect(soft).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(soft);
    // Capped: the hardest shots are no louder than a firm strike.
    expect(peak(10)).toBe(peak(1.5));
  });
});

describe('unlock on first interaction', () => {
  for (const type of ['pointerdown', 'touchend', 'keydown']) {
    it(`unlocks on the first ${type}, then stops listening`, () => {
      const target = new EventTarget();
      const { sound, created } = setup();
      const unlock = sound.unlock;
      let calls = 0;
      sound.unlock = () => {
        calls += 1;
        unlock();
      };
      bindUnlock(target, sound);
      expect(sound.unlocked).toBe(false);
      target.dispatchEvent(new Event(type));
      expect(sound.unlocked).toBe(true);
      target.dispatchEvent(new Event(type));
      target.dispatchEvent(new Event('pointerdown'));
      target.dispatchEvent(new Event('keydown'));
      expect(calls).toBe(1);
      expect(created()).toBe(1);
    });
  }

  it('ignores other events, and everything after unbinding', () => {
    const target = new EventTarget();
    const { sound } = setup();
    const unbind = bindUnlock(target, sound);
    target.dispatchEvent(new Event('pointermove'));
    target.dispatchEvent(new Event('scroll'));
    expect(sound.unlocked).toBe(false);
    unbind();
    target.dispatchEvent(new Event('keydown'));
    expect(sound.unlocked).toBe(false);
  });
});
