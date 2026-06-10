/**
 * Fleet soundscape — Web Audio API (gesture-unlocked, soft-mute via master gain).
 * Distinct cues: distress ping, geofence alarm loop, tactical tier-3, socket status thud.
 *
 * To use MP3/WAV assets instead, swap calls for Howl from howler.js and keep the same
 * VOL.* gain staging + FleetAudioEngine.ensureGeofenceAlarm single-loop semantics.
 */

const VOL = {
  distressPing: 0.7,
  geofenceAlarm: 1.0,
  tacticalTier3: 0.85,
  systemStatus: 0.3,
};

export class FleetAudioEngine {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {GainNode | null} */
    this.master = null;
    /** Soft mute: logical events still run; audio inaudible */
    this.softMuted = false;
    /** Nominal master when unmuted */
    this._nominalMaster = 1;
    this._alarmTimeout = null;
    this._alarmLoopActive = false;
  }

  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.softMuted ? 0 : this._nominalMaster;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  /** @param {boolean} muted */
  setSoftMuted(muted) {
    this.softMuted = muted;
    if (!this.master || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(muted ? 0 : this._nominalMaster, t + 0.03);
  }

  dispose() {
    this.ensureGeofenceAlarm(false);
    try {
      this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.master = null;
  }

  _gain(roleKey) {
    if (!this.master || this.softMuted) return null;
    const base = VOL[roleKey];
    if (base == null) return null;
    const g = this.ctx.createGain();
    g.connect(this.master);
    return { node: g, peak: base };
  }

  /** High sonar-style ping — distress */
  playDistressPing() {
    if (!this.ctx || !this.master) return;
    const pack = this._gain('distressPing');
    if (!pack) return;
    const { node: g, peak } = pack;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2400, t);
    osc.frequency.exponentialRampToValueAtTime(4200, t + 0.045);
    osc.frequency.exponentialRampToValueAtTime(1800, t + 0.14);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.02, peak * 0.95), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + 0.24);
  }

  /** Industrial repeating alarm while geofence breach active — single scheduled loop, no stacking */
  ensureGeofenceAlarm(active) {
    if (!active) {
      this._alarmLoopActive = false;
      if (this._alarmTimeout) {
        clearTimeout(this._alarmTimeout);
        this._alarmTimeout = null;
      }
      return;
    }
    if (this._alarmLoopActive) return;
    this._alarmLoopActive = true;
    const tick = () => {
      if (!this._alarmLoopActive || !this.ctx || !this.master) {
        this._alarmTimeout = null;
        return;
      }
      const pack = this._gain('geofenceAlarm');
      if (!pack) {
        this._alarmTimeout = window.setTimeout(tick, 400);
        return;
      }
      const { node: g, peak } = pack;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(145, t);
      osc.frequency.linearRampToValueAtTime(165, t + 0.12);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(520, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak * 0.95, t + 0.015);
      g.gain.linearRampToValueAtTime(peak * 0.95, t + 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(filter);
      filter.connect(g);
      osc.start(t);
      osc.stop(t + 0.3);
      this._alarmTimeout = window.setTimeout(tick, 380);
    };
    tick();
  }

  /** Tier-3 tactical contact — distinct chirp burst */
  playTacticalTier3() {
    if (!this.ctx || !this.master) return;
    const pack = this._gain('tacticalTier3');
    if (!pack) return;
    const { node: g, peak } = pack;
    const t = this.ctx.currentTime;
    const freqs = [380, 620, 910, 540];
    let offset = 0;
    for (const fq of freqs) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(fq, t + offset);
      const gg = this.ctx.createGain();
      gg.gain.setValueAtTime(0.0001, t + offset);
      gg.gain.exponentialRampToValueAtTime(peak * 0.35, t + offset + 0.008);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.085);
      osc.connect(gg);
      gg.connect(g);
      osc.start(t + offset);
      osc.stop(t + offset + 0.09);
      offset += 0.072;
    }
  }

  /** Subtle UI / link status change */
  playSystemStatusThud() {
    if (!this.ctx || !this.master) return;
    const pack = this._gain('systemStatus');
    if (!pack) return;
    const { node: g, peak } = pack;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(92, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak * 0.9, t + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + 0.24);
  }
}
