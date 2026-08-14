/* ═══════════════════════════════════════════════════
   ENERFLUX — Complete Application Engine (v2)
   Fixed: battery sign, wind double-mod, DPR, stress
   mutation, clock drift, panelDarkness overflow
   ═══════════════════════════════════════════════════ */

// ─── BASELINE STATE (never mutated after init) ──
const BASE = {
  solar: { available: 120, efficiency: 0.214 },
  wind:  { capacity: 100 },
  hydro: { capacity: 70, baseFlow: 31, baseWater: 0.82 },
  batt:  { capacity: 500, soc: 0.68, health: 0.97, maxRate: 100, socMin: 0.10, socMax: 0.98 },
  demand:{ base: 142, peak: 184, res: 62, com: 41, ind: 23, pub: 16 },
};

// ─── LIVE STATE ──
const S = {
  time: 12,       // simulation hour (0-24, fractional)
  weather: 'sunny',
  mode: 'balanced',

  solarOutput: 82,
  solarIrrad: 0.68,
  panelDark: 0,

  windSpeed: 11.8,
  windOutput: 64,

  hydroFlow: 31,
  hydroOutput: 51,
  waterLevel: 0.82,

  battSoc: 0.68,
  battPower: 0,    // positive=charging, negative=discharging
  battStatus: 'idle',

  demandTotal: 142,
  demandRes: 62, demandCom: 41, demandInd: 23, demandPub: 16,

  gridStatus: 'STABLE',
  renewableShare: 87.4,

  mouseX: 0.5, mouseY: 0.5,
  parallaxX: 0, parallaxY: 0,

  result: null,
  isRunning24h: false,
};

// Stress event baselines (snapshots taken before event)
let stressBaseline = null;

// ─── WEATHER PROFILES ──
const WP = {
  sunny:  { s: 1.0,  w: 1.0,  h: 1.0,  sky: [30,60,40] },
  cloudy: { s: 0.55, w: 1.1,  h: 1.0,  sky: [25,40,50] },
  rain:   { s: 0.25, w: 1.2,  h: 1.3,  sky: [15,25,35] },
  storm:  { s: 0.1,  w: 1.8,  h: 1.4,  sky: [10,15,25] },
  night:  { s: 0.0,  w: 0.8,  h: 1.0,  sky: [5,8,15] },
  windy:  { s: 0.9,  w: 1.6,  h: 1.1,  sky: [25,55,45] },
};

// ─── SOLAR CURVE (bell at 13:00) ──
function solarCurve(hr) {
  if (hr < 5.5 || hr > 20.5) return 0;
  const x = (hr - 13) / 3.8;
  return Math.max(0, Math.exp(-x * x * 0.5) * 0.95 + 0.05);
}

// ─── DEMAND CURVE (morning + evening peaks) ──
function demandCurve(hr) {
  const m = Math.exp(-Math.pow((hr - 8) / 2.5, 2)) * 0.3;
  const e = Math.exp(-Math.pow((hr - 18) / 3, 2)) * 0.4;
  return 0.7 + m + e;
}

// ─── WIND POWER CURVE ──
function windPower(speed, capacity) {
  if (speed < 3 || speed > 25) return 0;
  if (speed < 12) return capacity * Math.pow((speed - 3) / 9, 3);
  return capacity;
}

