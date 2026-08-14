import type { WeatherKey, WeatherProfile } from './types';

export const weatherProfiles: Record<WeatherKey, WeatherProfile> = {
  sunny: { solarMod: 1.0, windMod: 1.0, hydroMod: 1.0, skyColor: [30, 60, 40], cloudCount: 2 },
  cloudy: { solarMod: 0.55, windMod: 1.1, hydroMod: 1.0, skyColor: [25, 40, 50], cloudCount: 6 },
  rain: { solarMod: 0.25, windMod: 1.2, hydroMod: 1.3, skyColor: [15, 25, 35], cloudCount: 8 },
  storm: { solarMod: 0.1, windMod: 1.8, hydroMod: 1.4, skyColor: [10, 15, 25], cloudCount: 10 },
  night: { solarMod: 0.0, windMod: 0.8, hydroMod: 1.0, skyColor: [5, 8, 15], cloudCount: 3 },
  windy: { solarMod: 0.9, windMod: 1.6, hydroMod: 1.1, skyColor: [25, 55, 45], cloudCount: 4 },
};
