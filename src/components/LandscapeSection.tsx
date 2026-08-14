import { useState } from 'react';
import type { SimStore } from '../store';
import { fullUpdate } from '../simulation';
import { applyCascadeEvent, applyStressEvent, setMode, setWeather } from '../engine';
import { BATTERY_CYCLE_COST } from '../optimization';
import { LandscapeCanvas } from './LandscapeCanvas';
import type { Explanation, OptimizationMode, SimState, StressEvent, WeatherKey } from '../types';
import type { StressSnapshot } from '../engine';

const WEATHER_BUTTONS: { key: WeatherKey; label: string }[] = [
  { key: 'sunny', label: '☀ Sunny' },
  { key: 'cloudy', label: '⛅ Cloudy' },
  { key: 'rain', label: '🌧 Rain' },
  { key: 'storm', label: '🌩 Storm' },
  { key: 'night', label: '🌙 Night' },
  { key: 'windy', label: '🌬 High Wind' },
];

const STRESS_BUTTONS: { key: StressEvent; label: string; reset?: boolean }[] = [
  { key: 'solar-drop', label: '☀ Solar Drop' },
  { key: 'wind-drop', label: '🌬 Wind Drop' },
  { key: 'hydro-fail', label: '💧 Hydro Failure' },
  { key: 'demand-spike', label: '⚡ Demand Spike' },
  { key: 'low-battery', label: '🔋 Low Battery' },
  { key: 'storm', label: '🌩 Storm' },
  { key: 'night', label: '🌙 Night' },
  { key: 'reset', label: '↺ RESET', reset: true },
];

const MODE_BUTTONS: { key: OptimizationMode; label: string }[] = [
  { key: 'balanced', label: 'Balanced' },
  { key: 'cost', label: 'Cost' },
  { key: 'carbon', label: 'Low Carbon' },
  { key: 'battery', label: 'Battery Life' },
];

const RANDOM_EVENTS: StressEvent[] = ['solar-drop', 'wind-drop', 'demand-spike', 'storm'];

