import { useEffect, useMemo, useState } from 'react';
import { SimStore, useSimState } from '../store';
import { fullUpdate } from '../simulation';
import { initialSimState } from '../types';
import type { Section } from '../types';
import { LoadingScreen } from './LoadingScreen';
import { Nav } from './Nav';
import { LandscapeSection } from './LandscapeSection';
import { AnalyticsSection } from './AnalyticsSection';
import { CompareSection } from './CompareSection';
import { HowItWorksSection } from './HowItWorksSection';
import { Footer } from './Footer';

export function App() {
  const store = useMemo(() => new SimStore(fullUpdate(initialSimState)), []);
  const state = useSimState(store);
  const [section, setSection] = useState<Section>('landscape');
  const [loadingHidden, setLoadingHidden] = useState(false);
  const [loadingFadeOut, setLoadingFadeOut] = useState(false);
  const [appVisible, setAppVisible] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => {
      setLoadingFadeOut(true);
      setAppVisible(true);
    }, 2200);
    return () => clearTimeout(t1);
  }, []);

  useEffect(() => {
    if (!loadingFadeOut) return;
    const t2 = setTimeout(() => setLoadingHidden(true), 800);
    return () => clearTimeout(t2);
  }, [loadingFadeOut]);

  return (
    <>
      <LoadingScreen fadingOut={loadingFadeOut} hidden={loadingHidden} />

      <div id="app" className={appVisible ? '' : 'hidden'}>
        <Nav store={store} section={section} gridStatus={state.gridStatus} onNavigate={setSection} />

        <LandscapeSection store={store} state={state} active={section === 'landscape'} />
        <AnalyticsSection store={store} state={state} active={section === 'analytics'} />
        <CompareSection state={state} active={section === 'compare'} />
        <HowItWorksSection state={state} active={section === 'how-it-works'} />

        <Footer />
      </div>
    </>
  );
}
