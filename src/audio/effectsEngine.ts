import * as Tone from 'tone';
import { EffectConfig, EffectType } from '../types/daw';

interface EffectNodeWrapper {
  id: string;
  type: EffectType;
  enabled: boolean;
  node: Tone.ToneAudioNode;
  extraNode?: Tone.ToneAudioNode;
}

interface TrackChain {
  source: Tone.ToneAudioNode;
  input: Tone.Gain;
  output: Tone.Gain;
  meter: Tone.Meter;
  destination: Tone.ToneAudioNode;
  wrappers: EffectNodeWrapper[];
  signature: string;
}

const EFFECT_ORDER: Record<EffectType, number> = {
  eq: 0,
  filter: 1,
  compressor: 2,
  distortion: 3,
  reverb: 4,
  delay: 5,
};

function clamp(min: number, max: number, val: number): number {
  return Math.max(min, Math.min(max, val));
}

function createEffectWrapper(fx: EffectConfig): EffectNodeWrapper {
  const p = fx.params;
  switch (fx.type) {
    case 'eq': {
      const eq = new Tone.EQ3({
        low: clamp(-12, 12, Number(p.low ?? 0)),
        mid: clamp(-12, 12, Number(p.mid ?? 0)),
        high: clamp(-12, 12, Number(p.high ?? 0)),
      });
      const peaking = new Tone.Filter({
        type: 'peaking',
        frequency: clamp(80, 14000, Number(p.frequency ?? 1000)),
        Q: clamp(0.5, 8, Number(p.q ?? 1)),
        gain: clamp(-12, 12, Number(p.mid ?? 0)),
      });
      eq.connect(peaking);
      return {
        id: fx.id,
        type: fx.type,
        enabled: fx.enabled,
        node: eq,
        extraNode: peaking,
      };
    }
    case 'compressor':
      return {
        id: fx.id,
        type: fx.type,
        enabled: fx.enabled,
        node: new Tone.Compressor({
          threshold: clamp(-48, 0, Number(p.threshold ?? -18)),
          ratio: clamp(1, 12, Number(p.ratio ?? 3.5)),
          attack: clamp(0.001, 0.2, Number(p.attack ?? 0.01)),
          release: clamp(0.05, 1.0, Number(p.release ?? 0.2)),
        }),
      };
    case 'reverb':
      return {
        id: fx.id,
        type: fx.type,
        enabled: fx.enabled,
        node: new Tone.Reverb({
          decay: clamp(0.3, 6.0, Number(p.decay ?? 2.2)),
          preDelay: 0.015,
          wet: clamp(0, 1, Number(p.wet ?? 0.25)),
        }),
      };
    case 'delay':
      return {
        id: fx.id,
        type: fx.type,
        enabled: fx.enabled,
        node: new Tone.FeedbackDelay({
          delayTime: clamp(0.05, 1.0, Number(p.delayTime ?? 0.375)),
          feedback: clamp(0, 0.85, Number(p.feedback ?? 0.32)),
          wet: clamp(0, 1, Number(p.wet ?? 0.22)),
        }),
      };
    case 'distortion':
      return {
        id: fx.id,
        type: fx.type,
        enabled: fx.enabled,
        node: new Tone.Distortion({
          distortion: clamp(0, 1, Number(p.amount ?? 0.18)),
          wet: clamp(0, 1, Number(p.wet ?? 0.2)),
        }),
      };
    case 'filter':
      return {
        id: fx.id,
        type: fx.type,
        enabled: fx.enabled,
        node: new Tone.Filter({
          frequency: clamp(80, 16000, Number(p.frequency ?? 3200)),
          Q: clamp(0.5, 12, Number(p.resonance ?? 1.2)),
          type: (p.filterType as BiquadFilterType) ?? 'lowpass',
        }),
      };
  }
}

function updateEffectNodeParams(wrapper: EffectNodeWrapper, fx: EffectConfig): void {
  const p = fx.params;
  wrapper.enabled = fx.enabled;

  switch (fx.type) {
    case 'eq': {
      const eq = wrapper.node as Tone.EQ3;
      eq.low.rampTo(clamp(-12, 12, Number(p.low ?? 0)), 0.02);
      eq.mid.rampTo(clamp(-12, 12, Number(p.mid ?? 0)), 0.02);
      eq.high.rampTo(clamp(-12, 12, Number(p.high ?? 0)), 0.02);
      if (wrapper.extraNode) {
        const peaking = wrapper.extraNode as Tone.Filter;
        peaking.frequency.rampTo(clamp(80, 14000, Number(p.frequency ?? 1000)), 0.02);
        peaking.Q.rampTo(clamp(0.5, 8, Number(p.q ?? 1)), 0.02);
        peaking.gain.rampTo(clamp(-12, 12, Number(p.mid ?? 0)), 0.02);
      }
      break;
    }
    case 'compressor': {
      const comp = wrapper.node as Tone.Compressor;
      comp.threshold.rampTo(clamp(-48, 0, Number(p.threshold ?? -18)), 0.02);
      comp.ratio.rampTo(clamp(1, 12, Number(p.ratio ?? 3.5)), 0.02);
      comp.attack.rampTo(clamp(0.001, 0.2, Number(p.attack ?? 0.01)), 0.02);
      comp.release.rampTo(clamp(0.05, 1.0, Number(p.release ?? 0.2)), 0.02);
      break;
    }
    case 'reverb': {
      const rev = wrapper.node as Tone.Reverb;
      rev.wet.rampTo(clamp(0, 1, Number(p.wet ?? 0.25)), 0.03);
      const targetDecay = clamp(0.3, 6.0, Number(p.decay ?? 2.2));
      if (Math.abs(Number(rev.decay) - targetDecay) > 0.05) {
        rev.decay = targetDecay;
      }
      break;
    }
    case 'delay': {
      const del = wrapper.node as Tone.FeedbackDelay;
      del.delayTime.rampTo(clamp(0.05, 1.0, Number(p.delayTime ?? 0.375)), 0.03);
      del.feedback.rampTo(clamp(0, 0.85, Number(p.feedback ?? 0.32)), 0.03);
      del.wet.rampTo(clamp(0, 1, Number(p.wet ?? 0.22)), 0.03);
      break;
    }
    case 'distortion': {
      const dist = wrapper.node as Tone.Distortion;
      dist.distortion = clamp(0, 1, Number(p.amount ?? 0.18));
      dist.wet.rampTo(clamp(0, 1, Number(p.wet ?? 0.2)), 0.03);
      break;
    }
    case 'filter': {
      const filt = wrapper.node as Tone.Filter;
      filt.frequency.rampTo(clamp(80, 16000, Number(p.frequency ?? 3200)), 0.02);
      filt.Q.rampTo(clamp(0.5, 12, Number(p.resonance ?? 1.2)), 0.02);
      filt.type = (p.filterType as BiquadFilterType) ?? 'lowpass';
      break;
    }
  }
}

