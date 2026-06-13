// Shared phase color palette (used by the overview strip and later by graph
// background bands and the 3D phase-colored trail — design_doc §4.2, §4.4).
import type { FlightPhase } from '../model/types';

export const PHASE_COLORS: Record<FlightPhase, string> = {
  IDLE: '#64748b', // slate
  CLIMBING: '#0ea5e9', // sky
  DISTANCE: '#22c55e', // green
  LANDING: '#f59e0b', // amber
};

export const PHASE_BG: Record<FlightPhase, string> = {
  IDLE: 'rgba(100,116,139,0.10)',
  CLIMBING: 'rgba(14,165,233,0.10)',
  DISTANCE: 'rgba(34,197,94,0.10)',
  LANDING: 'rgba(245,158,11,0.12)',
};
