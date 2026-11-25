/**
 * Small WebAudio sound manager. Sounds are optional: decoding failures are swallowed so audio
 * never blocks gameplay. Buffers are decoded once and reused.
 */

const urls = import.meta.glob<string>('../../assets/sounds/*.wav', { query: '?url', import: 'default', eager: true });

export type SoundName =
  | 'cannon_broadside'
  | 'cannon_fire_1'
  | 'cannon_fire_2'
  | 'cannon_fire_3'
  | 'cannonball_water_hit_1'
  | 'cannonball_water_hit_2'
  | 'game_complete'
  | 'game_over'
  | 'game_pause'
  | 'game_resume'
  | 'game_start'
  | 'health_low'
  | 'ocean_ambience_loop'
  | 'score_point'
  | 'ship_collision'
  | 'ship_explosion_1'
  | 'ship_explosion_2'
  | 'ship_sinking'
  | 'ship_wood_hit_1'
  | 'ship_wood_hit_2'
  | 'time_warning'
  | 'ui_click'
  | 'ui_back';

function urlOf(name: SoundName): string | undefined {
  return urls[`../../assets/sounds/${name}.wav`];
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private readonly buffers = new Map<SoundName, Promise<AudioBuffer | null>>();
  private loop: AudioBufferSourceNode | null = null;
  private ambienceWanted = false;
  enabled = true;

  private context(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.5;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  private buffer(name: SoundName): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name);
    if (!p) {
      const url = urlOf(name);
      const ctx = this.context();
      p =
        url && ctx
          ? fetch(url)
              .then((r) => r.arrayBuffer())
              .then((b) => ctx.decodeAudioData(b))
              .catch(() => null)
          : Promise.resolve(null);
      this.buffers.set(name, p);
    }
    return p;
  }

  play(name: SoundName, volume = 1): void {
    if (!this.enabled) return;
    const ctx = this.context();
    if (!ctx || !this.gain) return;
    void this.buffer(name).then((buf) => {
      if (!buf || !this.enabled || !this.gain) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(this.gain);
      src.start();
    });
  }

  startAmbience(): void {
    this.ambienceWanted = true;
    if (!this.enabled || this.loop) return;
    const ctx = this.context();
    if (!ctx || !this.gain) return;
    void this.buffer('ocean_ambience_loop').then((buf) => {
      if (!buf || !this.enabled || !this.ambienceWanted || this.loop || !this.gain) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      src.connect(g).connect(this.gain);
      src.start();
      this.loop = src;
    });
  }

  stopAmbience(): void {
    this.ambienceWanted = false;
    try {
      this.loop?.stop();
    } catch {
      /* already stopped */
    }
    this.loop = null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stopAmbience();
  }
}

export const sound = new SoundManager();
