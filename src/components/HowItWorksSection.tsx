import { useState } from 'react';
import type { SimState } from '../types';

export function HowItWorksSection({ state, active }: { state: SimState; active: boolean }) {
  const [mathOpen, setMathOpen] = useState(false);
  const r = state.optimizationResult;

  const forecastText = `Solar ${state.solar.output.toFixed(0)}kW · Wind ${state.wind.output.toFixed(0)}kW · Hydro ${state.hydro.output.toFixed(0)}kW · Demand ${state.demand.total.toFixed(0)}kW`;
  const dispatchText = r
    ? `Solar ${r.dispatch.solar.toFixed(0)}kW · Wind ${r.dispatch.wind.toFixed(0)}kW · Hydro ${r.dispatch.hydro.toFixed(0)}kW · Batt ${r.dispatch.battery > 0 ? '+' : ''}${r.dispatch.battery.toFixed(0)}kW`
    : '';
  const stabilityText = r
    ? `${r.totalWithBatt.toFixed(0)} kW gen vs ${r.demand.toFixed(0)} kW demand · ${r.gridStable ? 'Balanced' : 'Deficit ' + r.unmet.toFixed(1) + ' kW'}`
    : '';

  return (
    <section id="section-how-it-works" className={'section' + (active ? ' active' : '')}>
      <div className="how-container">
        <h2 className="section-title">HOW ENERFLUX THINKS</h2>
        <div className="pipeline">
          <div className="pipe-step">
            <div className="pipe-icon">📊</div>
            <div className="pipe-title">FORECAST</div>
            <div className="pipe-desc">Solar / Wind / Hydro / Demand</div>
            <div className="pipe-data">{forecastText}</div>
          </div>
          <div className="pipe-arrow">↓</div>
          <div className="pipe-step">
            <div className="pipe-icon">🔒</div>
            <div className="pipe-title">CONSTRAINTS</div>
            <div className="pipe-desc">Generation limits · Battery limits · Demand requirements</div>
            <div className="pipe-data">Gen ≤ 290kW · Batt 10-100% SOC · Discharge ≤ 100kW</div>
          </div>
          <div className="pipe-arrow">↓</div>
          <div className="pipe-step">
            <div className="pipe-icon">⚙</div>
            <div className="pipe-title">OPTIMIZATION</div>
            <div className="pipe-desc">Minimize: Cost + CO₂ + Battery wear + Curtailment</div>
            <div className="pipe-data">Weighted objective · Linear constraints · Deterministic solution</div>
          </div>
          <div className="pipe-arrow">↓</div>
          <div className="pipe-step">
            <div className="pipe-icon">⚡</div>
            <div className="pipe-title">DISPATCH</div>
            <div className="pipe-desc">Optimal generation setpoints sent to each source</div>
            <div className="pipe-data">{dispatchText}</div>
          </div>
          <div className="pipe-arrow">↓</div>
          <div className="pipe-step">
            <div className="pipe-icon">✓</div>
            <div className="pipe-title">GRID STABILITY</div>
            <div className="pipe-desc">Generation = Demand · All constraints satisfied</div>
            <div className="pipe-data">{stabilityText}</div>
          </div>
        </div>
        <div className="math-expand">
          <button className="math-toggle" onClick={() => setMathOpen(v => !v)}>
            {mathOpen ? 'Hide Mathematical Formulation ▴' : 'Show Mathematical Formulation ▾'}
          </button>
          <div className={'math-content' + (mathOpen ? '' : ' hidden')}>
            <div className="math-block">
              <div className="math-title">Objective Function</div>
              <div className="math-eq">
                minimize Z = w₁·C(solar,wind,hydro) + w₂·E(solar,wind,hydro) + w₃·D(batt_charge,batt_discharge) +
                w₄·Q(solar_avail-solar_used) + w₅·U(max(0, demand - Σgen))
              </div>
            </div>
            <div className="math-block">
              <div className="math-title">Subject to</div>
              <div className="math-eq">Σ gen + batt_discharge - batt_charge = demand</div>
              <div className="math-eq">0 ≤ gen_i ≤ capacity_i for each source i</div>
              <div className="math-eq">SOC_min ≤ SOC ≤ SOC_max</div>
              <div className="math-eq">-P_discharge_max ≤ P_batt ≤ P_charge_max</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
