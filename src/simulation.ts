import { runOptimization } from './optimization';
import { weatherProfiles } from './weatherProfiles';
import type { BatteryState, DemandState, GridStatus, HydroState, SimState, SolarState, WindState } from './types';

export function solarCurve(hour: number): number {
  // Bell curve centered at 13:00
  if (hour < 6 || hour > 20) return 0;
  const x = (hour - 13) / 4;
  return Math.exp(-x * x * 0.5) * 0.95 + 0.05;
}

export function demandCurve(hour: number): number {
  // Morning peak ~8, evening peak ~18
  const morning = Math.exp(-Math.pow((hour - 8) / 2.5, 2)) * 0.3;
  const evening = Math.exp(-Math.pow((hour - 18) / 3, 2)) * 0.4;
  const base = 0.7;
  return base + morning + evening;
}

export function computeSolar(time: number, weather: SimState['weather'], solar: SolarState): SolarState {
  const wp = weatherProfiles[weather];
  const irradiance = solarCurve(time) * wp.solarMod;
  return {
    ...solar,
    irradiance,
    output: Math.max(0, solar.available * irradiance),
    panelDarkness: 1 - irradiance,
  };
}

export function computeWind(time: number, weather: SimState['weather'], wind: WindState): WindState {
  const wp = weatherProfiles[weather];
  const baseSpeed = 8 + Math.sin(time * 0.3) * 4;
  const speed = Math.max(0, Math.min(30, baseSpeed * wp.windMod));

  // Power curve: cut-in 3m/s, rated 12m/s, cut-out 25m/s
  let output: number;
  if (speed < 3) output = 0;
  else if (speed < 12) output = wind.capacity * Math.pow((speed - 3) / 9, 3);
  else if (speed <= 25) output = wind.capacity;
  else output = 0;
  output *= wp.windMod;

  return { ...wind, speed, output };
}

export function computeHydro(weather: SimState['weather'], hydro: HydroState): HydroState {
  const wp = weatherProfiles[weather];
  const waterLevel = Math.min(1, Math.max(0.3, hydro.waterLevel + (wp.hydroMod - 1) * 0.01));
  const flow = 20 + waterLevel * 20 + (wp.hydroMod - 1) * 10;
  return { ...hydro, waterLevel, flow, output: Math.min(hydro.capacity, flow * 1.8) };
}

export function computeDemand(time: number): DemandState {
  const hourFactor = demandCurve(time);
  const total = Math.round(120 * hourFactor);
  return {
    total,
    peak: 184,
    residential: total * 0.44,
    commercial: total * 0.29,
    industrial: total * 0.16,
    public: total * 0.11,
  };
}

export function computeBattery(battery: BatteryState, dispatchBattery: number): BatteryState {
  const soc = Math.max(0.05, Math.min(0.98, battery.soc + (dispatchBattery / battery.capacity) * 0.1));
  const status = soc < 0.15 ? 'critical' : dispatchBattery > 1 ? 'charging' : dispatchBattery < -1 ? 'discharging' : 'idle';
  return { ...battery, chargeRate: dispatchBattery, soc, status };
}

export interface ForecastPoint {
  hr: number;
  solar: number;
  wind: number;
  hydro: number;
  demand: number;
  soc: number;
}

export function computeForecast(state: SimState): ForecastPoint[] {
  const wp = weatherProfiles[state.weather];
  const points: ForecastPoint[] = [];

  for (let hr = 0; hr < 24; hr++) {
    const solar = Math.max(0, state.solar.available * solarCurve(hr) * wp.solarMod);

    const windBase = 8 + Math.sin(hr * 0.3) * 4;
    const windSpeed = windBase * wp.windMod;
    let wind = 0;
    if (windSpeed >= 3 && windSpeed <= 25) {
      wind = windSpeed < 12 ? state.wind.capacity * Math.pow((windSpeed - 3) / 9, 3) : state.wind.capacity;
    }
    wind *= wp.windMod;

    const hydro = Math.min(state.hydro.capacity, state.hydro.flow * 1.8 * wp.hydroMod);
    const demand = 120 * demandCurve(hr);
    const totalGen = solar + wind + hydro;
    const soc = Math.max(0.1, Math.min(0.95, 0.68 + ((totalGen - demand) / state.battery.capacity) * 2));

    points.push({ hr, solar, wind, hydro, demand, soc });
  }

  return points;
}

export function fullUpdate(state: SimState): SimState {
  const solar = computeSolar(state.time, state.weather, state.solar);
  const wind = computeWind(state.time, state.weather, state.wind);
  const hydro = computeHydro(state.weather, state.hydro);
  const demand = computeDemand(state.time);

  const withEnv: SimState = { ...state, solar, wind, hydro, demand };
  const result = runOptimization(withEnv, withEnv.mode);
  const battery = computeBattery(withEnv.battery, result.dispatch.battery);

  const gridStatus: GridStatus = result.gridStable ? 'STABLE' : result.unmet > 5 ? 'CRITICAL' : 'STRESSED';
  const renewableShare = Math.min(100, result.totalGen > 0 ? (result.totalGen / Math.max(result.demand, 1)) * 100 : 0);

  return { ...withEnv, battery, optimizationResult: result, gridStatus, renewableShare };
}
