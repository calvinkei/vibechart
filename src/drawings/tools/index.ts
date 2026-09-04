import { registerDrawingTool, type DrawingCtor } from '../Drawing';
import { lineTools } from './lines';
import { channelsTools } from './channels';
import { fibTools } from './fibonacci';
import { gannTools } from './gann';
import { pitchforkTools } from './pitchfork';
import { shapeTools } from './shapes';
import { textTools } from './text';
import { arrowsTools } from './arrows';
import { patternsTools } from './patterns';
import { elliottTools } from './elliott';
import { predictionTools } from './prediction';
import { measureTools } from './measure';
import { volumeProfileTools } from './volumeProfile';
import { cursorsTools } from './cursors';

/** All built-in drawing tools, grouped in TradingView toolbar order. */
export function allBuiltinDrawings(): DrawingCtor[] {
  return [
    ...cursorsTools,
    ...lineTools, ...channelsTools,
    ...fibTools, ...gannTools, ...pitchforkTools,
    ...shapeTools, ...arrowsTools, ...textTools,
    ...patternsTools, ...elliottTools,
    ...predictionTools, ...measureTools, ...volumeProfileTools,
  ];
}

let registered = false;
export function registerBuiltinDrawings(): void {
  if (registered) return;
  registered = true;
  for (const ctor of allBuiltinDrawings()) registerDrawingTool(ctor);
}
