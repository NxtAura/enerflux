import type { Dispatch, Explanation, OptimizationMode, OptimizationResult, SimState } from './types';

export const WEIGHTS: Record<OptimizationMode, { cost: number; carbon: number; battery: number; curtail: number; unmet: number }> = {
  balanced: { cost: 0.3, carbon: 0.3, battery: 0.2, curtail: 0.1, unmet: 0.1 },
  cost: { cost: 0.6, carbon: 0.1, battery: 0.1, curtail: 0.1, unmet: 0.1 },
  carbon: { cost: 0.1, carbon: 0.6, battery: 0.1, curtail: 0.1, unmet: 0.1 },
  battery: { cost: 0.1, carbon: 0.1, battery: 0.6, curtail: 0.1, unmet: 0.1 },
};

// Marginal costs ($/MWh equivalent scaled to kW)
export const MARGINAL_COST = { solar: 0, wind: 0, hydro: 5 };
export const CARBON_INTENSITY = { solar: 0.04, wind: 0.01, hydro: 0.005, battery: 0.02, grid: 0.45 };
export const BATTERY_CYCLE_COST = 0.15; // $/kWh per cycle
export const CURTAILMENT_PENALTY = 2.0;
export const UNMET_DEMAND_PENALTY = 50.0;

interface Source {
  name: 'solar' | 'wind' | 'hydro';
  avail: number;
  cost: number;
  carbon: number;
  priority: number;
  score: number;
}

export function runOptimization(s: SimState, mode: OptimizationMode = s.mode): OptimizationResult {
  const w = WEIGHTS[mode];

  // Available generation
  const solarAvail = Math.max(0, s.solar.output);
  const windAvail = Math.max(0, s.wind.output);
  const hydroAvail = Math.min(s.hydro.output, s.hydro.capacity);
  const demand = s.demand.total;

  // Battery constraints
  const socMin = 0.1;
  const socMax = 1.0;
  const soc = s.battery.soc;
  const battCapacity = s.battery.capacity;
  const maxCharge = Math.min(s.battery.maxCharge, (socMax - soc) * battCapacity);
  const maxDischarge = Math.min(s.battery.maxDischarge, (soc - socMin) * battCapacity);

  const totalRenewableCap = solarAvail + windAvail + hydroAvail;

  // Greedy dispatch with weighted priority
  // Priority = low marginal cost + low carbon + renewable availability
  const sources: Source[] = [
    { name: 'solar', avail: solarAvail, cost: MARGINAL_COST.solar, carbon: CARBON_INTENSITY.solar, priority: 0, score: 0 },
    { name: 'wind', avail: windAvail, cost: MARGINAL_COST.wind, carbon: CARBON_INTENSITY.wind, priority: 1, score: 0 },
    { name: 'hydro', avail: hydroAvail, cost: MARGINAL_COST.hydro, carbon: CARBON_INTENSITY.hydro, priority: 2, score: 0 },
  ];

  // Score each source based on optimization mode
  sources.forEach(src => {
    src.score = w.cost * (src.cost / 10) + w.carbon * src.carbon + (1 - w.battery) * (src.priority * 0.05);
  });
  sources.sort((a, b) => a.score - b.score);

  let remaining = demand;
  const dispatch: Dispatch = { solar: 0, wind: 0, hydro: 0, battery: 0 };
  let curtailed = 0;

  // Dispatch renewables in priority order
  for (const src of sources) {
    const gen = Math.min(src.avail, remaining);
    dispatch[src.name] = gen;
    remaining -= gen;
    curtailed += Math.max(0, src.avail - gen);
  }

  // Battery fills remaining deficit or absorbs excess
  let batteryPower = 0;
  if (remaining > 0) {
    // Need battery discharge
    batteryPower = Math.min(remaining, maxDischarge);
    dispatch.battery = batteryPower;
    remaining -= batteryPower;
  } else if (remaining < 0) {
    // Excess generation - charge battery
    const excess = -remaining;
    batteryPower = -Math.min(excess, maxCharge);
    dispatch.battery = batteryPower;
    curtailed += Math.max(0, excess - Math.abs(batteryPower));
  }

  const totalGen = dispatch.solar + dispatch.wind + dispatch.hydro;
  const totalWithBatt = totalGen + Math.max(0, dispatch.battery);
  const unmet = Math.max(0, demand - totalWithBatt);

  // Calculate costs
  const operatingCost = totalGen * 0.001 * 24 + Math.abs(dispatch.battery) * BATTERY_CYCLE_COST * 0.5;
  const emissions =
    (dispatch.solar * CARBON_INTENSITY.solar +
      dispatch.wind * CARBON_INTENSITY.wind +
      dispatch.hydro * CARBON_INTENSITY.hydro +
      Math.max(0, dispatch.battery) * CARBON_INTENSITY.battery +
      unmet * CARBON_INTENSITY.grid) *
    0.1;
  const batteryCycles = Math.abs(dispatch.battery) / battCapacity;
  const curtailPct = totalRenewableCap > 0 ? (curtailed / totalRenewableCap) * 100 : 0;

  // Weighted objective value
  const objective =
    w.cost * operatingCost * 10 +
    w.carbon * emissions * 100 +
    w.battery * batteryCycles * 50 +
    w.curtail * curtailPct * 0.5 +
    w.unmet * unmet * 10;

  const explanation = generateExplanation(s, dispatch, demand, unmet, curtailed, mode);

  return {
    dispatch,
    demand,
    totalGen,
    totalWithBatt,
    unmet,
    curtailed,
    curtailPct,
    operatingCost,
    emissions,
    batteryCycles,
    objective,
    explanation,
    socAfter: soc + dispatch.battery / battCapacity,
    gridStable: unmet < 0.5,
  };
}