// ─── SIMULATION UPDATE ──
function simulate() {
  const wp = WP[S.weather];
  const hr = S.time;

  // Solar
  const irr = solarCurve(hr) * wp.s;
  S.solarIrrad = irr;
  S.solarOutput = Math.max(0, BASE.solar.available * irr);
  S.panelDark = clamp(1 - irr * 1.5, 0, 1);

  // Wind (no double-modifier)
  const baseSpeed = 8 + Math.sin(hr * 0.3) * 4;
  S.windSpeed = clamp(baseSpeed * wp.w, 0, 30);
  S.windOutput = windPower(S.windSpeed, BASE.wind.capacity) * wp.w;

  // Hydro
  S.waterLevel = clamp(S.waterLevel + (wp.h - 1) * 0.005, 0.3, 1.0);
  S.hydroFlow = 20 + S.waterLevel * 20 + (wp.h - 1) * 10;
  S.hydroOutput = Math.min(BASE.hydro.capacity, S.hydroFlow * 1.8);

  // Demand
  const df = demandCurve(hr);
  S.demandTotal = Math.round(BASE.demand.base * df);
  S.demandRes = Math.round(S.demandTotal * 0.44);
  S.demandCom = Math.round(S.demandTotal * 0.29);
  S.demandInd = Math.round(S.demandTotal * 0.16);
  S.demandPub = Math.round(S.demandTotal * 0.11);

  // Optimize
  S.result = optimize();
  if (!S.result) return;

  // Battery update from optimization result
  const battKwH = S.result.battPower; // positive=charge, negative=discharge
  const socDelta = battKwH / BASE.batt.capacity * 0.1;
  S.battSoc = clamp(S.battSoc + socDelta, BASE.batt.socMin, BASE.batt.socMax);
  S.battPower = battKwH;

  if (battKwH > 1) S.battStatus = 'charging';
  else if (battKwH < -1) S.battStatus = 'discharging';
  else S.battStatus = 'idle';
  if (S.battSoc < 0.15) S.battStatus = 'critical';

  // Grid status
  S.gridStatus = S.result.stable ? 'STABLE' : (S.result.unmet > 5 ? 'CRITICAL' : 'STRESSED');
  const totalGen = S.result.gen.solar + S.result.gen.wind + S.result.gen.hydro;
  S.renewableShare = Math.min(100, S.demandTotal > 0 ? (totalGen / S.demandTotal * 100) : 0);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── OPTIMIZATION ENGINE ──
const OPT_WEIGHTS = {
  balanced: { cost: 0.3, carbon: 0.3, battery: 0.2, curtail: 0.1, unmet: 0.1 },
  cost:     { cost: 0.6, carbon: 0.1, battery: 0.1, curtail: 0.1, unmet: 0.1 },
  carbon:   { cost: 0.1, carbon: 0.6, battery: 0.1, curtail: 0.1, unmet: 0.1 },
  battery:  { cost: 0.1, carbon: 0.1, battery: 0.6, curtail: 0.1, unmet: 0.1 },
};
const MARGINAL_COST = { solar: 0, wind: 0, hydro: 5 };
const CARBON_INT = { solar: 0.04, wind: 0.01, hydro: 0.005, battery: 0.02, grid: 0.45 };
const BATT_CYCLE_COST = 0.15;

function optimize(mode) {
  mode = mode || S.mode;
  const w = OPT_WEIGHTS[mode];
  const demand = S.demandTotal;
  const solarAv = Math.max(0, S.solarOutput);
  const windAv = Math.max(0, S.windOutput);
  const hydroAv = Math.min(S.hydroOutput, BASE.hydro.capacity);
  const soc = S.battSoc;
  const maxCharge = Math.min(BASE.batt.maxRate, (BASE.batt.socMax - soc) * BASE.batt.capacity);
  const maxDischarge = Math.min(BASE.batt.maxRate, (soc - BASE.batt.socMin) * BASE.batt.capacity);

  // Score and sort sources
  const sources = [
    { name: 'solar', avail: solarAv, cost: MARGINAL_COST.solar, ci: CARBON_INT.solar, pri: 0 },
    { name: 'wind',  avail: windAv,  cost: MARGINAL_COST.wind,  ci: CARBON_INT.wind,  pri: 1 },
    { name: 'hydro', avail: hydroAv, cost: MARGINAL_COST.hydro, ci: CARBON_INT.hydro, pri: 2 },
  ];
  sources.forEach(s => { s.score = w.cost * (s.cost / 10) + w.carbon * s.ci + (1 - w.battery) * s.pri * 0.05; });
  sources.sort((a, b) => a.score - b.score);

  let remaining = demand;
  const gen = { solar: 0, wind: 0, hydro: 0 };
  let curtailed = 0;

  for (const src of sources) {
    const g = Math.min(src.avail, remaining);
    gen[src.name] = g;
    remaining -= g;
    curtailed += Math.max(0, src.avail - g);
  }

  let battPower = 0; // positive=charge, negative=discharge
  if (remaining > 0) {
    battPower = -Math.min(remaining, maxDischarge); // discharge
    remaining += battPower; // remaining decreases
  } else if (remaining < 0) {
    const excess = -remaining;
    battPower = Math.min(excess, maxCharge); // charge
    remaining = 0;
    curtailed += Math.max(0, excess - battPower);
  }

  const totalGen = gen.solar + gen.wind + gen.hydro;
  const totalSupply = totalGen + Math.max(0, -battPower); // discharge adds to supply
  const unmet = Math.max(0, demand - totalSupply);
  const renewableCap = solarAv + windAv + hydroAv;
  const curtailPct = renewableCap > 0 ? (curtailed / renewableCap * 100) : 0;

  const opCost = totalGen * 0.001 * 24 + Math.abs(battPower) * BATT_CYCLE_COST * 0.5;
  const emissions = (gen.solar * CARBON_INT.solar + gen.wind * CARBON_INT.wind + gen.hydro * CARBON_INT.hydro +
    Math.max(0, -battPower) * CARBON_INT.battery + unmet * CARBON_INT.grid) * 0.1;
  const battCycles = Math.abs(battPower) / BASE.batt.capacity;

  const explanation = buildExplanation(gen, demand, unmet, curtailed, mode);

  return {
    gen, battPower, demand, totalGen, totalSupply, unmet,
    curtailed, curtailPct, opCost, emissions, battCycles,
    stable: unmet < 0.5, explanation,
  };
}

function buildExplanation(gen, demand, unmet, curtailed, mode) {
  const obs = [], con = [], act = [];

  if (S.solarOutput < BASE.solar.available * 0.5)
    obs.push('Solar output is below 50% of capacity (' + S.solarOutput.toFixed(0) + ' kW of ' + BASE.solar.available + ' kW)');
  else
    obs.push('Solar performing at ' + (gen.solar / BASE.solar.available * 100).toFixed(0) + '% capacity (' + gen.solar.toFixed(0) + ' kW)');

  if (S.windSpeed < 8)
    obs.push('Wind speed low at ' + S.windSpeed.toFixed(1) + ' m/s, limiting generation');
  else
    obs.push('Wind at ' + S.windSpeed.toFixed(1) + ' m/s provides ' + gen.wind.toFixed(0) + ' kW');

  obs.push('Hydro available at ' + S.hydroFlow.toFixed(0) + ' m3/s flow rate');
  obs.push('Battery SOC at ' + (S.battSoc * 100).toFixed(0) + '%');

  con.push('Demand must be met: ' + demand.toFixed(0) + ' kW required');
  if (S.battSoc < 0.2) con.push('Battery SOC critically low - discharge limited');
  if (curtailed > 5) con.push(curtailed.toFixed(0) + ' kW renewable curtailed due to low demand or battery limits');

  if (S.battPower < -1) act.push('Battery discharging at ' + Math.abs(S.battPower).toFixed(0) + ' kW to cover deficit');
  else if (S.battPower > 1) act.push('Battery charging at ' + S.battPower.toFixed(0) + ' kW to absorb excess generation');

  if (mode === 'carbon') act.push('Low-carbon mode: prioritizing zero-emission sources');
  else if (mode === 'cost') act.push('Cost mode: dispatching cheapest generation first');
  else if (mode === 'battery') act.push('Battery-life mode: minimizing charge/discharge cycling');

  if (unmet > 0) act.push(unmet.toFixed(1) + ' kW unmet demand - grid stress detected');
  else act.push('All ' + demand.toFixed(0) + ' kW demand satisfied. Grid stable.');

  return { obs, con, act };
}

function runNaive() {
  const demand = S.demandTotal;
  let rem = demand;
  const gen = { solar: 0, wind: 0, hydro: 0 };

  gen.solar = Math.min(S.solarOutput, rem); rem -= gen.solar;
  gen.wind = Math.min(S.windOutput, rem); rem -= gen.wind;
  gen.hydro = Math.min(S.hydroOutput, rem); rem -= gen.hydro;

  let batt = 0;
  if (rem > 0) {
    const maxD = Math.min(BASE.batt.maxRate, (S.battSoc - BASE.batt.socMin) * BASE.batt.capacity);
    batt = -Math.min(rem, maxD);
    rem += batt;
  }

  const totalGen = gen.solar + gen.wind + gen.hydro;
  const unmet = Math.max(0, rem);
  const curtailed = Math.max(0, S.solarOutput - gen.solar) + Math.max(0, S.windOutput - gen.wind) + Math.max(0, S.hydroOutput - gen.hydro);
  const renewableCap = S.solarOutput + S.windOutput + S.hydroOutput;
  const curtailPct = renewableCap > 0 ? (curtailed / renewableCap * 100) : 0;
  const opCost = totalGen * 0.001 * 24 + Math.abs(batt) * BATT_CYCLE_COST * 0.5;
  const emissions = (gen.solar * 0.04 + gen.wind * 0.01 + gen.hydro * 0.005 + Math.max(0, -batt) * 0.02 + unmet * 0.45) * 0.1;
  const battCycles = Math.abs(batt) / BASE.batt.capacity;

  return { gen, battPower: batt, demand, totalGen, unmet, curtailPct, opCost, emissions, battCycles, stable: unmet < 0.5 };
}

// ─── CANVAS LANDSCAPE ──
const L = {
  canvas: null, ctx: null, W: 0, H: 0, t: 0, waterOff: 0,
  clouds: [], stars: [], trees: [], rocks: [], grass: [],

  init() {
    this.canvas = document.getElementById('landscape-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.genStars(); this.genClouds(); this.genTrees(); this.genRocks(); this.genGrass();
  },

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  genStars() { this.stars = Array.from({length: 60}, () => ({ x: Math.random(), y: Math.random() * 0.45, s: 0.4 + Math.random() * 1.2 })); },
  genClouds() { this.clouds = Array.from({length: 10}, () => ({ x: Math.random() * 1.5 - 0.25, y: 0.04 + Math.random() * 0.15, w: 0.06 + Math.random() * 0.14, h: 0.015 + Math.random() * 0.03, spd: 0.00005 + Math.random() * 0.00015, a: 0.12 + Math.random() * 0.18 })); },
  genTrees() { this.trees = Array.from({length: 90}, (_, i) => ({ x: i / 90, h: 0.015 + Math.random() * 0.025, w: 0.005 + Math.random() * 0.004, shade: 0.6 + Math.random() * 0.4 })); },
  genRocks() { this.rocks = Array.from({length: 18}, () => ({ x: Math.random(), y: Math.random(), s: 2 + Math.random() * 4 })); },
  genGrass() { this.grass = Array.from({length: 50}, () => ({ x: Math.random(), y: Math.random(), h: 3 + Math.random() * 5, lean: (Math.random() - 0.5) * 3 })); },

  px(frac, axis) { return axis === 'x' ? frac * this.W : frac * this.H; },

  render() {
    const ctx = this.ctx, W = this.W, H = this.H;
    const mx = S.parallaxX, my = S.parallaxY;
    const wp = WP[S.weather];
    const sky = wp.sky;

    ctx.clearRect(0, 0, W, H);

    // ── SKY ──
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    skyGrad.addColorStop(0, `rgb(${sky[0]},${sky[1]},${sky[2]})`);
    skyGrad.addColorStop(1, `rgb(${sky[0]+18},${sky[1]+28},${sky[2]+12})`);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H * 0.62);

    // ── STARS (night) ──
    if (S.weather === 'night') {
      this.stars.forEach(st => {
        const a = 0.4 + Math.sin(this.t * 0.4 + st.x * 50) * 0.3;
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath();
        ctx.arc(st.x * W + mx * -0.5, st.y * H + my * -0.3, st.s, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // ── SUN / MOON ──
    const sunX = W * 0.72 + mx * -3, sunY = H * 0.1 + my * -2;
    if (S.weather !== 'night') {
      const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 100);
      const sa = clamp(1 - S.panelDark * 0.7, 0.1, 1);
      sg.addColorStop(0, `rgba(255,220,100,${0.85 * sa})`);
      sg.addColorStop(0.35, `rgba(255,200,80,${0.25 * sa})`);
      sg.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sunX - 120, sunY - 120, 240, 240);
      ctx.beginPath();
      ctx.arc(sunX, sunY, 16, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,230,130,${sa})`;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(sunX, sunY, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(190,200,220,0.75)';
      ctx.fill();
      // Moon shadow
      ctx.beginPath();
      ctx.arc(sunX + 4, sunY - 2, 10, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${sky[0]},${sky[1]},${sky[2]})`;
      ctx.fill();
    }

    // ── CLOUDS ──
    this.clouds.forEach(c => {
      c.x += c.spd;
      if (c.x > 1.3) c.x = -0.2;
      const cx = c.x * W + mx * -4;
      const cy = c.y * H + my * -2;
      const cw = c.w * W, ch = c.h * H;
      const a = c.a * (S.weather === 'night' ? 0.25 : 1);
      ctx.fillStyle = `rgba(170,185,200,${a})`;
      ctx.beginPath(); ctx.ellipse(cx, cy, cw / 2, ch / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - cw * 0.28, cy + ch * 0.2, cw * 0.35, ch * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + cw * 0.22, cy + ch * 0.15, cw * 0.3, ch * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    });

    // ── RAIN ──
    if (S.weather === 'storm' || S.weather === 'rain') {
      ctx.strokeStyle = S.weather === 'storm' ? 'rgba(140,170,210,0.3)' : 'rgba(110,150,190,0.2)';
      ctx.lineWidth = 1;
      const n = S.weather === 'storm' ? 140 : 70;
      for (let i = 0; i < n; i++) {
        const rx = (i * 17.3 + this.t * 220) % W;
        const ry = (i * 23.7 + this.t * 450) % H;
        const rl = S.weather === 'storm' ? 14 : 9;
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 2, ry + rl); ctx.stroke();
      }
    }

    // ── FAR MOUNTAINS ──
    this.drawMountains(ctx, W, H, mx, my, sky);

    // ── FOREST ──
    const fY = H * 0.46;
    this.trees.forEach(t => {
      const tx = t.x * (W + 80) - 40 + mx * -5;
      const ty = fY + my * -1.5;
      const th = t.h * H;
      const tw = t.w * W;
      ctx.fillStyle = `rgba(${16 + t.shade * 6},${32 + t.shade * 10},${20 + t.shade * 4},0.95)`;
      ctx.beginPath();
      ctx.moveTo(tx, ty - th);
      ctx.lineTo(tx - tw, ty);
      ctx.lineTo(tx + tw, ty);
      ctx.closePath();
      ctx.fill();
    });

    // ── GROUND ──
    const gY = H * 0.54;
    const gGrad = ctx.createLinearGradient(0, gY, 0, H);
    gGrad.addColorStop(0, '#183322');
    gGrad.addColorStop(0.35, '#132818');
    gGrad.addColorStop(1, '#0b160e');
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, gY, W, H - gY);

    // Terrain lines
    ctx.strokeStyle = 'rgba(35,65,40,0.25)';
    ctx.lineWidth = 0.8;
    for (let r = 0; r < 6; r++) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const n = Math.sin(x * 0.008 + r * 1.8) * 3 + Math.sin(x * 0.003 + r) * 5;
        const ry = gY + 15 + r * 25 + my * -1.5 + n;
        x === 0 ? ctx.moveTo(x + mx * -7, ry) : ctx.lineTo(x + mx * -7, ry);
      }
      ctx.stroke();
    }

    // Rocks
    this.rocks.forEach(r => {
      ctx.fillStyle = 'rgba(55,50,42,0.55)';
      ctx.beginPath();
      ctx.ellipse(r.x * W + mx * -8, gY + 30 + r.y * 70 + my * -2, r.s, r.s * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // Grass
    this.grass.forEach(g => {
      ctx.strokeStyle = 'rgba(35,75,40,0.4)';
      ctx.lineWidth = 0.8;
      const gx = g.x * W + mx * -8;
      const gy = gY + 20 + g.y * 80 + my * -2;
      const sway = Math.sin(this.t * 0.8 + g.x * 10) * 1.5;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + g.lean + sway, gy - g.h);
      ctx.stroke();
    });

    // Road
    ctx.strokeStyle = 'rgba(70,65,55,0.35)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const n = Math.sin(x * 0.004) * 6;
      x === 0 ? ctx.moveTo(x + mx * -8, gY + 55 + n + my * -2) : ctx.lineTo(x + mx * -8, gY + 55 + n + my * -2);
    }
    ctx.stroke();

    // ── WATER STREAM ──
    this.drawWater(ctx, W, H, mx, my, gY);

    // ── INFRASTRUCTURE ──
    this.drawSolar(ctx, W, H, mx, my, gY);
    this.drawWind(ctx, W, H, mx, my, gY);
    this.drawHydro(ctx, W, H, mx, my, gY);
    this.drawBattery(ctx, W, H, mx, my, gY);
    this.drawHouses(ctx, W, H, mx, my, gY);
    this.drawTransmission(ctx, W, H, mx, my, gY);

    // ── ENERGY PARTICLES ──
    this.drawParticles(ctx, W, H, mx, my, gY);

    // ── ATMOSPHERIC HAZE ──
    const haze = ctx.createLinearGradient(0, H * 0.38, 0, H * 0.6);
    haze.addColorStop(0, 'rgba(25,45,35,0)');
    haze.addColorStop(1, `rgba(${sky[0]+8},${sky[1]+16},${sky[2]+8},0.15)`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, H * 0.38, W, H * 0.22);

    this.t += 0.016;
    this.waterOff += 0.6;
  },

  drawMountains(ctx, W, H, mx, my, sky) {
    const bY = H * 0.36;
    // Far
    ctx.fillStyle = `rgba(${sky[0]+8},${sky[1]+18},${sky[2]+8},0.88)`;
    ctx.beginPath();
    ctx.moveTo(-40 + mx * -1.5, bY + 55 + my * -0.8);
    for (let x = -40; x <= W + 40; x += 3) {
      const n = Math.sin(x * 0.0025) * 55 + Math.sin(x * 0.006) * 28 + Math.sin(x * 0.001 + 0.5) * 75;
      ctx.lineTo(x + mx * -1.5, bY + 55 - n + my * -0.8);
    }
    ctx.lineTo(W + 40, H); ctx.lineTo(-40, H); ctx.closePath(); ctx.fill();
    // Near
    ctx.fillStyle = `rgba(${sky[0]+4},${sky[1]+10},${sky[2]+5},0.94)`;
    ctx.beginPath();
    ctx.moveTo(-40 + mx * -3, bY + 90 + my * -1.5);
    for (let x = -40; x <= W + 40; x += 3) {
      const n = Math.sin(x * 0.004 + 1) * 40 + Math.sin(x * 0.0018 + 2) * 55;
      ctx.lineTo(x + mx * -3, bY + 90 - n + my * -1.5);
    }
    ctx.lineTo(W + 40, H); ctx.lineTo(-40, H); ctx.closePath(); ctx.fill();
    // Snow caps
    ctx.fillStyle = 'rgba(220,230,240,0.08)';
    for (let x = -40; x <= W + 40; x += 3) {
      const n = Math.sin(x * 0.0025) * 55 + Math.sin(x * 0.006) * 28 + Math.sin(x * 0.001 + 0.5) * 75;
      const peakY = bY + 55 - n + my * -0.8;
      if (peakY < bY + 10) {
        ctx.beginPath();
        ctx.arc(x + mx * -1.5, peakY + 3, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  drawWater(ctx, W, H, mx, my, gY) {
    const wX = W * 0.24, wY = gY - 4;
    const flow = S.hydroFlow / 40;
    ctx.fillStyle = `rgba(35,90,130,${0.35 + flow * 0.15})`;
    ctx.beginPath();
    ctx.moveTo(wX + mx * -6, wY + my * -1.5);
    for (let y = 0; y < 90; y += 3) {
      const x = wX + Math.sin((y + this.waterOff) * 0.07) * 12 + mx * -6;
      ctx.lineTo(x, wY + y + my * -1.5);
    }
    ctx.lineTo(wX + 35 + mx * -6, wY + 90 + my * -1.5);
    ctx.lineTo(wX - 15 + mx * -6, wY + 90 + my * -1.5);
    ctx.closePath(); ctx.fill();
    // Shimmer
    for (let i = 0; i < 6; i++) {
      const sx = wX + Math.sin((this.waterOff + i * 18) * 0.04) * 8 + mx * -6;
      const sy = wY + i * 13 + Math.sin((this.waterOff + i * 8) * 0.03) * 2 + my * -1.5;
      ctx.fillStyle = `rgba(70,150,200,${0.12 + flow * 0.08})`;
      ctx.beginPath(); ctx.ellipse(sx, sy, 7, 1.2, 0, 0, Math.PI * 2); ctx.fill();
    }
  },

  drawSolar(ctx, W, H, mx, my, gY) {
    const sx = W * 0.14 + mx * -7, sy = gY + 12 + my * -2.5;
    const dk = S.panelDark;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const px = sx + c * 20 + r * 7, py = sy + r * 13;
        ctx.fillStyle = `rgba(${38 + dk * 25},${52 + dk * 18},${78 + dk * 12},0.92)`;
        ctx.fillRect(px, py, 16, 9);
        ctx.fillStyle = `rgba(${48 + dk * 35},${65 + dk * 28},${115 - dk * 35},0.82)`;
        ctx.fillRect(px + 1, py + 1, 6, 3.5);
        ctx.fillRect(px + 8, py + 1, 7, 3.5);
        ctx.fillRect(px + 1, py + 5.5, 6, 2.5);
        ctx.fillRect(px + 8, py + 5.5, 7, 2.5);
        if (dk < 0.4) {
          ctx.fillStyle = `rgba(255,240,150,${(0.4 - dk) * 0.25})`;
          ctx.fillRect(px + 3, py + 2, 3, 1.5);
        }
      }
    }
    // Stands
    ctx.strokeStyle = 'rgba(75,75,75,0.5)';
    ctx.lineWidth = 0.8;
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      ctx.moveTo(sx + r * 7 + 8, sy + r * 13 + 9);
      ctx.lineTo(sx + r * 7 + 8, sy + r * 13 + 16);
      ctx.stroke();
    }
  },

  drawWind(ctx, W, H, mx, my, gY) {
    const bx = W * 0.4 + mx * -9, by = gY + 4 + my * -2.5;
    const rpm = S.windSpeed * 2.5;
    for (let i = 0; i < 3; i++) {
      const tx = bx + i * 50;
      const ty = by - (i === 1 ? 8 : 0);
      const th = 58 + (i === 1 ? 8 : 0);
      // Tower (tapered)
      ctx.strokeStyle = 'rgba(175,180,185,0.65)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(tx - 1, ty); ctx.lineTo(tx, ty - th); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tx + 1, ty); ctx.lineTo(tx, ty - th); ctx.stroke();
      // Nacelle
      ctx.fillStyle = 'rgba(195,200,205,0.75)';
      ctx.fillRect(tx - 3, ty - th - 2, 8, 5);
      // Blades
      const bl = 25 + (i === 1 ? 4 : 0);
      const ang = this.t * rpm * 0.008 + i * 2.1;
      ctx.strokeStyle = 'rgba(205,210,215,0.75)';
      ctx.lineWidth = 1.8;
      for (let b = 0; b < 3; b++) {
        const ba = ang + b * Math.PI * 2 / 3;
        ctx.beginPath();
        ctx.moveTo(tx + 1, ty - th);
        ctx.lineTo(tx + 1 + Math.cos(ba) * bl, ty - th + Math.sin(ba) * bl);
        ctx.stroke();
      }
      // Hub
      ctx.beginPath(); ctx.arc(tx + 1, ty - th, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(150,155,160,0.85)'; ctx.fill();
    }
  },

  drawHydro(ctx, W, H, mx, my, gY) {
    const dx = W * 0.21 + mx * -6, dy = gY - 4 + my * -1.5;
    // Dam wall
    ctx.fillStyle = 'rgba(95,95,100,0.82)';
    ctx.beginPath();
    ctx.moveTo(dx, dy - 26); ctx.lineTo(dx + 44, dy - 26);
    ctx.lineTo(dx + 48, dy + 12); ctx.lineTo(dx - 4, dy + 12);
    ctx.closePath(); ctx.fill();
    // Segments
    ctx.strokeStyle = 'rgba(75,75,80,0.4)';
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(dx + 2 + i * 10, dy - 24);
      ctx.lineTo(dx + 3 + i * 10, dy + 10);
      ctx.stroke();
    }
    // Water spill
    const fl = S.hydroFlow / 40;
    ctx.fillStyle = `rgba(55,130,190,${0.25 + fl * 0.25})`;
    for (let i = 0; i < 5; i++) {
      const wx = dx + 8 + i * 7;
      const wy = dy - 24 + Math.sin(this.waterOff * 0.04 + i) * 1.5;
      ctx.beginPath(); ctx.ellipse(wx, wy, 2.5, 1.5 + fl * 2.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Reservoir
    ctx.fillStyle = `rgba(30,80,120,${0.3 + S.waterLevel * 0.2})`;
    ctx.beginPath();
    ctx.moveTo(dx - 30 + mx * -6, dy - 26 + my * -1.5);
    for (let x = dx - 30; x <= dx; x += 3) {
      const wave = Math.sin((x + this.waterOff) * 0.06) * 1.5;
      ctx.lineTo(x + mx * -6, dy - 26 + wave + my * -1.5);
    }
    ctx.lineTo(dx - 30 + mx * -6, dy - 35 + my * -1.5);
    ctx.closePath(); ctx.fill();
  },

  drawBattery(ctx, W, H, mx, my, gY) {
    const bx = W * 0.6 + mx * -11, by = gY + 18 + my * -3;
    const soc = S.battSoc;
    const color = soc > 0.5 ? [46,204,113] : soc > 0.2 ? [240,192,64] : [231,76,60];

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(bx + 3, by + 3, 50, 26);

    // Body
    ctx.fillStyle = 'rgba(45,50,50,0.9)';
    ctx.fillRect(bx, by, 50, 26);

    // SOC fill
    const sw = 46 * soc;
    ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.55)`;
    ctx.fillRect(bx + 2, by + 2, sw, 22);

    // Glow when active
    if (S.battStatus === 'charging' || S.battStatus === 'discharging') {
      ctx.shadowColor = `rgba(${color[0]},${color[1]},${color[2]},0.35)`;
      ctx.shadowBlur = 12;
      ctx.fillRect(bx, by, 50, 26);
      ctx.shadowBlur = 0;
    }

    // Outline
    ctx.strokeStyle = 'rgba(90,95,95,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, 50, 26);

    // Label
    ctx.fillStyle = 'rgba(190,190,190,0.65)';
    ctx.font = '7px sans-serif';
    ctx.fillText('BESS', bx + 16, by + 16);

    // Charge indicator arrows
    if (S.battStatus === 'charging') {
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.6)`;
      ctx.font = '10px sans-serif';
      ctx.fillText('+', bx + 52, by + 16);
    } else if (S.battStatus === 'discharging') {
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.6)`;
      ctx.font = '10px sans-serif';
      ctx.fillText('-', bx + 52, by + 16);
    }
  },

  drawHouses(ctx, W, H, mx, my, gY) {
    const hx0 = W * 0.76 + mx * -13, hy0 = gY + 8 + my * -3;
    const di = S.demandTotal / 200;
    for (let i = 0; i < 5; i++) {
      const hx = hx0 + i * 28;
      const hy = hy0 + Math.sin(i * 1.5) * 4;
      const hh = 16 + (i % 2) * 7;
      // Body
      ctx.fillStyle = `rgba(${42 + i * 4},${48 + i * 3},${45 + i * 3},0.88)`;
      ctx.fillRect(hx, hy - hh, 20, hh);
      // Roof
      ctx.fillStyle = `rgba(${55 + i * 3},${50 + i * 2},${45},0.82)`;
      ctx.beginPath();
      ctx.moveTo(hx - 2, hy - hh);
      ctx.lineTo(hx + 10, hy - hh - 9);
      ctx.lineTo(hx + 22, hy - hh);
      ctx.closePath(); ctx.fill();
      // Windows
      const wg = di * (0.5 + Math.sin(this.t * 0.4 + i * 1.3) * 0.15);
      ctx.fillStyle = `rgba(255,215,110,${wg * 0.75})`;
      ctx.fillRect(hx + 3, hy - hh + 4, 4, 4);
      ctx.fillRect(hx + 12, hy - hh + 4, 4, 4);
      if (hh > 18) {
        ctx.fillRect(hx + 3, hy - hh + 11, 4, 4);
        ctx.fillRect(hx + 12, hy - hh + 11, 4, 4);
      }
    }
  },

  drawTransmission(ctx, W, H, mx, my, gY) {
    const ly = gY - 4 + my * -2.5;
    const solarEnd = W * 0.14 + 72 + mx * -7;
    const windEnd = W * 0.4 + 50 + mx * -9;
    const gridX = W * 0.48 + mx * -9;
    const demandX = W * 0.76 + mx * -13;
    const battX = W * 0.6 + 25 + mx * -11;

    ctx.strokeStyle = 'rgba(90,90,90,0.25)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 3]);
    // Solar to grid
    ctx.beginPath(); ctx.moveTo(solarEnd, ly); ctx.lineTo(gridX, ly); ctx.stroke();
    // Wind to grid
    ctx.beginPath(); ctx.moveTo(windEnd, ly); ctx.lineTo(gridX, ly); ctx.stroke();
    // Grid to demand
    ctx.beginPath(); ctx.moveTo(gridX, ly); ctx.lineTo(demandX, ly); ctx.stroke();
    // Grid to battery
    ctx.beginPath(); ctx.moveTo(gridX, ly); ctx.lineTo(battX, ly); ctx.stroke();
    ctx.setLineDash([]);

    // Grid node
    ctx.beginPath(); ctx.arc(gridX, ly, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(46,204,113,0.45)'; ctx.fill();
    ctx.strokeStyle = 'rgba(46,204,113,0.65)'; ctx.lineWidth = 1.2; ctx.stroke();
  },

  drawParticles(ctx, W, H, mx, my, gY) {
    if (!S.result) return;
    const ly = gY - 4 + my * -2.5;
    const gen = S.result.gen;
    const batt = S.result.battPower;

    const routes = [];
    if (gen.solar > 1) routes.push({ x0: W * 0.14 + 72, x1: W * 0.48, p: gen.solar, c: [240,192,64] });
    if (gen.wind > 1) routes.push({ x0: W * 0.4 + 50, x1: W * 0.48, p: gen.wind, c: [78,205,196] });
    if (gen.solar + gen.wind + gen.hydro > 1) routes.push({ x0: W * 0.48, x1: W * 0.76, p: gen.solar + gen.wind + gen.hydro, c: [100,180,255] });

    const battX = W * 0.6 + 25;
    if (batt > 1) routes.push({ x0: W * 0.48, x1: battX, p: batt, c: [46,204,113] });
    else if (batt < -1) routes.push({ x0: battX, x1: W * 0.48, p: Math.abs(batt), c: [46,204,113] });

    routes.forEach(rt => {
      const n = Math.min(14, Math.max(2, Math.ceil(rt.p / 14)));
      const spd = 0.35 + rt.p / 70;
      for (let i = 0; i < n; i++) {
        const prog = (this.t * spd * 0.3 + i / n) % 1;
        const px = rt.x0 + (rt.x1 - rt.x0) * prog + mx * -9;
        const py = ly + Math.sin(prog * Math.PI * 2.5 + i * 0.7) * 3.5;
        const a = 0.5 + Math.sin(prog * Math.PI) * 0.4;
        // Core
        ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rt.c[0]},${rt.c[1]},${rt.c[2]},${a})`;
        ctx.fill();
        // Glow
        const gg = ctx.createRadialGradient(px, py, 0, px, py, 7);
        gg.addColorStop(0, `rgba(${rt.c[0]},${rt.c[1]},${rt.c[2]},0.2)`);
        gg.addColorStop(1, `rgba(${rt.c[0]},${rt.c[1]},${rt.c[2]},0)`);
        ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.fillStyle = gg; ctx.fill();
      }
    });
  },

  animate() { this.render(); requestAnimationFrame(() => this.animate()); }
};

