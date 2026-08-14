export function LoadingScreen({ fadingOut, hidden }: { fadingOut: boolean; hidden: boolean }) {
  if (hidden) return null;
  return (
    <div id="loading-screen" className={fadingOut ? 'fade-out' : ''}>
      <div className="loader-content">
        <div className="loader-ring" />
        <div className="loader-brand">ENERFLUX</div>
        <div className="loader-sub">Initializing microgrid simulation...</div>
        <div className="loader-bar">
          <div className="loader-bar-fill" />
        </div>
      </div>
    </div>
  );
}
