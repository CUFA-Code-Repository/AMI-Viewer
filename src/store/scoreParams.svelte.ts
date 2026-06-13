// What-if score parameters (design_doc §4.3): live-editable inputs that drive
// the independent recompute. Seeded from the session's config.txt (or firmware
// defaults) and resettable.
import { DEFAULT_PARAMS, type ScoreParams } from '../score/recompute';
import type { SessionConfig } from '../model/types';

class ScoreParamsStore {
  params = $state<ScoreParams>({ ...DEFAULT_PARAMS });

  /** Seed from a session config (payload + announced roll); keep the rest default. */
  seedFromConfig(cfg: SessionConfig): void {
    this.params = {
      ...DEFAULT_PARAMS,
      payloadKg: cfg.payloadKg,
      takeoffAnnouncedM: cfg.takeoffAnnouncedM,
    };
  }

  resetToConfig(cfg: SessionConfig): void {
    this.seedFromConfig(cfg);
  }
}

export const scoreParams = new ScoreParamsStore();
