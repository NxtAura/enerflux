export function Footer() {
  return (
    <footer id="main-footer">
      <div className="footer-left">
        <div className="footer-brand">ENERFLUX</div>
        <div className="footer-sub">Adaptive renewable energy optimization</div>
      </div>
      <div className="footer-right">
        <div className="footer-stat">
          Simulation Engine: <span className="green">Online</span>
        </div>
        <div className="footer-stat">
          Optimization: <span className="green">Active</span>
        </div>
        <div className="footer-stat">
          Forecast Horizon: <span>24h</span>
        </div>
        <div className="footer-stat">
          Grid Frequency: <span>60.00 Hz</span>
        </div>
      </div>
    </footer>
  );
}
