// uPlot plugins: phase background bands + event marker vertical lines, drawn
// behind/over every panel so all charts share the same visual context
// (design_doc §4.2 "Phase regions … colored background bands across every panel.
// Event markers … appear as vertical lines.").
import type uPlot from 'uplot';
import type { PhaseSpan, SystemEvent } from '../model/types';
import { PHASE_BG } from '../util/phaseColors';

/** Shade phase spans as background bands (drawn under the series). */
export function phaseBandsPlugin(phases: PhaseSpan[]): uPlot.Plugin {
  return {
    hooks: {
      drawClear: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        for (const p of phases) {
          const x0 = u.valToPos(p.startMs, 'x', true);
          const x1 = u.valToPos(p.endMs, 'x', true);
          const xa = Math.max(left, Math.min(x0, x1));
          const xb = Math.min(left + width, Math.max(x0, x1));
          if (xb <= xa) continue;
          ctx.fillStyle = PHASE_BG[p.phase];
          ctx.fillRect(xa, top, xb - xa, height);
        }
        ctx.restore();
      },
    },
  };
}

export interface EventMark {
  tMs: number;
  label: string;
  color: string;
}

/** Vertical lines for boot / phase transitions / zero event (drawn over series). */
export function eventMarkersPlugin(events: EventMark[]): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        ctx.lineWidth = 1;
        for (const e of events) {
          const x = u.valToPos(e.tMs, 'x', true);
          if (x < left || x > left + width) continue;
          ctx.strokeStyle = e.color;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, top + height);
          ctx.stroke();
        }
        ctx.restore();
      },
    },
  };
}

/** Cursor sync: report cursor moves up to the store, and accept external moves. */
export function cursorSyncPlugin(
  onMove: (tMs: number | null) => void,
): uPlot.Plugin {
  return {
    hooks: {
      setCursor: (u: uPlot) => {
        const idx = u.cursor.idx;
        if (idx == null) { onMove(null); return; }
        const t = u.data[0][idx];
        if (t != null) onMove(t as number);
      },
    },
  };
}
