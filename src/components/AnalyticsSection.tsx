import { useEffect, useRef, useState } from 'react';
import type { SimStore } from '../store';
import { computeForecast } from '../simulation';
import { setHour } from '../engine';
import type { ForecastPoint } from '../simulation';
import type { SimState } from '../types';

const PADDING = { top: 20, right: 20, bottom: 30, left: 50 };

function drawChart(canvas: HTMLCanvasElement, data: ForecastPoint[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const rect = canvas.parentElement!.getBoundingClientRect();
  canvas.width = rect.width - 48;
  canvas.height = 300;

  const w = canvas.width;
  const h = canvas.height;
  const plotW = w - PADDING.left - PADDING.right;
  const plotH = h - PADDING.top - PADDING.bottom;

  ctx.clearRect(0, 0, w, h);

  const maxVal = Math.max(...data.map(d => Math.max(d.solar, d.wind, d.hydro, d.demand))) * 1.1;

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = PADDING.top + (plotH / 5) * i;
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y);
    ctx.lineTo(w - PADDING.right, y);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '10px Inter';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal - (maxVal / 5) * i) + ' kW', PADDING.left - 8, y + 4);
  }

  const drawCurve = (key: 'solar' | 'wind' | 'hydro' | 'demand', color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = PADDING.left + (i / 23) * plotW;
      const y = PADDING.top + plotH - (d[key] / maxVal) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.globalAlpha = 0.08;
    ctx.fillStyle = color;
    ctx.lineTo(PADDING.left + plotW, PADDING.top + plotH);
    ctx.lineTo(PADDING.left, PADDING.top + plotH);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  drawCurve('solar', '#f0c040');
  drawCurve('wind', '#4ecdc4');
  drawCurve('hydro', '#3498db');
  drawCurve('demand', '#e74c3c');

  ctx.strokeStyle = '#2ecc71';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = PADDING.left + (i / 23) * plotW;
    const y = PADDING.top + plotH - ((d.soc * maxVal * 0.5) / maxVal) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '10px Inter';
  ctx.textAlign = 'center';
  for (let hr = 0; hr < 24; hr += 3) {
    const x = PADDING.left + (hr / 23) * plotW;
    ctx.fillText(`${hr}:00`, x, h - 8);
  }

  return { plotW, plotH };
}

export function AnalyticsSection({ store, state, active }: { store: SimStore; state: SimState; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dataRef = useRef<ForecastPoint[]>([]);
  const plotRef = useRef<{ plotW: number; plotH: number } | null>(null);
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [detail, setDetail] = useState<ForecastPoint | null>(null);

  useEffect(() => {
    if (!active || !canvasRef.current) return;
    const data = computeForecast(state);
    dataRef.current = data;
    plotRef.current = drawChart(canvasRef.current, data);
    setDetail(null);
    setCursorX(null);
  }, [active, state]);

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const plot = plotRef.current;
    if (!canvas || !plot) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const hr = Math.round(((x - PADDING.left) / plot.plotW) * 23);
    if (hr >= 0 && hr < 24) {
      setCursorX(PADDING.left + (hr / 23) * plot.plotW);
      setDetail(dataRef.current[hr]);
    }
  }

  function run24h() {
    const current = store.getSnapshot();
    if (current.isRunning24h) return;
    const savedTime = current.time;
    store.set({ ...current, isRunning24h: true });

    let hr = 0;
    const step = () => {
      if (hr >= 24) {
        store.set({ ...setHour(store.getSnapshot(), savedTime), isRunning24h: false });
        return;
      }
      store.set(setHour(store.getSnapshot(), hr));
      hr += 0.5;
      setTimeout(step, 200);
    };
    step();
  }

  return (
    <section id="section-analytics" className={'section' + (active ? ' active' : '')}>
      <div className="analytics-container">
        <div className="analytics-header">
          <h2 className="section-title">24-HOUR MICROGRID FORECAST</h2>
          <button className="btn-primary" onClick={run24h}>
            RUN 24-HOUR OPTIMIZATION
          </button>
        </div>
        <div className="chart-container">
          <canvas id="forecast-chart" ref={canvasRef} onMouseMove={onMouseMove} />
          <div className="chart-timeline" id="chart-timeline">
            <div className="timeline-cursor" style={cursorX !== null ? { left: cursorX } : undefined} />
          </div>
        </div>
        <div className="chart-legend">
          <span className="legend-item">
            <span className="legend-dot solar" /> Solar
          </span>
          <span className="legend-item">
            <span className="legend-dot wind" /> Wind
          </span>
          <span className="legend-item">
            <span className="legend-dot hydro" /> Hydro
          </span>
          <span className="legend-item">
            <span className="legend-dot demand" /> Demand
          </span>
          <span className="legend-item">
            <span className="legend-dot battery" /> Battery SOC
          </span>
        </div>
        <div className="timeline-hours" id="timeline-hours">
          {Array.from({ length: 24 }, (_, hr) => (
            <span key={hr}>{hr}:00</span>
          ))}
        </div>
        <div id="forecast-detail" className={'forecast-detail' + (detail ? '' : ' hidden')}>
          <div className="fd-item">
            <span className="fd-label">Solar:</span> <span>{detail ? detail.solar.toFixed(0) : 0} kW</span>
          </div>
          <div className="fd-item">
            <span className="fd-label">Wind:</span> <span>{detail ? detail.wind.toFixed(0) : 0} kW</span>
          </div>
          <div className="fd-item">
            <span className="fd-label">Hydro:</span> <span>{detail ? detail.hydro.toFixed(0) : 0} kW</span>
          </div>
          <div className="fd-item">
            <span className="fd-label">Demand:</span> <span>{detail ? detail.demand.toFixed(0) : 0} kW</span>
          </div>
          <div className="fd-item">
            <span className="fd-label">Battery SOC:</span> <span>{detail ? (detail.soc * 100).toFixed(0) : 0}%</span>
          </div>
        </div>
      </div>
    </section>
  );
}
