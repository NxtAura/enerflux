import { weatherProfiles } from '../weatherProfiles';
import type { SimState } from '../types';

export interface Cloud {
  x: number;
  y: number;
  w: number;
  h: number;
  speed: number;
  alpha: number;
}

export interface AnimClock {
  time: number;
  waterOffset: number;
}

export interface Parallax {
  x: number;
  y: number;
}

export function createClouds(width: number): Cloud[] {
  const clouds: Cloud[] = [];
  for (let i = 0; i < 8; i++) {
    clouds.push({
      x: Math.random() * width * 1.5 - width * 0.25,
      y: 40 + Math.random() * 120,
      w: 80 + Math.random() * 200,
      h: 30 + Math.random() * 50,
      speed: 0.1 + Math.random() * 0.3,
      alpha: 0.15 + Math.random() * 0.2,
    });
  }
  return clouds;
}

export function renderLandscapeFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  state: SimState,
  parallax: Parallax,
  anim: AnimClock,
  clouds: Cloud[]
): void {
  const mx = parallax.x;
  const my = parallax.y;
  const t = anim.time;

  ctx.clearRect(0, 0, w, h);

  // Sky gradient
  const wp = weatherProfiles[state.weather];
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
  if (state.weather !== 'night') {
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 120);
    sunGlow.addColorStop(0, `rgba(255, 220, 100, ${0.9 * (1 - state.solar.panelDarkness * 0.8)})`);
    sunGlow.addColorStop(0.3, `rgba(255, 200, 80, ${0.3 * (1 - state.solar.panelDarkness * 0.5)})`);
    sunGlow.addColorStop(1, 'rgba(255, 200, 80, 0)');
    ctx.fillStyle = sunGlow;
    ctx.fillRect(sunX - 150, sunY - 150, 300, 300);

    ctx.beginPath();
    ctx.arc(sunX, sunY, 18, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 230, 130, ${1 - state.solar.panelDarkness * 0.6})`;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(sunX, sunY, 14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200, 210, 230, 0.8)';
    ctx.fill();
  }

  // Clouds
  clouds.forEach(c => {
    c.x += c.speed;
    if (c.x > w + c.w) c.x = -c.w;
    const cx = c.x + mx * -5;
    ctx.fillStyle = `rgba(180, 195, 210, ${c.alpha * (state.weather === 'night' ? 0.3 : 1)})`;
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

  drawMountains(ctx, w, h, mx, my);

  // Rain effect for storm/rain weather
  if (state.weather === 'storm' || state.weather === 'rain') {
    ctx.strokeStyle = state.weather === 'storm' ? 'rgba(150, 180, 220, 0.35)' : 'rgba(120, 160, 200, 0.25)';
    ctx.lineWidth = 1;
    const rainCount = state.weather === 'storm' ? 120 : 60;
    for (let i = 0; i < rainCount; i++) {
      const rx = (i * 17.3 + t * 200) % w;
      const ry = (i * 23.7 + t * 400) % h;
      const rlen = state.weather === 'storm' ? 12 : 8;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 2, ry + rlen);
      ctx.stroke();
    }
  }

  // Snow effect for very cold nights
  if (state.weather === 'night' && state.time > 22) {
    ctx.fillStyle = 'rgba(200, 210, 230, 0.4)';
    for (let i = 0; i < 20; i++) {
      const sx = (i * 47.3 + t * 30) % w;
      const sy = (i * 31.7 + t * 50) % h;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawForest(ctx, w, h, mx, my);
  drawGround(ctx, w, h, mx, my);
  drawWater(ctx, w, h, mx, my, anim.waterOffset);
  drawInfrastructure(ctx, w, h, mx, my, state, t, anim.waterOffset);
  drawEnergyParticles(ctx, w, h, mx, state, t);

  // Atmospheric haze
  const haze = ctx.createLinearGradient(0, h * 0.35, 0, h * 0.65);
  haze.addColorStop(0, 'rgba(30, 50, 40, 0)');
  haze.addColorStop(0.5, `rgba(${wp.skyColor[0] + 10}, ${wp.skyColor[1] + 20}, ${wp.skyColor[2] + 10}, 0.1)`);
  haze.addColorStop(1, `rgba(${wp.skyColor[0]}, ${wp.skyColor[1]}, ${wp.skyColor[2]}, 0.2)`);
  ctx.fillStyle = haze;
  ctx.fillRect(0, h * 0.35, w, h * 0.3);

  // Stars at night
  if (state.weather === 'night') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    for (let i = 0; i < 40; i++) {
      const sx = (i * 137.5 + 50) % w;
      const sy = (i * 73.7 + 20) % (h * 0.4);
      const ss = 0.5 + Math.sin(t * 0.5 + i) * 0.3;
      ctx.beginPath();
      ctx.arc(sx + mx * -1, sy + my * -0.5, ss, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  anim.time += 0.016;
  anim.waterOffset += 0.5;
}

function drawMountains(ctx: CanvasRenderingContext2D, w: number, h: number, mx: number, my: number): void {
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
}

function drawForest(ctx: CanvasRenderingContext2D, w: number, h: number, mx: number, my: number): void {
  const baseY = h * 0.48;
  ctx.fillStyle = 'rgba(18, 40, 25, 0.95)';

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
}

function drawGround(ctx: CanvasRenderingContext2D, w: number, h: number, mx: number, my: number): void {
  const groundY = h * 0.55;

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
    const rx = ((i * 97 + 30) % w) + mx * -10;
    const ry = groundY + 40 + ((i * 37) % 80);
    ctx.beginPath();
    ctx.ellipse(rx, ry + my * -3, 4 + (i % 3) * 2, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Grass tufts
  ctx.strokeStyle = 'rgba(40, 80, 45, 0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const gx = ((i * 53 + 10) % w) + mx * -10;
    const gy = groundY + 25 + ((i * 41) % 100);
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
}

function drawWater(ctx: CanvasRenderingContext2D, w: number, h: number, mx: number, my: number, waterOffset: number): void {
  const waterY = h * 0.52;
  const waterX = w * 0.25;

  // Stream
  ctx.fillStyle = 'rgba(40, 100, 140, 0.4)';
  ctx.beginPath();
  ctx.moveTo(waterX + mx * -7, waterY + my * -2);
  for (let y = 0; y < 100; y += 3) {
    const x = waterX + Math.sin((y + waterOffset) * 0.08) * 15 + mx * -7;
    ctx.lineTo(x, waterY + y + my * -2);
  }
  ctx.lineTo(waterX + 40 + mx * -7, waterY + 100 + my * -2);
  ctx.lineTo(waterX - 20 + mx * -7, waterY + 100 + my * -2);
  ctx.closePath();
  ctx.fill();

  // Water shimmer
  ctx.fillStyle = 'rgba(80, 160, 200, 0.15)';
  for (let i = 0; i < 8; i++) {
    const sx = waterX + Math.sin((waterOffset + i * 20) * 0.05) * 10 + mx * -7;
    const sy = waterY + i * 12 + Math.sin((waterOffset + i * 10) * 0.03) * 3 + my * -2;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 8, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawInfrastructure(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mx: number,
  my: number,
  state: SimState,
  t: number,
  waterOffset: number
): void {
  const groundY = h * 0.55;

  // Solar Farm
  const solarX = w * 0.15 + mx * -8;
  const solarY = groundY + 15 + my * -3;
  const panelDark = state.solar.panelDarkness;

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const px = solarX + c * 22 + r * 8;
      const py = solarY + r * 14;
      ctx.fillStyle = `rgba(${40 + panelDark * 30}, ${55 + panelDark * 20}, ${80 + panelDark * 15}, 0.9)`;
      ctx.fillRect(px, py, 18, 10);
      ctx.fillStyle = `rgba(${50 + panelDark * 40}, ${70 + panelDark * 30}, ${120 - panelDark * 40}, 0.8)`;
      ctx.fillRect(px + 1, py + 1, 7, 4);
      ctx.fillRect(px + 9, py + 1, 8, 4);
      ctx.fillRect(px + 1, py + 6, 7, 3);
      ctx.fillRect(px + 9, py + 6, 8, 3);
      if (panelDark < 0.5) {
        ctx.fillStyle = `rgba(255, 240, 150, ${(0.5 - panelDark) * 0.3})`;
        ctx.fillRect(px + 3, py + 2, 4, 2);
      }
    }
  }
  // Panel mounts
  ctx.strokeStyle = 'rgba(80, 80, 80, 0.6)';
  ctx.lineWidth = 1;
  for (let r = 0; r < 3; r++) {
    ctx.beginPath();
    ctx.moveTo(solarX + r * 8 + 9, solarY + r * 14 + 10);
    ctx.lineTo(solarX + r * 8 + 9, solarY + r * 14 + 18);
    ctx.stroke();
  }

  // Wind Turbines
  const windBaseX = w * 0.42 + mx * -10;
  const windBaseY = groundY + 5 + my * -3;
  const rpm = state.wind.speed * 3;

  for (let i = 0; i < 3; i++) {
    const tx = windBaseX + i * 55;
    const ty = windBaseY - (i === 1 ? 10 : 0);
    const towerH = 65 + (i === 1 ? 10 : 0);

    ctx.strokeStyle = 'rgba(180, 185, 190, 0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx, ty - towerH);
    ctx.stroke();

    ctx.fillStyle = 'rgba(200, 205, 210, 0.8)';
    ctx.fillRect(tx - 4, ty - towerH - 3, 10, 6);

    const bladeLen = 28 + (i === 1 ? 5 : 0);
    const angle = t * rpm * 0.01 + i * 2.1;
    ctx.strokeStyle = 'rgba(210, 215, 220, 0.8)';
    ctx.lineWidth = 2;
    for (let b = 0; b < 3; b++) {
      const ba = angle + (b * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(tx + 1, ty - towerH);
      ctx.lineTo(tx + 1 + Math.cos(ba) * bladeLen, ty - towerH + Math.sin(ba) * bladeLen);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(tx + 1, ty - towerH, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(160, 165, 170, 0.9)';
    ctx.fill();
  }

  // Hydro Dam
  const damX = w * 0.22 + mx * -7;
  const damY = groundY - 5 + my * -2;

  ctx.fillStyle = 'rgba(100, 100, 105, 0.85)';
  ctx.beginPath();
  ctx.moveTo(damX, damY - 30);
  ctx.lineTo(damX + 50, damY - 30);
  ctx.lineTo(damX + 55, damY + 15);
  ctx.lineTo(damX - 5, damY + 15);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(80, 80, 85, 0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(damX + 2 + i * 12, damY - 28);
    ctx.lineTo(damX + 4 + i * 12, damY + 13);
    ctx.stroke();
  }

  const flowRate = state.hydro.flow / 40;
  ctx.fillStyle = `rgba(60, 140, 200, ${0.3 + flowRate * 0.3})`;
  for (let i = 0; i < 5; i++) {
    const wx = damX + 10 + i * 8;
    const wy = damY - 28 + Math.sin(waterOffset * 0.05 + i) * 2;
    ctx.beginPath();
    ctx.ellipse(wx, wy, 3, 2 + flowRate * 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Battery Container
  const battX = w * 0.62 + mx * -12;
  const battY = groundY + 20 + my * -4;

  const socColor =
    state.battery.soc > 0.5 ? 'rgba(46, 204, 113,' : state.battery.soc > 0.2 ? 'rgba(240, 192, 64,' : 'rgba(231, 76, 60,';
  ctx.fillStyle = 'rgba(50, 55, 55, 0.9)';
  ctx.fillRect(battX, battY, 55, 30);

  const socWidth = 51 * state.battery.soc;
  ctx.fillStyle = `${socColor} 0.6)`;
  ctx.fillRect(battX + 2, battY + 2, socWidth, 26);

  if (state.battery.status === 'charging' || state.battery.status === 'discharging') {
    ctx.shadowColor = socColor + ' 0.4)';
    ctx.shadowBlur = 15;
    ctx.fillRect(battX, battY, 55, 30);
    ctx.shadowBlur = 0;
  }

  ctx.strokeStyle = 'rgba(100, 105, 105, 0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(battX, battY, 55, 30);

  ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
  ctx.font = '8px Inter';
  ctx.fillText('BESS', battX + 18, battY + 18);

  // Houses
  const houseX = w * 0.78 + mx * -14;
  const houseY = groundY + 10 + my * -4;
  const demandIntensity = state.demand.total / 200;

  for (let i = 0; i < 5; i++) {
    const hx = houseX + i * 30;
    const hy = houseY + Math.sin(i * 1.5) * 5;
    const hh = 18 + (i % 2) * 8;

    ctx.fillStyle = `rgba(${45 + i * 5}, ${50 + i * 3}, ${48 + i * 4}, 0.9)`;
    ctx.fillRect(hx, hy - hh, 22, hh);

    ctx.fillStyle = `rgba(${60 + i * 3}, ${55 + i * 2}, 50, 0.85)`;
    ctx.beginPath();
    ctx.moveTo(hx - 3, hy - hh);
    ctx.lineTo(hx + 11, hy - hh - 10);
    ctx.lineTo(hx + 25, hy - hh);
    ctx.closePath();
    ctx.fill();

    const windowGlow = demandIntensity * (0.5 + Math.sin(t * 0.5 + i * 1.3) * 0.2);
    ctx.fillStyle = `rgba(255, 220, 120, ${windowGlow * 0.8})`;
    ctx.fillRect(hx + 4, hy - hh + 5, 5, 5);
    ctx.fillRect(hx + 13, hy - hh + 5, 5, 5);

    if (hh > 20) {
      ctx.fillRect(hx + 4, hy - hh + 13, 5, 5);
      ctx.fillRect(hx + 13, hy - hh + 13, 5, 5);
    }
  }

  drawTransmissionLines(ctx, w, mx, my, groundY);
}

function drawTransmissionLines(ctx: CanvasRenderingContext2D, w: number, mx: number, my: number, groundY: number): void {
  const lineY = groundY - 5 + my * -3;

  const solarEndX = w * 0.15 + 80 + mx * -8;
  const gridCenterX = w * 0.5 + mx * -10;

  ctx.strokeStyle = 'rgba(100, 100, 100, 0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

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

  ctx.beginPath();
  ctx.arc(gridCenterX, lineY, 5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(46, 204, 113, 0.5)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(46, 204, 113, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawEnergyParticles(ctx: CanvasRenderingContext2D, w: number, h: number, mx: number, state: SimState, t: number): void {
  const groundY = h * 0.55;
  const lineY = groundY - 5;
  const result = state.optimizationResult;
  if (!result) return;

  const dispatch = result.dispatch;

  const routes: { from: number; to: number; power: number; color: [number, number, number]; mx?: number }[] = [
    { from: w * 0.15 + 80, to: w * 0.5, power: dispatch.solar, color: [240, 192, 64] },
    { from: w * 0.42 + 55, to: w * 0.5, power: dispatch.wind, color: [78, 205, 196] },
    { from: w * 0.5, to: w * 0.78, power: dispatch.solar + dispatch.wind + dispatch.hydro, color: [100, 180, 255] },
  ];

  const battX = w * 0.62 + 27 + mx * -12;
  if (dispatch.battery > 1) {
    routes.push({ from: w * 0.5, to: battX, power: dispatch.battery, color: [46, 204, 113], mx: -10 });
  } else if (dispatch.battery < -1) {
    routes.push({ from: battX, to: w * 0.5, power: Math.abs(dispatch.battery), color: [46, 204, 113], mx: -10 });
  }

  routes.forEach(route => {
    if (route.power < 1) return;
    const particleCount = Math.min(16, Math.max(2, Math.ceil(route.power / 12)));
    const speed = 0.4 + route.power / 60;

    for (let i = 0; i < particleCount; i++) {
      const progress = (t * speed * 0.35 + i / particleCount) % 1;
      const routeFrom = route.from + (route.mx ?? 0) + mx * -10;
      const routeTo = route.to + (route.mx ?? 0) + mx * -10;
      const px = routeFrom + (routeTo - routeFrom) * progress;
      const py = lineY + Math.sin(progress * Math.PI * 3 + i * 0.8) * 4;

      const alpha = 0.6 + Math.sin(progress * Math.PI) * 0.4;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${route.color[0]}, ${route.color[1]}, ${route.color[2]}, ${alpha})`;
      ctx.fill();

      const glowGrad = ctx.createRadialGradient(px, py, 0, px, py, 8);
      glowGrad.addColorStop(0, `rgba(${route.color[0]}, ${route.color[1]}, ${route.color[2]}, 0.25)`);
      glowGrad.addColorStop(1, `rgba(${route.color[0]}, ${route.color[1]}, ${route.color[2]}, 0)`);
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fillStyle = glowGrad;
      ctx.fill();
    }
  });
}
