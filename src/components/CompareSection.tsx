import { useEffect, useState } from 'react';
import { runNaive, runOptimization } from '../optimization';
import type { OptimizationResult, SimState } from '../types';

export function CompareSection({ state, active }: { state: SimState; active: boolean }) {
  const [naive, setNaive] = useState<OptimizationResult | null>(null);
  const [ef, setEf] = useState<OptimizationResult | null>(null);

  useEffect(() => {
    if (!active) return;
    setNaive(runNaive(state));
    setEf(state.optimizationResult ?? runOptimization(state));
  }, [active, state]);

  const naiveCost = naive?.operatingCost ?? 0;
  const naiveCO2 = (naive?.emissions ?? 0) * 1000;
  const naiveCycles = naive?.batteryCycles ?? 0;
  const naiveUnmet = naive?.unmet ?? 0;

  const efCost = ef?.operatingCost ?? 0;
  const efCO2 = (ef?.emissions ?? 0) * 1000;
  const efCycles = ef?.batteryCycles ?? 0;
  const efUnmet = ef?.unmet ?? 0;

  const maxCost = Math.max(naiveCost, efCost) || 1;
  const maxCO2 = Math.max(naiveCO2, efCO2) || 1;
  const maxCycles = Math.max(naiveCycles, efCycles) || 1;
  const maxUnmet = Math.max(naiveUnmet, efUnmet, 1);

  return (
    <section id="section-compare" className={'section' + (active ? ' active' : '')}>
      <div className="compare-container">
        <h2 className="section-title">WHY OPTIMIZATION MATTERS</h2>
        <p className="section-desc">
          Compare naive rule-based control against EnerFlux's multi-objective constrained optimization.
        </p>
        <div className="compare-grid">
          <div className="compare-card naive">
            <div className="compare-card-header">NAIVE CONTROL</div>
            <div className="compare-card-sub">Solar → Wind → Hydro → Battery</div>
            <div className="compare-metrics">
              <div className="compare-metric">
                <div className="cm-label">Operating Cost</div>
                <div className="cm-value">${naiveCost.toFixed(0)}</div>
                <div className="cm-bar">
                  <div className="cm-bar-fill naive-fill" style={{ width: `${(naiveCost / maxCost) * 100}%` }} />
                </div>
              </div>
              <div className="compare-metric">
                <div className="cm-label">CO₂ Emissions</div>
                <div className="cm-value">{naiveCO2.toFixed(0)} kg</div>
                <div className="cm-bar">
                  <div className="cm-bar-fill naive-fill" style={{ width: `${(naiveCO2 / maxCO2) * 100}%` }} />
                </div>
              </div>
              <div className="compare-metric">
                <div className="cm-label">Battery Cycles</div>
                <div className="cm-value">{naiveCycles.toFixed(1)}</div>
                <div className="cm-bar">
                  <div className="cm-bar-fill naive-fill" style={{ width: `${(naiveCycles / maxCycles) * 100}%` }} />
                </div>
              </div>
              <div className="compare-metric">
                <div className="cm-label">Unserved Energy</div>
                <div className="cm-value">{naiveUnmet.toFixed(0)} kWh</div>
                <div className="cm-bar">
                  <div className="cm-bar-fill naive-fill" style={{ width: `${(naiveUnmet / maxUnmet) * 100}%` }} />
                </div>
              </div>
            </div>
          </div>
          <div className="compare-vs">VS</div>
          <div className="compare-card optimal">
            <div className="compare-card-header">ENERFLUX</div>
            <div className="compare-card-sub">Multi-objective constrained optimization</div>
            <div className="compare-metrics">
              <div className="compare-metric">
                <div className="cm-label">Operating Cost</div>
                <div className="cm-value">${efCost.toFixed(0)}</div>
                <div className="cm-bar">
                  <div className="cm-bar-fill ef-fill" style={{ width: `${(efCost / maxCost) * 100}%` }} />
                </div>
              </div>
              <div className="compare-metric">
                <div className="cm-label">CO₂ Emissions</div>
                <div className="cm-value">{efCO2.toFixed(0)} kg</div>
                <div className="cm-bar">
                  <div className="cm-bar-fill ef-fill" style={{ width: `${(efCO2 / maxCO2) * 100}%` }} />
                </div>
              </div>
              <div className="compare-metric">
                <div className="cm-label">Battery Cycles</div>
                <div className="cm-value">{efCycles.toFixed(1)}</div>
                <div className="cm-bar">
                  <div className="cm-bar-fill ef-fill" style={{ width: `${(efCycles / maxCycles) * 100}%` }} />
                </div>
              </div>
              <div className="compare-metric">
                <div className="cm-label">Unserved Energy</div>
                <div className="cm-value">{efUnmet.toFixed(0)} kWh</div>
                <div className="cm-bar">
                  <div className="cm-bar-fill ef-fill" style={{ width: `${(efUnmet / maxUnmet) * 100}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
