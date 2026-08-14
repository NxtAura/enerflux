/* ═══════════════════════════════════════════
   ENERFLUX — Application Engine
   ═══════════════════════════════════════════ */

// ─── STATE ────────────────────────────────────
const State = {
  time: 12,
  weather: 'sunny',
  mode: 'balanced',
  active: 'landscape',

  solar: { available: 120, output: 82, irradiance: 0.68, efficiency: 0.214, panelDarkness: 0 },
  wind: { capacity: 100, output: 64, speed: 11.8, turbineRpm: 0 },
  hydro: { capacity: 70, output: 51, waterLevel: 0.82, flow: 31 },
  battery: { capacity: 500, soc: 0.68, chargeRate: 42, health: 0.97, status: 'charging', maxCharge: 100, maxDischarge: 100 },
  demand: { total: 142, peak: 184, residential: 62, commercial: 41, industrial: 23, public: 16 },

  gridStatus: 'STABLE',
  renewableShare: 87.4,

  particles: [],
  mouseX: 0, mouseY: 0,
  parallaxX: 0, parallaxY: 0,

  forecast24h: [],
  optimizationResult: null,
  naiveResult: null,
  isRunning24h: false,
};

// ─── WEATHER PROFILES ─────────────────────────
const WeatherProfiles = {
  sunny:  { solarMod: 1.0, windMod: 1.0, hydroMod: 1.0, skyColor: [30, 60, 40], cloudCount: 2 },
  cloudy: { solarMod: 0.55, windMod: 1.1, hydroMod: 1.0, skyColor: [25, 40, 50], cloudCount: 6 },
  rain:   { solarMod: 0.25, windMod: 1.2, hydroMod: 1.3, skyColor: [15, 25, 35], cloudCount: 8 },
  storm:  { solarMod: 0.1, windMod: 1.8, hydroMod: 1.4, skyColor: [10, 15, 25], cloudCount: 10 },
  night:  { solarMod: 0.0, windMod: 0.8, hydroMod: 1.0, skyColor: [5, 8, 15], cloudCount: 3 },
  windy:  { solarMod: 0.9, windMod: 1.6, hydroMod: 1.1, skyColor: [25, 55, 45], cloudCount: 4 },
};

// ─── OPTIMIZATION ENGINE ──────────────────────
const Optimization = {
  weights: {
    balanced: { cost: 0.3, carbon: 0.3, battery: 0.2, curtail: 0.1, unmet: 0.1 },
    cost:     { cost: 0.6, carbon: 0.1, battery: 0.1, curtail: 0.1, unmet: 0.1 },
    carbon:   { cost: 0.1, carbon: 0.6, battery: 0.1, curtail: 0.1, unmet: 0.1 },
    battery:  { cost: 0.1, carbon: 0.1, battery: 0.6, curtail: 0.1, unmet: 0.1 },
  },

  // Marginal costs ($/MWh equivalent scaled to kW)
  marginalCost: { solar: 0, wind: 0, hydro: 5 },
  carbonIntensity: { solar: 0.04, wind: 0.01, hydro: 0.005, battery: 0.02, grid: 0.45 },
  batteryCycleCost: 0.15, // $/kWh per cycle
  curtailmentPenalty: 2.0,
  unmetDemandPenalty: 50.0,

  run(s, mode) {
    mode = mode || State.mode;
    const w = this.weights[mode];

    // Available generation
    const solarAvail = Math.max(0, s.solar.output);
    const windAvail = Math.max(0, s.wind.output);
    const hydroAvail = Math.min(s.hydro.output, s.hydro.capacity);
    const demand = s.demand.total;

    // Battery constraints
    const socMin = 0.10;
    const socMax = 1.00;
    const soc = s.battery.soc;
    const battCapacity = s.battery.capacity;
    const maxCharge = Math.min(s.battery.maxCharge, ((socMax - soc) * battCapacity));
    const maxDischarge = Math.min(s.battery.maxDischarge, ((soc - socMin) * battCapacity));

    const totalRenewableCap = solarAvail + windAvail + hydroAvail;

    // Greedy dispatch with weighted priority
    // Priority = low marginal cost + low carbon + renewable availability
    const sources = [
      { name: 'solar', avail: solarAvail, cost: this.marginalCost.solar, carbon: this.carbonIntensity.solar, priority: 0 },
      { name: 'wind', avail: windAvail, cost: this.marginalCost.wind, carbon: this.carbonIntensity.wind, priority: 1 },
      { name: 'hydro', avail: hydroAvail, cost: this.marginalCost.hydro, carbon: this.carbonIntensity.hydro, priority: 2 },
    ];

    // Score each source based on optimization mode
    sources.forEach(src => {
      src.score = w.cost * (src.cost / 10) + w.carbon * src.carbon + (1 - w.battery) * (src.priority * 0.05);
    });
    sources.sort((a, b) => a.score - b.score);

    let remaining = demand;
    let dispatch = { solar: 0, wind: 0, hydro: 0, battery: 0 };
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
    const operatingCost = totalGen * 0.001 * 24 + Math.abs(dispatch.battery) * this.batteryCycleCost * 0.5;
    const emissions = (dispatch.solar * this.carbonIntensity.solar +
                       dispatch.wind * this.carbonIntensity.wind +
                       dispatch.hydro * this.carbonIntensity.hydro +
                       Math.max(0, dispatch.battery) * this.carbonIntensity.battery +
                       unmet * this.carbonIntensity.grid) * 0.1;
    const batteryCycles = Math.abs(dispatch.battery) / battCapacity;
    const curtailPct = totalRenewableCap > 0 ? (curtailed / totalRenewableCap * 100) : 0;

    // Weighted objective value
    const objective = w.cost * operatingCost * 10 + w.carbon * emissions * 100 +
                      w.battery * batteryCycles * 50 + w.curtail * curtailPct * 0.5 +
                      w.unmet * unmet * 10;

    // Generate explanation
    const explanation = this.generateExplanation(s, dispatch, demand, unmet, curtailed, mode);

    return {
      dispatch,
      demand,
      totalGen: totalGen,
      totalWithBatt,
      unmet,
      curtailed,
      curtailPct,
      operatingCost,
      emissions,
      batteryCycles,
      objective,
      explanation,
      socAfter: soc + (dispatch.battery / battCapacity),
      gridStable: unmet < 0.5,
    };
  },

  generateExplanation(s, dispatch, demand, unmet, curtailed, mode) {
    const observations = [];
    const constraints = [];
    const actions = [];

    const solarPct = (dispatch.solar / s.solar.available * 100).toFixed(0);
    const windPct = (dispatch.wind / s.wind.capacity * 100).toFixed(0);

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
  },

  // Naive rule-based dispatch for comparison
  runNaive(s) {
    const demand = s.demand.total;
    let remaining = demand;
    let dispatch = { solar: 0, wind: 0, hydro: 0, battery: 0 };

    // Simple priority: solar first, then wind, then hydro, then battery
    dispatch.solar = Math.min(s.solar.output, remaining);
    remaining -= dispatch.solar;

    dispatch.wind = Math.min(s.wind.output, remaining);
    remaining -= dispatch.wind;

    dispatch.hydro = Math.min(s.hydro.output, remaining);
    remaining -= dispatch.hydro;

    if (remaining > 0) {
      const maxDis = Math.min(s.battery.maxDischarge, (s.battery.soc - 0.10) * s.battery.capacity);
      dispatch.battery = Math.min(remaining, maxDis);
      remaining -= dispatch.battery;
    }

    const unmet = remaining;
    const totalGen = dispatch.solar + dispatch.wind + dispatch.hydro;
    const curtailed = Math.max(0, s.solar.output - dispatch.solar) + Math.max(0, s.wind.output - dispatch.wind) + Math.max(0, s.hydro.output - dispatch.hydro);

    const operatingCost = totalGen * 0.001 * 24 + Math.abs(dispatch.battery) * this.batteryCycleCost * 0.5;
    const emissions = (dispatch.solar * 0.04 + dispatch.wind * 0.01 + dispatch.hydro * 0.005 +
                       Math.max(0, dispatch.battery) * 0.02 + unmet * 0.45) * 0.1;
    const batteryCycles = Math.abs(dispatch.battery) / s.battery.capacity;
    const curtailPct = (s.solar.output + s.wind.output + s.hydro.output) > 0 ?
      (curtailed / (s.solar.output + s.wind.output + s.hydro.output) * 100) : 0;

    return {
      dispatch, demand, totalGen, unmet, curtailed, curtailPct,
      operatingCost, emissions, batteryCycles,
      gridStable: unmet < 0.5,
    };
  }
};

