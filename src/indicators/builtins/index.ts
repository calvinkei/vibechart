import { registerIndicator, type IndicatorDefinition } from '../Indicator';
import { movingAverages } from './movingAverages';
import { oscillators } from './oscillators';
import { trendIndicators } from './trend';
import { volatilityIndicators } from './volatility';
import { volumeIndicators } from './volume';
import { momentumIndicators } from './momentum';
import { breadthIndicators } from './breadth';
import { pivotsIndicators } from './pivots';
import { volumeProfileIndicators } from './volumeProfile';
import { candlestickPatternsIndicators } from './candlestickPatterns';
import { miscIndicators } from './misc';

/** All built-in indicator definitions. */
export function allBuiltinIndicators(): IndicatorDefinition[] {
  return [
    ...movingAverages, ...oscillators, ...trendIndicators, ...volatilityIndicators, ...volumeIndicators,
    ...momentumIndicators, ...breadthIndicators, ...pivotsIndicators, ...volumeProfileIndicators,
    ...candlestickPatternsIndicators, ...miscIndicators,
  ];
}

let registered = false;
export function registerBuiltinIndicators(): void {
  if (registered) return;
  registered = true;
  const seen = new Set<string>();
  for (const def of allBuiltinIndicators()) {
    if (seen.has(def.id)) { console.warn(`[vibechart] duplicate indicator id: ${def.id}`); continue; }
    seen.add(def.id);
    registerIndicator(def);
  }
}