// ─── UI ──
const UI = {
  init() {
    this.bindNav();
    document.querySelectorAll('.stress-btn').forEach(b => b.addEventListener('click', () => this.applyStress(b.dataset.event)));
    document.querySelectorAll('.weather-btn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.weather-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      S.weather = b.dataset.weather;
      simulate(); this.updateUI();
    }));
    document.getElementById('btn-optimize').addEventListener('click', () => { simulate(); this.updateUI(); this.showDecision(); });
    document.getElementById('btn-simulate-event').addEventListener('click', () => {
      const evts = ['solar-drop','wind-drop','demand-spike','storm'];
      this.applyStress(evts[Math.floor(Math.random() * evts.length)]);
    });
    document.getElementById('btn-cascade').addEventListener('click', () => this.triggerCascade());
    document.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      S.mode = b.dataset.mode;
      simulate(); this.updateUI(); this.showDecision();
    }));
    document.querySelectorAll('.flow-item').forEach(it => it.addEventListener('click', () => this.showDecision()));
    document.getElementById('close-decision').addEventListener('click', () => document.getElementById('decision-panel').classList.add('hidden'));
    document.getElementById('math-toggle').addEventListener('click', () => {
      const c = document.getElementById('math-content');
      c.classList.toggle('hidden');
      document.getElementById('math-toggle').textContent = c.classList.contains('hidden') ? 'Show Mathematical Formulation' : 'Hide Mathematical Formulation';
    });
    document.getElementById('btn-recover').addEventListener('click', () => this.recover());
    document.getElementById('btn-run-24h').addEventListener('click', () => this.run24h());
    this.startClock();
  },

  bindNav() {
    document.querySelectorAll('.nav-link').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sec = btn.dataset.section;
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById('section-' + sec).classList.add('active');
      if (sec === 'analytics') this.renderChart();
      if (sec === 'compare') this.updateCompare();
    }));
  },

  applyStress(evt) {
    // Take snapshot before mutation
    stressBaseline = {
      solar: S.solarOutput, wind: S.windOutput, hydro: S.hydroOutput,
      demand: S.demandTotal, soc: S.battSoc, weather: S.weather,
      res: S.demandRes, com: S.demandCom, ind: S.demandInd, pub: S.demandPub,
      windSpeed: S.windSpeed, hydroFlow: S.hydroFlow, waterLevel: S.waterLevel,
    };
    const b = stressBaseline;

    switch (evt) {
      case 'solar-drop':
        S.solarOutput = b.solar * 0.15;
        S.panelDark = 0.85;
        break;
      case 'wind-drop':
        S.windOutput = b.wind * 0.15;
        S.windSpeed = b.windSpeed * 0.2;
        break;
      case 'hydro-fail':
        S.hydroOutput = b.hydro * 0.1;
        S.hydroFlow = b.hydroFlow * 0.1;
        break;
      case 'demand-spike':
        S.demandTotal = Math.round(b.demand * 1.6);
        S.demandRes = Math.round(b.res * 1.4);
        S.demandCom = Math.round(b.com * 1.5);
        S.demandInd = Math.round(b.ind * 2.0);
        S.demandPub = Math.round(b.pub * 1.3);
        break;
      case 'low-battery':
        S.battSoc = 0.12;
        break;
      case 'storm':
        S.solarOutput = b.solar * 0.1;
        S.windSpeed = b.windSpeed * 1.8;
        S.windOutput = windPower(S.windSpeed, BASE.wind.capacity) * WP.storm.w;
        S.hydroOutput = Math.min(BASE.hydro.capacity, (b.waterLevel * 20 + 20 + (WP.storm.h - 1) * 10) * 1.8);
        S.weather = 'storm';
        document.querySelectorAll('.weather-btn').forEach(x => x.classList.remove('active'));
        document.querySelector('[data-weather="storm"]').classList.add('active');
        break;
      case 'night':
        S.solarOutput = 0;
        S.solarIrrad = 0;
        S.panelDark = 1;
        S.weather = 'night';
        document.querySelectorAll('.weather-btn').forEach(x => x.classList.remove('active'));
        document.querySelector('[data-weather="night"]').classList.add('active');
        break;
      case 'reset':
        stressBaseline = null;
        S.weather = 'sunny';
        document.querySelectorAll('.weather-btn').forEach(x => x.classList.remove('active'));
        document.querySelector('[data-weather="sunny"]').classList.add('active');
        simulate(); this.updateUI();
        document.getElementById('stress-result').classList.add('hidden');
        return;
    }

    simulate();
    const r = S.result;

    // Before/after display
    const before = stressBaseline;
    const el = document.getElementById('stress-result');
    el.classList.remove('hidden');
    el.innerHTML = `<strong>BEFORE</strong> Demand: ${before.demand} kW | Gen: ${(before.solar + before.wind + before.hydro).toFixed(0)} kW<br>` +
      `<strong>AFTER</strong> Solar: ${r.gen.solar.toFixed(0)} | Wind: ${r.gen.wind.toFixed(0)} | Hydro: ${r.gen.hydro.toFixed(0)} | Batt: ${r.battPower > 0 ? '+' : ''}${r.battPower.toFixed(0)} kW<br>` +
      `Total: ${r.totalSupply.toFixed(0)} kW | <span style="color:${r.stable ? 'var(--green)' : 'var(--red)'}">${r.stable ? 'GRID STABLE' : 'GRID STRESSED'}</span>`;

    this.showDecision();
    this.updateUI();
  },

  triggerCascade() {
    stressBaseline = {
      solar: S.solarOutput, wind: S.windOutput, hydro: S.hydroOutput,
      demand: S.demandTotal, soc: S.battSoc, weather: S.weather,
      res: S.demandRes, com: S.demandCom, ind: S.demandInd, pub: S.demandPub,
      windSpeed: S.windSpeed, hydroFlow: S.hydroFlow, waterLevel: S.waterLevel,
    };
    S.solarOutput *= 0.15; S.panelDark = 0.85;
    S.windSpeed *= 0.3; S.windOutput = windPower(S.windSpeed, BASE.wind.capacity) * WP.storm.w;
    S.demandTotal = Math.round(S.demandTotal * 1.5);
    S.demandRes = Math.round(S.demandRes * 1.3);
    S.demandCom = Math.round(S.demandCom * 1.5);
    S.demandInd = Math.round(S.demandInd * 1.8);
    S.demandPub = Math.round(S.demandPub * 1.2);
    S.battSoc = 0.15;
    S.weather = 'storm';
    document.querySelectorAll('.weather-btn').forEach(x => x.classList.remove('active'));
    document.querySelector('[data-weather="storm"]').classList.add('active');
    simulate(); this.updateUI();
    this.showEmergency();
  },

  recover() {
    document.getElementById('emergency-banner').classList.add('hidden');
    simulate(); this.updateUI(); this.showDecision();
    const stab = document.getElementById('stabilized-banner');
    stab.classList.remove('hidden');
    document.getElementById('stabilized-sub').textContent = S.result.unmet.toFixed(1) + ' kWh unmet demand';
    setTimeout(() => stab.classList.add('hidden'), 3500);
  },

  showDecision() {
    const r = S.result;
    if (!r || !r.explanation) return;
    const p = document.getElementById('decision-panel');
    p.classList.remove('hidden');
    p.style.top = '72px'; p.style.left = '50%'; p.style.transform = 'translateX(-50%)';
    const e = r.explanation;
    document.getElementById('decision-observation').textContent = e.obs.join('. ') + '.';
    document.getElementById('decision-constraint').textContent = e.con.join('. ') + '.';
    document.getElementById('decision-action').textContent = e.act.join(' ');
  },

  showEmergency() {
    document.getElementById('emergency-banner').classList.remove('hidden');
    document.getElementById('stabilized-banner').classList.add('hidden');
  },

  startClock() {
    // Decoupled: advance simulation time at ~1hr/sec for demo
    setInterval(() => {
      S.time = (S.time + 0.1) % 24;
      const h = Math.floor(S.time);
      const m = Math.floor((S.time % 1) * 60);
      document.getElementById('sim-clock').textContent =
        h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0');
    }, 400);
  },

  updateUI() {
    const r = S.result;
    // Hero
    document.getElementById('grid-status').textContent = S.gridStatus;
    document.getElementById('grid-status').className = 'metric-value ' + (S.gridStatus === 'STABLE' ? 'stable' : S.gridStatus === 'CRITICAL' ? 'critical' : 'warning');
    document.getElementById('renewable-share').textContent = S.renewableShare.toFixed(1) + '%';
    document.getElementById('current-load').textContent = S.demandTotal + ' kW';

    // Flow
    document.getElementById('flow-solar').textContent = S.solarOutput.toFixed(0) + ' kW';
    document.getElementById('flow-wind').textContent = S.windOutput.toFixed(0) + ' kW';
    document.getElementById('flow-hydro').textContent = S.hydroOutput.toFixed(0) + ' kW';
    document.getElementById('flow-battery').textContent = (S.battPower >= 0 ? '+' : '') + S.battPower.toFixed(0) + ' kW';
    document.getElementById('bar-solar').style.width = (S.solarOutput / BASE.solar.available * 100) + '%';
    document.getElementById('bar-wind').style.width = (S.windOutput / BASE.wind.capacity * 100) + '%';
    document.getElementById('bar-hydro').style.width = (S.hydroOutput / BASE.hydro.capacity * 100) + '%';
    document.getElementById('bar-battery').style.width = (Math.abs(S.battPower) / BASE.batt.maxRate * 100) + '%';

    // Impact
    if (r) {
      document.getElementById('impact-renewable').textContent = S.renewableShare.toFixed(1) + '%';
      document.getElementById('impact-co2').textContent = (r.emissions * 1000).toFixed(0) + ' kg';
      document.getElementById('impact-cost').textContent = '$' + r.opCost.toFixed(2);
      document.getElementById('impact-curtail').textContent = r.curtailPct.toFixed(1) + '%';
      document.getElementById('impact-degrade').textContent = '$' + (r.battCycles * BATT_CYCLE_COST * 100).toFixed(2);
    }

    // Pipeline
    if (r) {
      document.getElementById('pipe-forecast').textContent = 'Solar ' + S.solarOutput.toFixed(0) + 'kW | Wind ' + S.windOutput.toFixed(0) + 'kW | Hydro ' + S.hydroOutput.toFixed(0) + 'kW | Demand ' + S.demandTotal + 'kW';
      document.getElementById('pipe-dispatch').textContent = 'Solar ' + r.gen.solar.toFixed(0) + 'kW | Wind ' + r.gen.wind.toFixed(0) + 'kW | Hydro ' + r.gen.hydro.toFixed(0) + 'kW | Batt ' + (r.battPower > 0 ? '+' : '') + r.battPower.toFixed(0) + 'kW';
      document.getElementById('pipe-stability').textContent = r.totalSupply.toFixed(0) + ' kW gen vs ' + r.demand + ' kW demand | ' + (r.stable ? 'Balanced' : 'Deficit ' + r.unmet.toFixed(1) + ' kW');
    }

    // Nav dot
    document.querySelector('.status-dot').className = 'status-dot ' + (S.gridStatus === 'STABLE' ? 'green' : 'red');
  },

  renderChart() {
    const canvas = document.getElementById('forecast-chart');
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = (rect.width - 40) * dpr;
    canvas.height = 280 * dpr;
    canvas.style.width = (rect.width - 40) + 'px';
    canvas.style.height = '280px';
    ctx.scale(dpr, dpr);
    const W = rect.width - 40, H = 280;
    const pad = { t: 18, r: 16, b: 28, l: 44 };
    const pW = W - pad.l - pad.r, pH = H - pad.t - pad.b;
    ctx.clearRect(0, 0, W, H);

    const wp = WP[S.weather];
    const data = [];
    for (let hr = 0; hr < 24; hr++) {
      const s = Math.max(0, BASE.solar.available * solarCurve(hr) * wp.s);
      const bs = 8 + Math.sin(hr * 0.3) * 4;
      const ws = bs * wp.w;
      let w = 0;
      if (ws >= 3 && ws <= 25) w = ws < 12 ? BASE.wind.capacity * Math.pow((ws - 3) / 9, 3) : BASE.wind.capacity;
      w *= wp.w;
      const hy = Math.min(BASE.hydro.capacity, (S.waterLevel * 20 + 20 + (wp.h - 1) * 10) * 1.8);
      const d = BASE.demand.base * demandCurve(hr);
      const soc = clamp(0.68 + (s + w + hy - d) / BASE.batt.capacity * 2, 0.1, 0.95);
      data.push({ hr, s, w, hy, d, soc });
    }

    const maxV = Math.max(...data.map(d => Math.max(d.s, d.w, d.hy, d.d))) * 1.12 || 200;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 0.7;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + (pH / 5) * i;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.fillText(Math.round(maxV - (maxV / 5) * i) + ' kW', pad.l - 6, y + 3);
    }

    // Curves
    const curve = (key, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.8;
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = pad.l + (i / 23) * pW;
        const y = pad.t + pH - (d[key] / maxV) * pH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 0.06; ctx.fillStyle = col;
      ctx.lineTo(pad.l + pW, pad.t + pH); ctx.lineTo(pad.l, pad.t + pH); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    };
    curve('s', '#f0c040'); curve('w', '#4ecdc4'); curve('hy', '#3498db'); curve('d', '#e74c3c');

    // SOC dashed
    ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = pad.l + (i / 23) * pW;
      const y = pad.t + pH - (d.soc * 0.5) * pH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke(); ctx.setLineDash([]);

    // Hours
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    for (let hr = 0; hr < 24; hr += 3) {
      ctx.fillText(hr + ':00', pad.l + (hr / 23) * pW, H - 6);
    }

    // Timeline hours
    const hc = document.getElementById('timeline-hours');
    hc.innerHTML = '';
    for (let hr = 0; hr < 24; hr++) { const s = document.createElement('span'); s.textContent = hr + ':00'; hc.appendChild(s); }

    // Cursor
    canvas.onmousemove = (e) => {
      const r2 = canvas.getBoundingClientRect();
      const x = e.clientX - r2.left;
      const hr = Math.round(((x - pad.l) / pW) * 23);
      if (hr >= 0 && hr < 24) {
        document.getElementById('timeline-cursor').style.left = (pad.l + (hr / 23) * pW) + 'px';
        const d = data[hr];
        document.getElementById('forecast-detail').classList.remove('hidden');
        document.getElementById('fd-solar').textContent = d.s.toFixed(0) + ' kW';
        document.getElementById('fd-wind').textContent = d.w.toFixed(0) + ' kW';
        document.getElementById('fd-hydro').textContent = d.hy.toFixed(0) + ' kW';
        document.getElementById('fd-demand').textContent = d.d.toFixed(0) + ' kW';
        document.getElementById('fd-soc').textContent = (d.soc * 100).toFixed(0) + '%';
      }
    };
  },

  updateCompare() {
    const naive = runNaive();
    const ef = S.result || optimize();
    const maxC = Math.max(naive.opCost, ef.opCost) || 1;
    const maxCO = Math.max(naive.emissions * 1000, ef.emissions * 1000) || 1;
    const maxCy = Math.max(naive.battCycles, ef.battCycles) || 1;
    const maxU = Math.max(naive.unmet, ef.unmet, 1);

    document.getElementById('naive-cost').textContent = '$' + naive.opCost.toFixed(0);
    document.getElementById('ef-cost').textContent = '$' + ef.opCost.toFixed(0);
    document.getElementById('naive-cost-bar').style.width = (naive.opCost / maxC * 100) + '%';
    document.getElementById('ef-cost-bar').style.width = (ef.opCost / maxC * 100) + '%';

    document.getElementById('naive-co2').textContent = (naive.emissions * 1000).toFixed(0) + ' kg';
    document.getElementById('ef-co2').textContent = (ef.emissions * 1000).toFixed(0) + ' kg';
    document.getElementById('naive-co2-bar').style.width = (naive.emissions * 1000 / maxCO * 100) + '%';
    document.getElementById('ef-co2-bar').style.width = (ef.emissions * 1000 / maxCO * 100) + '%';

    document.getElementById('naive-cycles').textContent = naive.battCycles.toFixed(1);
    document.getElementById('ef-cycles').textContent = ef.battCycles.toFixed(1);
    document.getElementById('naive-cycles-bar').style.width = (naive.battCycles / maxCy * 100) + '%';
    document.getElementById('ef-cycles-bar').style.width = (ef.battCycles / maxCy * 100) + '%';

    document.getElementById('naive-unmet').textContent = naive.unmet.toFixed(0) + ' kWh';
    document.getElementById('ef-unmet').textContent = ef.unmet.toFixed(0) + ' kWh';
    document.getElementById('naive-unmet-bar').style.width = (naive.unmet / maxU * 100) + '%';
    document.getElementById('ef-unmet-bar').style.width = (ef.unmet / maxU * 100) + '%';
  },

  run24h() {
    if (S.isRunning24h) return;
    S.isRunning24h = true;
    const savedTime = S.time;
    let hr = 0;
    const step = () => {
      if (hr >= 24) {
        S.time = savedTime; S.isRunning24h = false;
        simulate(); this.updateUI();
        document.getElementById('btn-run-24h').textContent = 'RUN 24-HOUR OPTIMIZATION';
        return;
      }
      S.time = hr;
      simulate(); this.updateUI();
      const h = Math.floor(hr), m = Math.floor((hr % 1) * 60);
      document.getElementById('sim-clock').textContent = h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0');
      document.getElementById('btn-run-24h').textContent = 'RUNNING... ' + h + ':00';
      hr += 0.5;
      setTimeout(step, 180);
    };
    step();
  },
};

// ─── PARALLAX ──
document.addEventListener('mousemove', e => {
  S.parallaxX = (e.clientX / window.innerWidth - 0.5) * 2;
  S.parallaxY = (e.clientY / window.innerHeight - 0.5) * 2;
});

// ─── INIT ──
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    document.getElementById('loading-screen').classList.add('fade-out');
    document.getElementById('app').classList.remove('hidden');
    setTimeout(() => { document.getElementById('loading-screen').style.display = 'none'; }, 800);

    L.init();
    L.animate();
    simulate();
    UI.init();
    UI.updateUI();
  }, 2200);
});