// ─── SIMULATION ENGINE ────────────────────────
const Simulation = {
  updateSolar(s, weatherMod) {
    const wp = WeatherProfiles[State.weather];
    const hourFactor = this.solarCurve(State.time);
    s.solar.irradiance = hourFactor * wp.solarMod;
    s.solar.output = Math.max(0, s.solar.available * s.solar.irradiance);
    s.solar.panelDarkness = 1 - s.solar.irradiance;
  },

  updateWind(s, weatherMod) {
    const wp = WeatherProfiles[State.weather];
    const baseSpeed = 8 + Math.sin(State.time * 0.3) * 4;
    s.wind.speed = baseSpeed * wp.windMod;
    s.wind.speed = Math.max(0, Math.min(30, s.wind.speed));
    // Power curve: cut-in 3m/s, rated 12m/s, cut-out 25m/s
    if (s.wind.speed < 3) s.wind.output = 0;
    else if (s.wind.speed < 12) s.wind.output = s.wind.capacity * Math.pow((s.wind.speed - 3) / 9, 3);
    else if (s.wind.speed <= 25) s.wind.output = s.wind.capacity;
    else s.wind.output = 0;
    s.wind.output *= wp.windMod;
  },

  updateHydro(s, weatherMod) {
    const wp = WeatherProfiles[State.weather];
    s.hydro.waterLevel = Math.min(1, Math.max(0.3, s.hydro.waterLevel + (wp.hydroMod - 1) * 0.01));
    s.hydro.flow = 20 + s.hydro.waterLevel * 20 + (wp.hydroMod - 1) * 10;
    s.hydro.output = Math.min(s.hydro.capacity, s.hydro.flow * 1.8);
  },

  updateBattery(s, result) {
    if (result) {
      s.battery.chargeRate = result.dispatch.battery;
      s.battery.soc = Math.max(0.05, Math.min(0.98, s.battery.soc + result.dispatch.battery / s.battery.capacity * 0.1));
      if (result.dispatch.battery > 1) s.battery.status = 'charging';
      else if (result.dispatch.battery < -1) s.battery.status = 'discharging';
      else s.battery.status = 'idle';
      if (s.battery.soc < 0.15) s.battery.status = 'critical';
    }
  },

  updateDemand(s) {
    const hourFactor = this.demandCurve(State.time);
    const base = 120;
    s.demand.total = base * hourFactor;
    s.demand.residential = s.demand.total * 0.44;
    s.demand.commercial = s.demand.total * 0.29;
    s.demand.industrial = s.demand.total * 0.16;
    s.demand.public = s.demand.total * 0.11;
    s.demand.total = Math.round(s.demand.total);
  },

  solarCurve(hour) {
    // Bell curve centered at 13:00
    if (hour < 6 || hour > 20) return 0;
    const x = (hour - 13) / 4;
    return Math.exp(-x * x * 0.5) * 0.95 + 0.05;
  },

  demandCurve(hour) {
    // Morning peak ~8, evening peak ~18
    const morning = Math.exp(-Math.pow((hour - 8) / 2.5, 2)) * 0.3;
    const evening = Math.exp(-Math.pow((hour - 18) / 3, 2)) * 0.4;
    const base = 0.7;
    return base + morning + evening;
  },

  fullUpdate() {
    const s = State;
    this.updateSolar(s);
    this.updateWind(s);
    this.updateHydro(s);
    this.updateDemand(s);

    const result = Optimization.run(s);
    State.optimizationResult = result;
    this.updateBattery(s, result);

    State.gridStatus = result.gridStable ? 'STABLE' : (result.unmet > 5 ? 'CRITICAL' : 'STRESSED');
    State.renewableShare = result.totalGen > 0 ?
      ((result.totalGen / Math.max(result.demand, 1)) * 100) : 0;
    State.renewableShare = Math.min(100, State.renewableShare);
  }
};

