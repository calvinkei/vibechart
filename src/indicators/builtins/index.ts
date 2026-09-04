import { registerIndicator, type IndicatorDefinition } from '../Indicator';
import { movingAverages } from './movingAverages';
import { oscillators } from './oscillators';

/** All built-in indicator definitions. Extended by additional files in this folder. */
export function allBuiltinIndicators(): IndicatorDefinition[] {
  return [...movingAverages, ...oscillators];
}

let registered = false;
export function registerBuiltinIndicators(): void {
  if (registered) return;
  registered = true;
  for (const def of allBuiltinIndicators()) registerIndicator(def);
}
