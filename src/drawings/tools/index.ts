import { registerDrawingTool, type DrawingCtor } from '../Drawing';
import { lineTools } from './lines';
import { shapeTools } from './shapes';
import { fibTools } from './fibonacci';

/** All built-in drawing tools, grouped in toolbar order. */
export function allBuiltinDrawings(): DrawingCtor[] {
  return [...lineTools, ...fibTools, ...shapeTools];
}

let registered = false;
export function registerBuiltinDrawings(): void {
  if (registered) return;
  registered = true;
  for (const ctor of allBuiltinDrawings()) registerDrawingTool(ctor);
}