// ─── CANVAS LANDSCAPE RENDERER ────────────────
const Landscape = {
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,
  time: 0,
  particles: [],
  clouds: [],
  waterOffset: 0,

  init() {
    this.canvas = document.getElementById('landscape-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.initParticles();
    this.initClouds();
  },

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.scale(dpr, dpr);
  },

  initParticles() {
    this.particles = [];
    for (let i = 0; i < 60; i++) {
      this.particles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        speed: 0.3 + Math.random() * 0.7,
        size: 1 + Math.random() * 2,
        alpha: 0.3 + Math.random() * 0.5,
        type: ['solar', 'wind', 'hydro', 'grid'][Math.floor(Math.random() * 4)],
        progress: Math.random(),
      });
    }
  },

  initClouds() {
    this.clouds = [];
    for (let i = 0; i < 8; i++) {
      this.clouds.push({
        x: Math.random() * this.width * 1.5 - this.width * 0.25,
        y: 40 + Math.random() * 120,
        w: 80 + Math.random() * 200,
        h: 30 + Math.random() * 50,
        speed: 0.1 + Math.random() * 0.3,
        alpha: 0.15 + Math.random() * 0.2,
      });
    }
  },

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const mx = State.parallaxX;
    const my = State.parallaxY;
    const t = this.time;

    ctx.clearRect(0, 0, w, h);

    // Sky gradient
    const wp = WeatherProfiles[State.weather];
    const skyTop = `rgb(${wp.skyColor[0]}, ${wp.skyColor[1]}, ${wp.skyColor[2]})`;
    const skyBottom = `rgb(${wp.skyColor[0] + 20}, ${wp.skyColor[1] + 30}, ${wp.skyColor[2] + 15})`;
    const grad = ctx.createLinearGradient(0, 0, 0, h * 0.65);
    grad.addColorStop(0, skyTop);
    grad.addColorStop(1, skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h * 0.65);

    // Sun / Moon
    const sunX = w * 0.7 + mx * -3;
    const sunY = 80 + my * -2;
    if (State.weather !== 'night') {
      const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 120);
      sunGlow.addColorStop(0, `rgba(255, 220, 100, ${0.9 * (1 - State.solar.panelDarkness * 0.8)})`);
      sunGlow.addColorStop(0.3, `rgba(255, 200, 80, ${0.3 * (1 - State.solar.panelDarkness * 0.5)})`);
      sunGlow.addColorStop(1, 'rgba(255, 200, 80, 0)');
      ctx.fillStyle = sunGlow;
      ctx.fillRect(sunX - 150, sunY - 150, 300, 300);

      ctx.beginPath();
      ctx.arc(sunX, sunY, 18, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 230, 130, ${1 - State.solar.panelDarkness * 0.6})`;
      ctx.fill();
    } else {
      // Moon
      ctx.beginPath();
      ctx.arc(sunX, sunY, 14, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200, 210, 230, 0.8)';
      ctx.fill();
    }

    // Clouds
    this.clouds.forEach(c => {
      c.x += c.speed;
      if (c.x > w + c.w) c.x = -c.w;
      const cx = c.x + mx * -5;
      ctx.fillStyle = `rgba(180, 195, 210, ${c.alpha * (State.weather === 'night' ? 0.3 : 1)})`;
      ctx.beginPath();
      ctx.ellipse(cx, c.y + my * -3, c.w / 2, c.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx - c.w * 0.25, c.y + 8 + my * -3, c.w * 0.35, c.h * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + c.w * 0.2, c.y + 5 + my * -3, c.w * 0.3, c.h * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // Mountains (background layer)
    this.drawMountains(ctx, w, h, mx, my);

    // Rain effect for storm/rain weather
    if (State.weather === 'storm' || State.weather === 'rain') {
      ctx.strokeStyle = State.weather === 'storm' ? 'rgba(150, 180, 220, 0.35)' : 'rgba(120, 160, 200, 0.25)';
      ctx.lineWidth = 1;
      const rainCount = State.weather === 'storm' ? 120 : 60;
      for (let i = 0; i < rainCount; i++) {
        const rx = (i * 17.3 + this.time * 200) % w;
        const ry = (i * 23.7 + this.time * 400) % h;
        const rlen = State.weather === 'storm' ? 12 : 8;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 2, ry + rlen);
        ctx.stroke();
      }
    }

    // Snow effect for very cold nights
    if (State.weather === 'night' && State.time > 22) {
      ctx.fillStyle = 'rgba(200, 210, 230, 0.4)';
      for (let i = 0; i < 20; i++) {
        const sx = (i * 47.3 + this.time * 30) % w;
        const sy = (i * 31.7 + this.time * 50) % h;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Forest
    this.drawForest(ctx, w, h, mx, my);

    // Ground
    this.drawGround(ctx, w, h, mx, my);

    // Water / Stream
    this.drawWater(ctx, w, h, mx, my);

    // Infrastructure
    this.drawInfrastructure(ctx, w, h, mx, my);

    // Energy particles
    this.drawEnergyParticles(ctx, w, h, mx, my);

    // Atmospheric haze
    const haze = ctx.createLinearGradient(0, h * 0.35, 0, h * 0.65);
    haze.addColorStop(0, 'rgba(30, 50, 40, 0)');
    haze.addColorStop(0.5, `rgba(${wp.skyColor[0] + 10}, ${wp.skyColor[1] + 20}, ${wp.skyColor[2] + 10}, 0.1)`);
    haze.addColorStop(1, `rgba(${wp.skyColor[0]}, ${wp.skyColor[1]}, ${wp.skyColor[2]}, 0.2)`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, h * 0.35, w, h * 0.3);

    // Stars at night
    if (State.weather === 'night') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      for (let i = 0; i < 40; i++) {
        const sx = (i * 137.5 + 50) % w;
        const sy = (i * 73.7 + 20) % (h * 0.4);
        const ss = 0.5 + Math.sin(this.time * 0.5 + i) * 0.3;
        ctx.beginPath();
        ctx.arc(sx + mx * -1, sy + my * -0.5, ss, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    this.time += 0.016;
    this.waterOffset += 0.5;
  },

  drawMountains(ctx, w, h, mx, my) {
    const baseY = h * 0.38;
    ctx.fillStyle = 'rgba(20, 35, 28, 0.9)';

    // Far mountains
    ctx.beginPath();
    ctx.moveTo(-50 + mx * -2, baseY + 60 + my * -1);
    for (let x = -50; x <= w + 50; x += 3) {
      const n = Math.sin(x * 0.003) * 50 + Math.sin(x * 0.007) * 30 + Math.sin(x * 0.001) * 80;
      ctx.lineTo(x + mx * -2, baseY + 60 - n + my * -1);
    }
    ctx.lineTo(w + 50, h);
    ctx.lineTo(-50, h);
    ctx.closePath();
    ctx.fill();

    // Near mountains
    ctx.fillStyle = 'rgba(15, 28, 22, 0.95)';
    ctx.beginPath();
    ctx.moveTo(-50 + mx * -4, baseY + 100 + my * -2);
    for (let x = -50; x <= w + 50; x += 3) {
      const n = Math.sin(x * 0.005 + 1) * 40 + Math.sin(x * 0.002) * 60;
      ctx.lineTo(x + mx * -4, baseY + 100 - n + my * -2);
    }
    ctx.lineTo(w + 50, h);
    ctx.lineTo(-50, h);
    ctx.closePath();
    ctx.fill();
  },

  drawForest(ctx, w, h, mx, my) {
    const baseY = h * 0.48;
    ctx.fillStyle = 'rgba(18, 40, 25, 0.95)';

    // Tree line
    for (let i = 0; i < 80; i++) {
      const x = (i / 80) * (w + 100) - 50 + mx * -6;
      const treeH = 20 + Math.sin(i * 1.7) * 15;
      const treeW = 8 + Math.sin(i * 2.3) * 4;
      ctx.beginPath();
      ctx.moveTo(x, baseY + my * -2);
      ctx.lineTo(x - treeW, baseY + treeH + my * -2);
      ctx.lineTo(x + treeW, baseY + treeH + my * -2);
      ctx.closePath();
      ctx.fill();
    }
  },

  drawGround(ctx, w, h, mx, my) {
    const groundY = h * 0.55;

    // Main ground
    const gGrad = ctx.createLinearGradient(0, groundY, 0, h);
    gGrad.addColorStop(0, '#1a3525');
    gGrad.addColorStop(0.3, '#152a1e');
    gGrad.addColorStop(1, '#0d1a12');
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, groundY, w, h - groundY);

    // Terrain contour
    ctx.strokeStyle = 'rgba(40, 70, 45, 0.3)';
    ctx.lineWidth = 1;
    for (let row = 0; row < 5; row++) {
      ctx.beginPath();
      const ry = groundY + 20 + row * 30 + my * -2;
      for (let x = 0; x <= w; x += 4) {
        const n = Math.sin(x * 0.01 + row * 2) * 3 + Math.sin(x * 0.003) * 5;
        if (x === 0) ctx.moveTo(x + mx * -8, ry + n);
        else ctx.lineTo(x + mx * -8, ry + n);
      }
      ctx.stroke();
    }

    // Small rocks
    ctx.fillStyle = 'rgba(60, 55, 45, 0.6)';
    for (let i = 0; i < 15; i++) {
      const rx = (i * 97 + 30) % w + mx * -10;
      const ry = groundY + 40 + (i * 37) % 80;
      ctx.beginPath();
      ctx.ellipse(rx, ry + my * -3, 4 + (i % 3) * 2, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Grass tufts
    ctx.strokeStyle = 'rgba(40, 80, 45, 0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const gx = (i * 53 + 10) % w + mx * -10;
      const gy = groundY + 25 + (i * 41) % 100;
      const gh = 4 + (i % 5) * 2;
      ctx.beginPath();
      ctx.moveTo(gx, gy + my * -3);
      ctx.lineTo(gx - 2, gy - gh + my * -3);
      ctx.moveTo(gx, gy + my * -3);
      ctx.lineTo(gx + 2, gy - gh + my * -3);
      ctx.moveTo(gx, gy + my * -3);
      ctx.lineTo(gx + 1, gy - gh + 2 + my * -3);
      ctx.stroke();
    }

    // Road
    ctx.strokeStyle = 'rgba(80, 75, 65, 0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, groundY + 60 + my * -3);
    for (let x = 0; x <= w; x += 5) {
      const n = Math.sin(x * 0.005) * 8;
      ctx.lineTo(x + mx * -9, groundY + 60 + n + my * -3);
    }
    ctx.stroke();
  },

  drawWater(ctx, w, h, mx, my) {
    const waterY = h * 0.52;
    const waterW = 120;
    const waterX = w * 0.25;

    // Stream
    ctx.fillStyle = 'rgba(40, 100, 140, 0.4)';
    ctx.beginPath();
    ctx.moveTo(waterX + mx * -7, waterY + my * -2);
    for (let y = 0; y < 100; y += 3) {
      const x = waterX + Math.sin((y + this.waterOffset) * 0.08) * 15 + mx * -7;
      ctx.lineTo(x, waterY + y + my * -2);
    }
    ctx.lineTo(waterX + 40 + mx * -7, waterY + 100 + my * -2);
    ctx.lineTo(waterX - 20 + mx * -7, waterY + 100 + my * -2);
    ctx.closePath();
    ctx.fill();

    // Water shimmer
    ctx.fillStyle = 'rgba(80, 160, 200, 0.15)';
    for (let i = 0; i < 8; i++) {
      const sx = waterX + Math.sin((this.waterOffset + i * 20) * 0.05) * 10 + mx * -7;
      const sy = waterY + i * 12 + Math.sin((this.waterOffset + i * 10) * 0.03) * 3 + my * -2;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 8, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  drawInfrastructure(ctx, w, h, mx, my) {
    const groundY = h * 0.55;

    // ── Solar Farm ──
    const solarX = w * 0.15 + mx * -8;
    const solarY = groundY + 15 + my * -3;
    const panelDark = State.solar.panelDarkness;

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const px = solarX + c * 22 + r * 8;
        const py = solarY + r * 14;
        // Panel frame
        ctx.fillStyle = `rgba(${40 + panelDark * 30}, ${55 + panelDark * 20}, ${80 + panelDark * 15}, 0.9)`;
        ctx.fillRect(px, py, 18, 10);
        // Panel cells
        ctx.fillStyle = `rgba(${50 + panelDark * 40}, ${70 + panelDark * 30}, ${120 - panelDark * 40}, 0.8)`;
        ctx.fillRect(px + 1, py + 1, 7, 4);
        ctx.fillRect(px + 9, py + 1, 8, 4);
        ctx.fillRect(px + 1, py + 6, 7, 3);
        ctx.fillRect(px + 9, py + 6, 8, 3);
        // Sun reflection
        if (panelDark < 0.5) {
          ctx.fillStyle = `rgba(255, 240, 150, ${(0.5 - panelDark) * 0.3})`;
          ctx.fillRect(px + 3, py + 2, 4, 2);
        }
      }
    }
    // Panel支架
    ctx.strokeStyle = 'rgba(80, 80, 80, 0.6)';
    ctx.lineWidth = 1;
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      ctx.moveTo(solarX + r * 8 + 9, solarY + r * 14 + 10);
      ctx.lineTo(solarX + r * 8 + 9, solarY + r * 14 + 18);
      ctx.stroke();
    }

    // ── Wind Turbines ──
    const windBaseX = w * 0.42 + mx * -10;
    const windBaseY = groundY + 5 + my * -3;
    const rpm = State.wind.speed * 3;

    for (let i = 0; i < 3; i++) {
      const tx = windBaseX + i * 55;
      const ty = windBaseY - (i === 1 ? 10 : 0);
      const towerH = 65 + (i === 1 ? 10 : 0);

      // Tower
      ctx.strokeStyle = 'rgba(180, 185, 190, 0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx, ty - towerH);
      ctx.stroke();

      // Nacelle
      ctx.fillStyle = 'rgba(200, 205, 210, 0.8)';
      ctx.fillRect(tx - 4, ty - towerH - 3, 10, 6);

      // Blades
      const bladeLen = 28 + (i === 1 ? 5 : 0);
      const angle = this.time * rpm * 0.01 + i * 2.1;
      ctx.strokeStyle = 'rgba(210, 215, 220, 0.8)';
      ctx.lineWidth = 2;
      for (let b = 0; b < 3; b++) {
        const ba = angle + (b * Math.PI * 2 / 3);
        ctx.beginPath();
        ctx.moveTo(tx + 1, ty - towerH);
        ctx.lineTo(tx + 1 + Math.cos(ba) * bladeLen, ty - towerH + Math.sin(ba) * bladeLen);
        ctx.stroke();
      }

      // Hub
      ctx.beginPath();
      ctx.arc(tx + 1, ty - towerH, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(160, 165, 170, 0.9)';
      ctx.fill();
    }

    // ── Hydro Dam ──
    const damX = w * 0.22 + mx * -7;
    const damY = groundY - 5 + my * -2;

    // Dam wall
    ctx.fillStyle = 'rgba(100, 100, 105, 0.85)';
    ctx.beginPath();
    ctx.moveTo(damX, damY - 30);
    ctx.lineTo(damX + 50, damY - 30);
    ctx.lineTo(damX + 55, damY + 15);
    ctx.lineTo(damX - 5, damY + 15);
    ctx.closePath();
    ctx.fill();

    // Dam face detail
    ctx.strokeStyle = 'rgba(80, 80, 85, 0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(damX + 2 + i * 12, damY - 28);
      ctx.lineTo(damX + 4 + i * 12, damY + 13);
      ctx.stroke();
    }

    // Water over dam
    const flowRate = State.hydro.flow / 40;
    ctx.fillStyle = `rgba(60, 140, 200, ${0.3 + flowRate * 0.3})`;
    for (let i = 0; i < 5; i++) {
      const wx = damX + 10 + i * 8;
      const wy = damY - 28 + Math.sin(this.waterOffset * 0.05 + i) * 2;
      ctx.beginPath();
      ctx.ellipse(wx, wy, 3, 2 + flowRate * 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Battery Container ──
    const battX = w * 0.62 + mx * -12;
    const battY = groundY + 20 + my * -4;

    // Container body
    const socColor = State.battery.soc > 0.5 ? 'rgba(46, 204, 113,' :
                     State.battery.soc > 0.2 ? 'rgba(240, 192, 64,' : 'rgba(231, 76, 60,';
    ctx.fillStyle = 'rgba(50, 55, 55, 0.9)';
    ctx.fillRect(battX, battY, 55, 30);

    // SOC indicator
    const socWidth = 51 * State.battery.soc;
    ctx.fillStyle = `${socColor} 0.6)`;
    ctx.fillRect(battX + 2, battY + 2, socWidth, 26);

    // Glow
    if (State.battery.status === 'charging' || State.battery.status === 'discharging') {
      ctx.shadowColor = socColor + ' 0.4)';
      ctx.shadowBlur = 15;
      ctx.fillRect(battX, battY, 55, 30);
      ctx.shadowBlur = 0;
    }

    // Container outline
    ctx.strokeStyle = 'rgba(100, 105, 105, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(battX, battY, 55, 30);

    // Label
    ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
    ctx.font = '8px Inter';
    ctx.fillText('BESS', battX + 18, battY + 18);

    // ── Houses ──
    const houseX = w * 0.78 + mx * -14;
    const houseY = groundY + 10 + my * -4;
    const demandIntensity = State.demand.total / 200;

    for (let i = 0; i < 5; i++) {
      const hx = houseX + i * 30;
      const hy = houseY + Math.sin(i * 1.5) * 5;
      const hh = 18 + (i % 2) * 8;

      // House body
      ctx.fillStyle = `rgba(${45 + i * 5}, ${50 + i * 3}, ${48 + i * 4}, 0.9)`;
      ctx.fillRect(hx, hy - hh, 22, hh);

      // Roof
      ctx.fillStyle = `rgba(${60 + i * 3}, ${55 + i * 2}, ${50}, 0.85)`;
      ctx.beginPath();
      ctx.moveTo(hx - 3, hy - hh);
      ctx.lineTo(hx + 11, hy - hh - 10);
      ctx.lineTo(hx + 25, hy - hh);
      ctx.closePath();
      ctx.fill();

      // Window light
      const windowGlow = demandIntensity * (0.5 + Math.sin(this.time * 0.5 + i * 1.3) * 0.2);
      ctx.fillStyle = `rgba(255, 220, 120, ${windowGlow * 0.8})`;
      ctx.fillRect(hx + 4, hy - hh + 5, 5, 5);
      ctx.fillRect(hx + 13, hy - hh + 5, 5, 5);

      if (hh > 20) {
        ctx.fillRect(hx + 4, hy - hh + 13, 5, 5);
        ctx.fillRect(hx + 13, hy - hh + 13, 5, 5);
      }
    }

    // ── Transmission Lines ──
    this.drawTransmissionLines(ctx, w, h, mx, my, groundY);
  },

  drawTransmissionLines(ctx, w, h, mx, my, groundY) {
    const lineY = groundY - 5 + my * -3;

    // Solar → Grid
    const solarEndX = w * 0.15 + 80 + mx * -8;
    const gridCenterX = w * 0.5 + mx * -10;

    ctx.strokeStyle = 'rgba(100, 100, 100, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Main grid line
    ctx.beginPath();
    ctx.moveTo(solarEndX, lineY);
    ctx.lineTo(gridCenterX, lineY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(w * 0.42 + 55 + mx * -10, lineY);
    ctx.lineTo(gridCenterX, lineY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(gridCenterX, lineY);
    ctx.lineTo(w * 0.78 + mx * -14, lineY);
    ctx.stroke();

    ctx.setLineDash([]);

    // Grid node
    ctx.beginPath();
    ctx.arc(gridCenterX, lineY, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(46, 204, 113, 0.5)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(46, 204, 113, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  },

  drawEnergyParticles(ctx, w, h, mx, my) {
    const groundY = h * 0.55;
    const lineY = groundY - 5 + my * -3;
    const result = State.optimizationResult;
    if (!result) return;

    const dispatch = result.dispatch;

    // Particle routes - power flow visualization
    const routes = [
      { from: w * 0.15 + 80, to: w * 0.5, power: dispatch.solar, color: [240, 192, 64], label: 'Solar→Grid' },
      { from: w * 0.42 + 55, to: w * 0.5, power: dispatch.wind, color: [78, 205, 196], label: 'Wind→Grid' },
      { from: w * 0.5, to: w * 0.78, power: dispatch.solar + dispatch.wind + dispatch.hydro, color: [100, 180, 255], label: 'Grid→Demand' },
    ];

    // Battery particles
    const battX = w * 0.62 + 27 + mx * -12;
    if (dispatch.battery > 1) {
      routes.push({ from: w * 0.5, to: battX, power: dispatch.battery, color: [46, 204, 113], label: 'Grid→Batt', mx: -10 });
    } else if (dispatch.battery < -1) {
      routes.push({ from: battX, to: w * 0.5, power: Math.abs(dispatch.battery), color: [46, 204, 113], label: 'Batt→Grid', mx: -10 });
    }

    routes.forEach(route => {
      if (route.power < 1) return;
      const particleCount = Math.min(16, Math.max(2, Math.ceil(route.power / 12)));
      const speed = 0.4 + route.power / 60;

      for (let i = 0; i < particleCount; i++) {
        const progress = ((this.time * speed * 0.35 + i / particleCount) % 1);
        const routeFrom = route.from + (route.mx ? route.mx : 0) + mx * -10;
        const routeTo = route.to + (route.mx ? route.mx : 0) + mx * -10;
        const px = routeFrom + (routeTo - routeFrom) * progress;
        const py = lineY + Math.sin(progress * Math.PI * 3 + i * 0.8) * 4;

        // Core particle
        const alpha = 0.6 + Math.sin(progress * Math.PI) * 0.4;
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${route.color[0]}, ${route.color[1]}, ${route.color[2]}, ${alpha})`;
        ctx.fill();

        // Glow
        const glowGrad = ctx.createRadialGradient(px, py, 0, px, py, 8);
        glowGrad.addColorStop(0, `rgba(${route.color[0]}, ${route.color[1]}, ${route.color[2]}, 0.25)`);
        glowGrad.addColorStop(1, `rgba(${route.color[0]}, ${route.color[1]}, ${route.color[2]}, 0)`);
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fillStyle = glowGrad;
        ctx.fill();
      }
    });
  },

  animate() {
    this.render();
    requestAnimationFrame(() => this.animate());
  }
};