export function LandscapeSection({ store, state, active }: { store: SimStore; state: SimState; active: boolean }) {
  const [decision, setDecision] = useState<Explanation | null>(null);
  const [stressResult, setStressResult] = useState<{ before: StressSnapshot; after: SimState } | null>(null);
  const [emergency, setEmergency] = useState(false);
  const [stabilized, setStabilized] = useState<string | null>(null);

  function showDecision(next: SimState) {
    if (!next.optimizationResult) return;
    setDecision(next.optimizationResult.explanation);
  }

  function runOptimizeNow() {
    const next = fullUpdate(store.getSnapshot());
    store.set(next);
    showDecision(next);
  }

  function runStress(event: StressEvent) {
    const result = applyStressEvent(store.getSnapshot(), event);
    if (!result) return;
    store.set(result.next);
    if (event === 'reset') {
      setStressResult(null);
      return;
    }
    setStressResult({ before: result.before, after: result.next });
    showDecision(result.next);
  }

  function runSimulateEvent() {
    const event = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
    runStress(event);
  }

  function runCascade() {
    const next = applyCascadeEvent(store.getSnapshot());
    store.set(next);
    setEmergency(true);
    setStabilized(null);
  }

  function recover() {
    setEmergency(false);
    const next = fullUpdate(store.getSnapshot());
    store.set(next);
    showDecision(next);
    setStabilized(`${next.optimizationResult!.unmet.toFixed(1)} kWh unmet demand`);
    setTimeout(() => setStabilized(null), 3000);
  }

  function pickWeather(weather: WeatherKey) {
    store.set(setWeather(store.getSnapshot(), weather));
  }

  function pickMode(mode: OptimizationMode) {
    const next = setMode(store.getSnapshot(), mode);
    store.set(next);
    showDecision(next);
  }

  const r = state.optimizationResult;

  return (
    <section id="section-landscape" className={'section' + (active ? ' active' : '')}>
      <LandscapeCanvas store={store} />

      <div id="hero-overlay">
        <div className="hero-left">
          <h1 className="hero-title">ENERFLUX</h1>
          <p className="hero-subtitle">Adaptive Renewable Microgrid Optimization</p>
          <p className="hero-desc">Balance renewable generation, storage, and demand in real time.</p>
          <div className="hero-metrics">
            <div className="hero-metric">
              <div className="metric-label">GRID STATUS</div>
              <div
                className={
                  'metric-value ' + (state.gridStatus === 'STABLE' ? 'stable' : state.gridStatus === 'CRITICAL' ? 'critical' : 'warning')
                }
              >
                {state.gridStatus}
              </div>
            </div>
            <div className="hero-metric">
              <div className="metric-label">RENEWABLE SHARE</div>
              <div className="metric-value">{state.renewableShare.toFixed(1)}%</div>
            </div>
            <div className="hero-metric">
              <div className="metric-label">CURRENT LOAD</div>
              <div className="metric-value">{state.demand.total.toFixed(0)} kW</div>
            </div>
          </div>
          <div className="hero-actions">
            <button className="btn-primary" onClick={runOptimizeNow}>
              RUN OPTIMIZATION
            </button>
            <button className="btn-secondary" onClick={runSimulateEvent}>
              SIMULATE EVENT
            </button>
            <button className="btn-emergency" onClick={runCascade}>
              TRIGGER CASCADE EVENT
            </button>
          </div>
        </div>
        <div className="hero-right">
          <div className="flow-summary">
            <div className="flow-item" onClick={() => showDecision(state)}>
              <div className="flow-icon sun-icon">☀</div>
              <div className="flow-info">
                <div className="flow-name">Solar PV</div>
                <div className="flow-power">{state.solar.output.toFixed(0)} kW</div>
              </div>
              <div className="flow-bar">
                <div className="flow-bar-fill solar-fill" style={{ width: `${(state.solar.output / state.solar.available) * 100}%` }} />
              </div>
            </div>
            <div className="flow-item" onClick={() => showDecision(state)}>
              <div className="flow-icon wind-icon">🌬</div>
              <div className="flow-info">
                <div className="flow-name">Wind</div>
                <div className="flow-power">{state.wind.output.toFixed(0)} kW</div>
              </div>
              <div className="flow-bar">
                <div className="flow-bar-fill wind-fill" style={{ width: `${(state.wind.output / state.wind.capacity) * 100}%` }} />
              </div>
            </div>
            <div className="flow-item" onClick={() => showDecision(state)}>
              <div className="flow-icon hydro-icon">💧</div>
              <div className="flow-info">
                <div className="flow-name">Hydro</div>
                <div className="flow-power">{state.hydro.output.toFixed(0)} kW</div>
              </div>
              <div className="flow-bar">
                <div className="flow-bar-fill hydro-fill" style={{ width: `${(state.hydro.output / state.hydro.capacity) * 100}%` }} />
              </div>
            </div>
            <div className="flow-item" onClick={() => showDecision(state)}>
              <div className="flow-icon batt-icon">🔋</div>
              <div className="flow-info">
                <div className="flow-name">Battery</div>
                <div className="flow-power">
                  {state.battery.chargeRate >= 0 ? '+' : ''}
                  {state.battery.chargeRate.toFixed(0)} kW
                </div>
              </div>
              <div className="flow-bar">
                <div
                  className="flow-bar-fill batt-fill"
                  style={{ width: `${(Math.abs(state.battery.chargeRate) / state.battery.maxCharge) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        id="decision-panel"
        className={'floating-panel' + (decision ? '' : ' hidden')}
        style={{ top: 80, left: '50%', transform: 'translateX(-50%)' }}
      >
        <div className="panel-header">
          <span className="panel-title">⚡ DECISION EXPLANATION</span>
          <button className="panel-close" onClick={() => setDecision(null)}>
            ✕
          </button>
        </div>
        <div className="panel-body">
          <div className="decision-step">
            <div className="step-label">OBSERVATION</div>
            <div className="step-text">{decision ? decision.observations.join('. ') + '.' : ''}</div>
          </div>
          <div className="decision-step">
            <div className="step-label">CONSTRAINT</div>
            <div className="step-text">{decision ? decision.constraints.join('. ') + '.' : ''}</div>
          </div>
          <div className="decision-step">
            <div className="step-label">DECISION</div>
            <div className="step-text">{decision ? decision.actions.join(' ') : ''}</div>
          </div>
        </div>
      </div>

      <div id="stress-panel" className="control-panel">
        <div className="panel-header-sm">GRID STRESS TEST</div>
        <div className="stress-buttons">
          {STRESS_BUTTONS.map(btn => (
            <button key={btn.key} className={'stress-btn' + (btn.reset ? ' reset' : '')} onClick={() => runStress(btn.key)}>
              {btn.label}
            </button>
          ))}
        </div>
        <div id="stress-result" className={'stress-result' + (stressResult ? '' : ' hidden')}>
          {stressResult && (
            <>
              <div className="stress-before">
                <strong>BEFORE</strong>
                <br />
                Demand: {stressResult.before.demand.toFixed(0)} kW
                <br />
                Gen: {(stressResult.before.solar + stressResult.before.wind + stressResult.before.hydro).toFixed(0)} kW
              </div>
              <div className="stress-arrow">→</div>
              <div className="stress-after">
                <strong>AFTER OPTIMIZATION</strong>
                <br />
                Solar: {stressResult.after.optimizationResult!.dispatch.solar.toFixed(0)} kW
                <br />
                Wind: {stressResult.after.optimizationResult!.dispatch.wind.toFixed(0)} kW
                <br />
                Hydro: {stressResult.after.optimizationResult!.dispatch.hydro.toFixed(0)} kW
                <br />
                Battery: {stressResult.after.optimizationResult!.dispatch.battery > 0 ? '+' : ''}
                {stressResult.after.optimizationResult!.dispatch.battery.toFixed(0)} kW
                <br />
                <br />
                Total: {stressResult.after.optimizationResult!.totalWithBatt.toFixed(0)} kW
                <br />
                <span className={stressResult.after.optimizationResult!.gridStable ? 'stable' : 'critical'}>
                  {stressResult.after.optimizationResult!.gridStable ? 'GRID STABLE' : 'GRID STRESSED'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <div id="weather-panel" className="control-panel">
        <div className="panel-header-sm">WEATHER</div>
        <div className="weather-buttons">
          {WEATHER_BUTTONS.map(btn => (
            <button
              key={btn.key}
              className={'weather-btn' + (state.weather === btn.key ? ' active' : '')}
              onClick={() => pickWeather(btn.key)}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      <div id="impact-panel" className="control-panel">
        <div className="panel-header-sm">SYSTEM IMPACT</div>
        <div className="impact-grid">
          <div className="impact-item">
            <div className="impact-label">Renewable used</div>
            <div className="impact-value">{state.renewableShare.toFixed(1)}%</div>
          </div>
          <div className="impact-item">
            <div className="impact-label">CO₂ avoided</div>
            <div className="impact-value">{r ? (r.emissions * 1000).toFixed(0) : '0'} kg</div>
          </div>
          <div className="impact-item">
            <div className="impact-label">Operating cost</div>
            <div className="impact-value">${r ? r.operatingCost.toFixed(2) : '0.00'}</div>
          </div>
          <div className="impact-item">
            <div className="impact-label">Curtailment</div>
            <div className="impact-value">{r ? r.curtailPct.toFixed(1) : '0.0'}%</div>
          </div>
          <div className="impact-item">
            <div className="impact-label">Battery degrade</div>
            <div className="impact-value">${r ? (r.batteryCycles * BATTERY_CYCLE_COST * 100).toFixed(2) : '0.00'}</div>
          </div>
        </div>
        <div className="optimization-mode">
          <div className="mode-label">OPTIMIZATION MODE</div>
          <div className="mode-buttons">
            {MODE_BUTTONS.map(btn => (
              <button key={btn.key} className={'mode-btn' + (state.mode === btn.key ? ' active' : '')} onClick={() => pickMode(btn.key)}>
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div id="emergency-banner" className={emergency ? '' : 'hidden'}>
        <div className="emergency-content">
          <div className="emergency-icon">⚠</div>
          <div className="emergency-text">GRID UNDER STRESS</div>
          <div className="emergency-sub">Multiple generation sources compromised</div>
          <button className="btn-emergency" onClick={recover}>
            OPTIMIZE & RECOVER
          </button>
        </div>
      </div>

      <div id="stabilized-banner" className={stabilized ? '' : 'hidden'}>
        <div className="stabilized-content">
          <div className="stabilized-icon">✓</div>
          <div className="stabilized-text">GRID STABILIZED</div>
          <div className="stabilized-sub">{stabilized}</div>
        </div>
      </div>
    </section>
  );
}