function generateExplanation(
  s: SimState,
  dispatch: Dispatch,
  demand: number,
  unmet: number,
  curtailed: number,
  mode: OptimizationMode
): Explanation {
  const observations: string[] = [];
  const constraints: string[] = [];
  const actions: string[] = [];

  const solarPct = ((dispatch.solar / s.solar.available) * 100).toFixed(0);

  if (s.solar.output < s.solar.available * 0.5) {
    observations.push(`Solar output is below 50% of capacity (${s.solar.output.toFixed(0)} kW of ${s.solar.available} kW)`);
  } else {
    observations.push(`Solar is performing well at ${solarPct}% capacity (${dispatch.solar.toFixed(0)} kW)`);
  }

  if (s.wind.speed < 8) {
    observations.push(`Wind speed is low at ${s.wind.speed.toFixed(1)} m/s, limiting generation`);
  } else {
    observations.push(`Wind at ${s.wind.speed.toFixed(1)} m/s provides ${dispatch.wind.toFixed(0)} kW`);
  }

  observations.push(`Hydro available at ${s.hydro.flow.toFixed(0)} m³/s flow rate`);
  observations.push(`Battery SOC at ${(s.battery.soc * 100).toFixed(0)}%`);

  constraints.push(`Demand must be met: ${demand.toFixed(0)} kW required`);
  if (s.battery.soc < 0.2) {
    constraints.push(`Battery SOC critically low — discharge limited to preserve health`);
  }
  if (curtailed > 5) {
    constraints.push(`${curtailed.toFixed(0)} kW of renewable energy curtailed due to low demand or battery limits`);
  }

  if (dispatch.battery > 0) {
    actions.push(`Battery discharging at ${dispatch.battery.toFixed(0)} kW to cover deficit`);
  } else if (dispatch.battery < 0) {
    actions.push(`Battery charging at ${Math.abs(dispatch.battery).toFixed(0)} kW to absorb excess renewable generation`);
  }

  if (mode === 'carbon') {
    actions.push(`Low-carbon mode: prioritizing zero-emission sources over cost`);
  } else if (mode === 'cost') {
    actions.push(`Cost-optimization mode: dispatching cheapest available generation first`);
  } else if (mode === 'battery') {
    actions.push(`Battery-life mode: minimizing charge/discharge cycling to preserve capacity`);
  }

  if (unmet > 0) {
    actions.push(`⚠ ${unmet.toFixed(1)} kW unmet demand — grid stress detected`);
  } else {
    actions.push(`All ${demand.toFixed(0)} kW demand satisfied. Grid stable.`);
  }

  return { observations, constraints, actions };
}

// Naive rule-based dispatch for comparison
export function runNaive(s: SimState): OptimizationResult {
  const demand = s.demand.total;
  let remaining = demand;
  const dispatch: Dispatch = { solar: 0, wind: 0, hydro: 0, battery: 0 };

  // Simple priority: solar first, then wind, then hydro, then battery
  dispatch.solar = Math.min(s.solar.output, remaining);
  remaining -= dispatch.solar;

  dispatch.wind = Math.min(s.wind.output, remaining);
  remaining -= dispatch.wind;

  dispatch.hydro = Math.min(s.hydro.output, remaining);
  remaining -= dispatch.hydro;

  if (remaining > 0) {
    const maxDis = Math.min(s.battery.maxDischarge, (s.battery.soc - 0.1) * s.battery.capacity);
    dispatch.battery = Math.min(remaining, maxDis);
    remaining -= dispatch.battery;
  }

  const unmet = remaining;
  const totalGen = dispatch.solar + dispatch.wind + dispatch.hydro;
  const curtailed =
    Math.max(0, s.solar.output - dispatch.solar) +
    Math.max(0, s.wind.output - dispatch.wind) +
    Math.max(0, s.hydro.output - dispatch.hydro);

  const operatingCost = totalGen * 0.001 * 24 + Math.abs(dispatch.battery) * BATTERY_CYCLE_COST * 0.5;
  const emissions =
    (dispatch.solar * 0.04 + dispatch.wind * 0.01 + dispatch.hydro * 0.005 + Math.max(0, dispatch.battery) * 0.02 + unmet * 0.45) * 0.1;
  const batteryCycles = Math.abs(dispatch.battery) / s.battery.capacity;
  const totalAvail = s.solar.output + s.wind.output + s.hydro.output;
  const curtailPct = totalAvail > 0 ? (curtailed / totalAvail) * 100 : 0;

  return {
    dispatch,
    demand,
    totalGen,
    totalWithBatt: totalGen + Math.max(0, dispatch.battery),
    unmet,
    curtailed,
    curtailPct,
    operatingCost,
    emissions,
    batteryCycles,
    objective: 0,
    explanation: { observations: [], constraints: [], actions: [] },
    socAfter: s.battery.soc,
    gridStable: unmet < 0.5,
  };
}
