import { fullUpdate } from './simulation';
import type { OptimizationMode, SimState, StressEvent, WeatherKey } from './types';

export interface StressSnapshot {
  demand: number;
  solar: number;
  wind: number;
  hydro: number;
  battery: number;
}

export interface StressEventResult {
  next: SimState;
  before: StressSnapshot;
}

export function setWeather(state: SimState, weather: WeatherKey): SimState {
  return fullUpdate({ ...state, weather });
}

export function setMode(state: SimState, mode: OptimizationMode): SimState {
  return fullUpdate({ ...state, mode });
}

export function tickClock(state: SimState): SimState {
  return { ...state, time: (state.time + 0.02) % 24 };
}

export function setHour(state: SimState, hour: number): SimState {
  return fullUpdate({ ...state, time: hour });
}

export function applyStressEvent(state: SimState, event: StressEvent): StressEventResult | null {
  const before: StressSnapshot = {
    demand: state.demand.total,
    solar: state.solar.output,
    wind: state.wind.output,
    hydro: state.hydro.output,
    battery: state.battery.soc * state.battery.capacity,
  };

  let next: SimState = {
    ...state,
    solar: { ...state.solar },
    wind: { ...state.wind },
    hydro: { ...state.hydro },
    demand: { ...state.demand },
    battery: { ...state.battery },
  };

  switch (event) {
    case 'solar-drop':
      next.solar.output *= 0.15;
      next.solar.panelDarkness = 0.85;
      break;
    case 'wind-drop':
      next.wind.output *= 0.15;
      next.wind.speed *= 0.2;
      break;
    case 'hydro-fail':
      next.hydro.output *= 0.1;
      next.hydro.flow *= 0.1;
      break;
    case 'demand-spike':
      next.demand.total *= 1.6;
      next.demand.residential *= 1.4;
      next.demand.commercial *= 1.5;
      next.demand.industrial *= 2.0;
      next.demand.public *= 1.3;
      break;
    case 'low-battery':
      next.battery.soc = 0.12;
      break;
    case 'storm':
      next.solar.output *= 0.1;
      next.wind.output *= 1.5;
      next.wind.speed *= 1.8;
      next.hydro.output *= 1.2;
      next.weather = 'storm';
      break;
    case 'night':
      next.solar.output = 0;
      next.solar.irradiance = 0;
      next.solar.panelDarkness = 1;
      next.weather = 'night';
      break;
    case 'reset':
      next.weather = 'sunny';
      return { next: fullUpdate(next), before };
  }

  return { next: fullUpdate(next), before };
}

export function applyCascadeEvent(state: SimState): SimState {
  const next: SimState = {
    ...state,
    solar: { ...state.solar, output: state.solar.output * 0.15, panelDarkness: 0.85 },
    wind: { ...state.wind, output: state.wind.output * 0.2, speed: state.wind.speed * 0.3 },
    demand: {
      ...state.demand,
      total: state.demand.total * 1.5,
      residential: state.demand.residential * 1.3,
      commercial: state.demand.commercial * 1.5,
      industrial: state.demand.industrial * 1.8,
      public: state.demand.public * 1.2,
    },
    battery: { ...state.battery, soc: 0.15 },
    weather: 'storm',
  };

  return fullUpdate(next);
}
