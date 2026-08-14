export interface SolarState {
  available: number;
  output: number;
  irradiance: number;
  efficiency: number;
  panelDarkness: number;
}

export interface WindState {
  capacity: number;
  output: number;
  speed: number;
  turbineRpm: number;
}

export interface HydroState {
  capacity: number;
  output: number;
  waterLevel: number;
  flow: number;
}

export type BatteryStatus = 'charging' | 'discharging' | 'idle' | 'critical';

export interface BatteryState {
  capacity: number;
  soc: number;
  chargeRate: number;
  health: number;
  status: BatteryStatus;
  maxCharge: number;
  maxDischarge: number;
}

export interface DemandState {
  total: number;
  peak: number;
  residential: number;
  commercial: number;
  industrial: number;
  public: number;
}

export type WeatherKey = 'sunny' | 'cloudy' | 'rain' | 'storm' | 'night' | 'windy';
export type OptimizationMode = 'balanced' | 'cost' | 'carbon' | 'battery';
export type GridStatus = 'STABLE' | 'STRESSED' | 'CRITICAL';
export type Section = 'landscape' | 'analytics' | 'compare' | 'how-it-works';
export type StressEvent =
  | 'solar-drop'
  | 'wind-drop'
  | 'hydro-fail'
  | 'demand-spike'
  | 'low-battery'
  | 'storm'
  | 'night'
  | 'reset';

export interface Dispatch {
  solar: number;
  wind: number;
  hydro: number;
  battery: number;
}

export interface Explanation {
  observations: string[];
  constraints: string[];
  actions: string[];
}

export interface OptimizationResult {
  dispatch: Dispatch;
  demand: number;
  totalGen: number;
  totalWithBatt: number;
  unmet: number;
  curtailed: number;
  curtailPct: number;
  operatingCost: number;
  emissions: number;
  batteryCycles: number;
  objective: number;
  explanation: Explanation;
  socAfter: number;
  gridStable: boolean;
}

export interface WeatherProfile {
  solarMod: number;
  windMod: number;
  hydroMod: number;
  skyColor: [number, number, number];
  cloudCount: number;
}

export interface SimState {
  time: number;
  weather: WeatherKey;
  mode: OptimizationMode;
  solar: SolarState;
  wind: WindState;
  hydro: HydroState;
  battery: BatteryState;
  demand: DemandState;
  gridStatus: GridStatus;
  renewableShare: number;
  optimizationResult: OptimizationResult | null;
  isRunning24h: boolean;
}

export const initialSimState: SimState = {
  time: 12,
  weather: 'sunny',
  mode: 'balanced',

  solar: { available: 120, output: 82, irradiance: 0.68, efficiency: 0.214, panelDarkness: 0 },
  wind: { capacity: 100, output: 64, speed: 11.8, turbineRpm: 0 },
  hydro: { capacity: 70, output: 51, waterLevel: 0.82, flow: 31 },
  battery: { capacity: 500, soc: 0.68, chargeRate: 42, health: 0.97, status: 'charging', maxCharge: 100, maxDischarge: 100 },
  demand: { total: 142, peak: 184, residential: 62, commercial: 41, industrial: 23, public: 16 },

  gridStatus: 'STABLE',
  renewableShare: 87.4,

  optimizationResult: null,
  isRunning24h: false,
};