export class EffectsEngine {
  private chains = new Map<string, TrackChain>();

  private ensureTrackChain(
    trackId: string,
    sourceNode: Tone.ToneAudioNode,
    destination: Tone.ToneAudioNode
  ): TrackChain {
    const existing = this.chains.get(trackId);
    if (existing) {
      if (existing.source !== sourceNode) {
        existing.source.disconnect(existing.input);
        sourceNode.connect(existing.input);
        existing.source = sourceNode;
      }
      if (existing.destination !== destination) {
        existing.output.disconnect();
        existing.output.connect(destination);
        existing.destination = destination;
      }
      return existing;
    }

    const input = new Tone.Gain(1);
    const output = new Tone.Gain(1);
    const meter = new Tone.Meter({ smoothing: 0.65 });
    sourceNode.connect(input);
    input.connect(output);
    output.connect(meter);
    output.connect(destination);

    const chain: TrackChain = {
      source: sourceNode,
      input,
      output,
      meter,
      destination,
      wrappers: [],
      signature: '',
    };
    this.chains.set(trackId, chain);
    return chain;
  }

  /**
   * Routes Track Post-Gain through enabled effects in strict studio order:
   * EQ -> Filter -> Compressor -> Distortion -> Reverb -> Delay -> Master Bus
   * Bypassed effects are completely excluded from the audio graph (zero DSP overhead).
   */
  public syncTrackEffects(
    trackId: string,
    effects: EffectConfig[],
    sourceNode: Tone.ToneAudioNode,
    destination: Tone.ToneAudioNode
  ): void {
    const chain = this.ensureTrackChain(trackId, sourceNode, destination);

    const activeEffects = effects
      .filter((e) => e.enabled)
      .slice()
      .sort((a, b) => EFFECT_ORDER[a.type] - EFFECT_ORDER[b.type]);

    const signature = activeEffects.map((e) => `${e.id}:${e.type}`).join('|');

    if (chain.signature !== signature) {
      const now = Tone.now();
      // Brief de-click fade while re-patching insert chain
      chain.output.gain.cancelScheduledValues(now);
      chain.output.gain.setValueAtTime(chain.output.gain.value, now);
      chain.output.gain.linearRampToValueAtTime(0, now + 0.008);

      chain.input.disconnect();
      chain.wrappers.forEach((w) => {
        w.node.disconnect();
        w.node.dispose();
        w.extraNode?.disconnect();
        w.extraNode?.dispose();
      });

      const nextWrappers: EffectNodeWrapper[] = activeEffects.map((fx) => createEffectWrapper(fx));

      if (nextWrappers.length === 0) {
        chain.input.connect(chain.output);
      } else {
        chain.input.connect(nextWrappers[0].node);
        for (let i = 0; i < nextWrappers.length - 1; i++) {
          const tail = nextWrappers[i].extraNode ?? nextWrappers[i].node;
          tail.connect(nextWrappers[i + 1].node);
        }
        const lastTail =
          nextWrappers[nextWrappers.length - 1].extraNode ??
          nextWrappers[nextWrappers.length - 1].node;
        lastTail.connect(chain.output);
      }

      chain.wrappers = nextWrappers;
      chain.signature = signature;
      chain.output.gain.linearRampToValueAtTime(1, now + 0.025);
    } else {
      for (let i = 0; i < activeEffects.length; i++) {
        updateEffectNodeParams(chain.wrappers[i], activeEffects[i]);
      }
    }
  }

  public getTrackMeterNormalized(trackId: string): number | null {
    const meter = this.chains.get(trackId)?.meter;
    if (!meter) return null;
    const val = meter.getValue();
    const db = Array.isArray(val) ? val[0] : val;
    if (!Number.isFinite(db) || db <= -60) return 0;
    return Math.max(0, Math.min(1, (db + 54) / 54));
  }

  public removeTrack(trackId: string): void {
    const chain = this.chains.get(trackId);
    if (!chain) return;
    try {
      chain.source.disconnect(chain.input);
    } catch {
      // ignore
    }
    chain.input.disconnect();
    chain.output.disconnect();
    chain.input.dispose();
    chain.output.dispose();
    chain.meter.dispose();
    chain.wrappers.forEach((w) => {
      w.node.disconnect();
      w.node.dispose();
      w.extraNode?.disconnect();
      w.extraNode?.dispose();
    });
    this.chains.delete(trackId);
  }
}