// ─── UI CONTROLLER ────────────────────────────
const UI = {
  init() {
    this.bindNav();
    this.bindStressTests();
    this.bindWeather();
    this.bindOptimize();
    this.bindModeButtons();
    this.bindFlowItems();
    this.bindMathToggle();
    this.bindDecisionPanel();
    this.bind24hChart();
    this.bindEmergencyRecover();
    this.startClock();
  },

  bindNav() {
    document.querySelectorAll('.nav-link').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const section = btn.dataset.section;
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById(`section-${section}`).classList.add('active');
        State.active = section;

        if (section === 'analytics') this.renderForecastChart();
        if (section === 'compare') this.updateComparison();
      });
    });
  },

  bindStressTests() {
    document.querySelectorAll('.stress-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const event = btn.dataset.event;
        this.applyStressEvent(event);
      });
    });
  },

  applyStressEvent(event) {
    const before = {
      demand: State.demand.total,
      solar: State.solar.output,
      wind: State.wind.output,
      hydro: State.hydro.output,
      battery: State.battery.soc * State.battery.capacity,
    };

    switch (event) {
      case 'solar-drop':
        State.solar.output *= 0.15;
        State.solar.panelDarkness = 0.85;
        break;
      case 'wind-drop':
        State.wind.output *= 0.15;
        State.wind.speed *= 0.2;
        break;
      case 'hydro-fail':
        State.hydro.output *= 0.1;
        State.hydro.flow *= 0.1;
        break;
      case 'demand-spike':
        State.demand.total *= 1.6;
        State.demand.residential *= 1.4;
        State.demand.commercial *= 1.5;
        State.demand.industrial *= 2.0;
        State.demand.public *= 1.3;
        break;
      case 'low-battery':
        State.battery.soc = 0.12;
        break;
      case 'storm':
        State.solar.output *= 0.1;
        State.wind.output *= 1.5;
        State.wind.speed *= 1.8;
        State.hydro.output *= 1.2;
        State.weather = 'storm';
        break;
      case 'night':
        State.solar.output = 0;
        State.solar.irradiance = 0;
        State.solar.panelDarkness = 1;
        State.weather = 'night';
        break;
      case 'reset':
        State.weather = 'sunny';
        Simulation.fullUpdate();
        this.updateAll();
        return;
    }

    Simulation.fullUpdate();
    const after = State.optimizationResult;

    // Show before/after
    const resultEl = document.getElementById('stress-result');
    resultEl.classList.remove('hidden');
    document.getElementById('stress-before').innerHTML =
      `<strong>BEFORE</strong><br>Demand: ${before.demand.toFixed(0)} kW<br>Gen: ${(before.solar + before.wind + before.hydro).toFixed(0)} kW`;
    document.getElementById('stress-after').innerHTML =
      `<strong>AFTER OPTIMIZATION</strong><br>Solar: ${after.dispatch.solar.toFixed(0)} kW<br>Wind: ${after.dispatch.wind.toFixed(0)} kW<br>Hydro: ${after.dispatch.hydro.toFixed(0)} kW<br>Battery: ${after.dispatch.battery > 0 ? '+' : ''}${after.dispatch.battery.toFixed(0)} kW<br><br>Total: ${after.totalWithBatt.toFixed(0)} kW<br><span class="${after.gridStable ? 'stable' : 'critical'}">${after.gridStable ? 'GRID STABLE' : 'GRID STRESSED'}</span>`;

    this.showDecision();
    this.updateAll();
  },

  bindWeather() {
    document.querySelectorAll('.weather-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.weather-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        State.weather = btn.dataset.weather;
        Simulation.fullUpdate();
        this.updateAll();
      });
    });
  },

  bindOptimize() {
    document.getElementById('btn-optimize').addEventListener('click', () => {
      Simulation.fullUpdate();
      this.updateAll();
      this.showDecision();
    });

    document.getElementById('btn-simulate-event').addEventListener('click', () => {
      const events = ['solar-drop', 'wind-drop', 'demand-spike', 'storm'];
      const event = events[Math.floor(Math.random() * events.length)];
      this.applyStressEvent(event);
    });

    document.getElementById('btn-cascade').addEventListener('click', () => {
      // Cinematic cascade event - multiple failures simultaneously
      State.solar.output *= 0.15;
      State.solar.panelDarkness = 0.85;
      State.wind.output *= 0.2;
      State.wind.speed *= 0.3;
      State.demand.total *= 1.5;
      State.demand.residential *= 1.3;
      State.demand.commercial *= 1.5;
      State.demand.industrial *= 1.8;
      State.demand.public *= 1.2;
      State.battery.soc = 0.15;
      State.weather = 'storm';

      Simulation.fullUpdate();
      this.updateAll();
      this.showEmergency();
    });
  },

  bindModeButtons() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        State.mode = btn.dataset.mode;
        Simulation.fullUpdate();
        this.updateAll();
        this.showDecision();
      });
    });
  },

  bindFlowItems() {
    document.querySelectorAll('.flow-item').forEach(item => {
      item.addEventListener('click', () => {
        const source = item.dataset.source;
        // Scroll to or highlight relevant info
        // For demo, show the decision panel
        this.showDecision();
      });
    });
  },

  bindMathToggle() {
    document.getElementById('math-toggle').addEventListener('click', () => {
      const content = document.getElementById('math-content');
      content.classList.toggle('hidden');
      document.getElementById('math-toggle').textContent =
        content.classList.contains('hidden') ? 'Show Mathematical Formulation ▾' : 'Hide Mathematical Formulation ▴';
    });
  },

  bindDecisionPanel() {
    document.getElementById('close-decision').addEventListener('click', () => {
      document.getElementById('decision-panel').classList.add('hidden');
    });
  },

  bindEmergencyRecover() {
    document.getElementById('btn-recover').addEventListener('click', () => {
      document.getElementById('emergency-banner').classList.add('hidden');
      Simulation.fullUpdate();
      this.updateAll();
      this.showDecision();

      // Show stabilized
      const stab = document.getElementById('stabilized-banner');
      stab.classList.remove('hidden');
      document.getElementById('stabilized-sub').textContent =
        `${State.optimizationResult.unmet.toFixed(1)} kWh unmet demand`;
      setTimeout(() => stab.classList.add('hidden'), 3000);
    });
  },

  showDecision() {
    const result = State.optimizationResult;
    if (!result || !result.explanation) return;

    const panel = document.getElementById('decision-panel');
    panel.classList.remove('hidden');
    panel.style.top = '80px';
    panel.style.left = '50%';
    panel.style.transform = 'translateX(-50%)';

    const exp = result.explanation;
    document.getElementById('decision-observation').textContent = exp.observations.join('. ') + '.';
    document.getElementById('decision-constraint').textContent = exp.constraints.join('. ') + '.';
    document.getElementById('decision-action').textContent = exp.actions.join(' ');
  },

  showEmergency() {
    document.getElementById('emergency-banner').classList.remove('hidden');
    document.getElementById('stabilized-banner').classList.add('hidden');
  },

  startClock() {
    setInterval(() => {
      State.time = (State.time + 0.02) % 24;
      const h = Math.floor(State.time);
      const m = Math.floor((State.time % 1) * 60);
      document.getElementById('sim-clock').textContent =
        `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }, 100);
  },

  updateAll() {
    const s = State;
    const r = s.optimizationResult;

    // Hero metrics
    document.getElementById('grid-status').textContent = s.gridStatus;
    document.getElementById('grid-status').className = 'metric-value ' +
      (s.gridStatus === 'STABLE' ? 'stable' : s.gridStatus === 'CRITICAL' ? 'critical' : 'warning');
    document.getElementById('renewable-share').textContent = s.renewableShare.toFixed(1) + '%';
    document.getElementById('current-load').textContent = s.demand.total.toFixed(0) + ' kW';

    // Flow summary
    document.getElementById('flow-solar').textContent = s.solar.output.toFixed(0) + ' kW';
    document.getElementById('flow-wind').textContent = s.wind.output.toFixed(0) + ' kW';
    document.getElementById('flow-hydro').textContent = s.hydro.output.toFixed(0) + ' kW';
    document.getElementById('flow-battery').textContent =
      (s.battery.chargeRate >= 0 ? '+' : '') + s.battery.chargeRate.toFixed(0) + ' kW';

    document.getElementById('bar-solar').style.width = (s.solar.output / s.solar.available * 100) + '%';
    document.getElementById('bar-wind').style.width = (s.wind.output / s.wind.capacity * 100) + '%';
    document.getElementById('bar-hydro').style.width = (s.hydro.output / s.hydro.capacity * 100) + '%';
    document.getElementById('bar-battery').style.width = (Math.abs(s.battery.chargeRate) / s.battery.maxCharge * 100) + '%';

    // Impact panel
    if (r) {
      document.getElementById('impact-renewable').textContent = s.renewableShare.toFixed(1) + '%';
      document.getElementById('impact-co2').textContent = (r.emissions * 1000).toFixed(0) + ' kg';
      document.getElementById('impact-cost').textContent = '$' + r.operatingCost.toFixed(2);
      document.getElementById('impact-curtail').textContent = r.curtailPct.toFixed(1) + '%';
      document.getElementById('impact-degrade').textContent = '$' + (r.batteryCycles * Optimization.batteryCycleCost * 100).toFixed(2);
    }

    // How It Works pipeline
    if (r) {
      document.getElementById('pipe-forecast').textContent =
        `Solar ${s.solar.output.toFixed(0)}kW · Wind ${s.wind.output.toFixed(0)}kW · Hydro ${s.hydro.output.toFixed(0)}kW · Demand ${s.demand.total.toFixed(0)}kW`;
      document.getElementById('pipe-dispatch').textContent =
        `Solar ${r.dispatch.solar.toFixed(0)}kW · Wind ${r.dispatch.wind.toFixed(0)}kW · Hydro ${r.dispatch.hydro.toFixed(0)}kW · Batt ${r.dispatch.battery > 0 ? '+' : ''}${r.dispatch.battery.toFixed(0)}kW`;
      document.getElementById('pipe-stability').textContent =
        `${r.totalWithBatt.toFixed(0)} kW gen vs ${r.demand.toFixed(0)} kW demand · ${r.gridStable ? 'Balanced' : 'Deficit ' + r.unmet.toFixed(1) + ' kW'}`;
    }

    // Update nav status dot
    const dot = document.querySelector('.status-dot');
    dot.className = 'status-dot ' + (s.gridStatus === 'STABLE' ? 'green' : 'red');
  },

  // ── 24-Hour Forecast Chart ──
  renderForecastChart() {
    const canvas = document.getElementById('forecast-chart');
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width - 48;
    canvas.height = 300;

    const w = canvas.width;
    const h = canvas.height;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    ctx.clearRect(0, 0, w, h);

    // Generate 24h data
    const data = [];
    for (let hr = 0; hr < 24; hr++) {
      const savedTime = State.time;
      State.time = hr;
      const wp = WeatherProfiles[State.weather];
      const solar = Math.max(0, State.solar.available * Simulation.solarCurve(hr) * wp.solarMod);
      const windBase = 8 + Math.sin(hr * 0.3) * 4;
      const windSpeed = windBase * wp.windMod;
      let wind = 0;
      if (windSpeed >= 3 && windSpeed <= 25) {
        wind = windSpeed < 12 ? State.wind.capacity * Math.pow((windSpeed - 3) / 9, 3) : State.wind.capacity;
      }
      wind *= wp.windMod;
      const hydro = Math.min(State.hydro.capacity, State.hydro.flow * 1.8 * wp.hydroMod);
      const demand = 120 * Simulation.demandCurve(hr);
      const totalGen = solar + wind + hydro;
      const soc = Math.max(0.1, Math.min(0.95, 0.68 + (totalGen - demand) / State.battery.capacity * 2));

      data.push({ hr, solar, wind, hydro, demand, soc });
      State.time = savedTime;
    }

    // Find max
    const maxVal = Math.max(...data.map(d => Math.max(d.solar, d.wind, d.hydro, d.demand))) * 1.1;

    // Draw grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (plotH / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '10px Inter';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxVal - (maxVal / 5) * i) + ' kW', padding.left - 8, y + 4);
    }

    // Draw curves
    const drawCurve = (key, color, lineWidth = 2) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = padding.left + (i / 23) * plotW;
        const y = padding.top + plotH - (d[key] / maxVal) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Fill
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = color;
      ctx.lineTo(padding.left + plotW, padding.top + plotH);
      ctx.lineTo(padding.left, padding.top + plotH);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    drawCurve('solar', '#f0c040');
    drawCurve('wind', '#4ecdc4');
    drawCurve('hydro', '#3498db');
    drawCurve('demand', '#e74c3c');

    // Battery SOC (scaled to plot)
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = padding.left + (i / 23) * plotW;
      const y = padding.top + plotH - (d.soc * maxVal * 0.5 / maxVal) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Hour labels
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '10px Inter';
    ctx.textAlign = 'center';
    for (let hr = 0; hr < 24; hr += 3) {
      const x = padding.left + (hr / 23) * plotW;
      ctx.fillText(`${hr}:00`, x, h - 8);
    }

    // Timeline hours
    const hoursContainer = document.getElementById('timeline-hours');
    hoursContainer.innerHTML = '';
    for (let hr = 0; hr < 24; hr++) {
      const span = document.createElement('span');
      span.textContent = hr + ':00';
      hoursContainer.appendChild(span);
    }

    // Store data for cursor
    this._forecastData = data;
    this._forecastPadding = padding;
    this._forecastPlotW = plotW;
    this._forecastPlotH = plotH;
    this._forecastMaxVal = maxVal;

    // Cursor interaction
    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const hr = Math.round(((x - padding.left) / plotW) * 23);
      if (hr >= 0 && hr < 24) {
        const cursor = document.getElementById('timeline-cursor');
        cursor.style.left = (padding.left + (hr / 23) * plotW) + 'px';

        const d = data[hr];
        document.getElementById('forecast-detail').classList.remove('hidden');
        document.getElementById('fd-solar').textContent = d.solar.toFixed(0) + ' kW';
        document.getElementById('fd-wind').textContent = d.wind.toFixed(0) + ' kW';
        document.getElementById('fd-hydro').textContent = d.hydro.toFixed(0) + ' kW';
        document.getElementById('fd-demand').textContent = d.demand.toFixed(0) + ' kW';
        document.getElementById('fd-soc').textContent = (d.soc * 100).toFixed(0) + '%';
      }
    };
  },

  updateComparison() {
    const naive = Optimization.runNaive(State);
    const ef = State.optimizationResult || Optimization.run(State);

    // Naive values
    const naiveCost = naive.operatingCost;
    const naiveCO2 = naive.emissions * 1000;
    const naiveCycles = naive.batteryCycles;
    const naiveUnmet = naive.unmet;

    // EnerFlux values
    const efCost = ef.operatingCost;
    const efCO2 = ef.emissions * 1000;
    const efCycles = ef.batteryCycles;
    const efUnmet = ef.unmet;

    // Max for bar widths
    const maxCost = Math.max(naiveCost, efCost) || 1;
    const maxCO2 = Math.max(naiveCO2, efCO2) || 1;
    const maxCycles = Math.max(naiveCycles, efCycles) || 1;
    const maxUnmet = Math.max(naiveUnmet, efUnmet, 1);

    document.getElementById('naive-cost').textContent = '$' + naiveCost.toFixed(0);
    document.getElementById('ef-cost').textContent = '$' + efCost.toFixed(0);
    document.getElementById('naive-cost-bar').style.width = (naiveCost / maxCost * 100) + '%';
    document.getElementById('ef-cost-bar').style.width = (efCost / maxCost * 100) + '%';

    document.getElementById('naive-co2').textContent = naiveCO2.toFixed(0) + ' kg';
    document.getElementById('ef-co2').textContent = efCO2.toFixed(0) + ' kg';
    document.getElementById('naive-co2-bar').style.width = (naiveCO2 / maxCO2 * 100) + '%';
    document.getElementById('ef-co2-bar').style.width = (efCO2 / maxCO2 * 100) + '%';

    document.getElementById('naive-cycles').textContent = naiveCycles.toFixed(1);
    document.getElementById('ef-cycles').textContent = efCycles.toFixed(1);
    document.getElementById('naive-cycles-bar').style.width = (naiveCycles / maxCycles * 100) + '%';
    document.getElementById('ef-cycles-bar').style.width = (efCycles / maxCycles * 100) + '%';

    document.getElementById('naive-unmet').textContent = naiveUnmet.toFixed(0) + ' kWh';
    document.getElementById('ef-unmet').textContent = efUnmet.toFixed(0) + ' kWh';
    document.getElementById('naive-unmet-bar').style.width = (naiveUnmet / maxUnmet * 100) + '%';
    document.getElementById('ef-unmet-bar').style.width = (efUnmet / maxUnmet * 100) + '%';
  },

  // ── 24-Hour Animation ──
  run24hOptimization() {
    if (State.isRunning24h) return;
    State.isRunning24h = true;

    const savedTime = State.time;
    let hr = 0;

    const step = () => {
      if (hr >= 24) {
        State.time = savedTime;
        State.isRunning24h = false;
        Simulation.fullUpdate();
        this.updateAll();
        return;
      }

      State.time = hr;
      Simulation.fullUpdate();
      this.updateAll();

      const h = Math.floor(hr);
      const m = Math.floor((hr % 1) * 60);
      document.getElementById('sim-clock').textContent =
        `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

      hr += 0.5;
      setTimeout(step, 200);
    };

    step();
  }
};

// ─── PARALLAX ─────────────────────────────────
document.addEventListener('mousemove', (e) => {
  State.mouseX = e.clientX;
  State.mouseY = e.clientY;
  State.parallaxX = (e.clientX / window.innerWidth - 0.5) * 2;
  State.parallaxY = (e.clientY / window.innerHeight - 0.5) * 2;
});

// ─── INIT ─────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Loading screen
  setTimeout(() => {
    document.getElementById('loading-screen').classList.add('fade-out');
    document.getElementById('app').classList.remove('hidden');

    setTimeout(() => {
      document.getElementById('loading-screen').style.display = 'none';
    }, 800);

    // Init systems
    Landscape.init();
    Landscape.animate();
    Simulation.fullUpdate();
    UI.init();
    UI.updateAll();

    // 24h button
    document.getElementById('btn-run-24h').addEventListener('click', () => {
      UI.run24hOptimization();
    });

  }, 2200);
});
