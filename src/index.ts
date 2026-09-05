export { Chart } from './core/Chart';
export type { ChartConstructorOptions, SavedChart, ChartEvents } from './core/Chart';
export { ChartModel } from './core/ChartModel';
export { TimeScale } from './core/TimeScale';
export { PriceScale } from './core/PriceScale';
export { Pane } from './core/Pane';
export { defaultOptions, mergeOptions, applyTheme, LineStyle, TV, INDICATOR_PALETTE, COLOR_SWATCHES } from './core/options';
export type { ChartOptions, DeepPartial, ThemeName, PriceScaleMode, CrosshairMode, LineWidth } from './core/options';
export * from './data/types';
export { parseResolution, normalizeResolution, resolutionToSeconds, DEFAULT_INTERVALS } from './data/resolution';
export { DataLoader, normalizeBars } from './data/DataLoader';
export { SampleDatafeed } from './data/SampleDatafeed';
export { MainSeries } from './series/MainSeries';
export { VolumeSeries } from './series/VolumeSeries';
export { DataSource } from './series/Series';
export type { RenderContext, LegendItem, AxisLabel } from './series/Series';
export * as ta from './indicators/ta';
export { IndicatorInstance, registerIndicator, getIndicator, listIndicators, searchIndicators, plotStyle, buildIndicatorContext } from './indicators/Indicator';
export type { IndicatorDefinition, IndicatorInput, IndicatorPlot, IndicatorBand, IndicatorFill, IndicatorContext, PlotStyle, ComputeResult } from './indicators/Indicator';
export { Drawing, registerDrawingTool, getDrawingTool, listDrawingTools, deserializeDrawing, P } from './drawings/Drawing';
export type { DrawingPoint, DrawingRenderContext, PropertyDef, SerializedDrawing, HitTarget } from './drawings/Drawing';
export { DrawingManager } from './drawings/DrawingManager';
export * from './util/format';
export * from './util/time';
export * from './util/color';
export { registerBuiltinIndicators } from './indicators/builtins/index';
export { registerBuiltinDrawings } from './drawings/tools/index';

import { registerBuiltinIndicators } from './indicators/builtins/index';
import { registerBuiltinDrawings } from './drawings/tools/index';
import './ui/index';

registerBuiltinIndicators();
registerBuiltinDrawings();

export { StrategyController, DEFAULT_STRATEGY_SCRIPT } from './strategy/StrategyEngine';
export type { StrategyOptions, StrategyState, StrategyEvents, StrategyPanelTab, SavedStrategy } from './strategy/StrategyEngine';
export { Broker } from './strategy/Broker';
export { buildReport, monthlyReturns, sharpeRatio, sortinoRatio } from './strategy/metrics';
export { PyodideRunner } from './strategy/PythonRunner';
export type { PythonRunner, PythonJob, PythonRunResult } from './strategy/PythonRunner';
export { defaultStrategyProperties } from './strategy/types';
export type {
  StrategyProperties, StrategyBar, BacktestReport, MetricsGroup, ClosedTrade, OpenTrade, EquityPoint, FillEvent, PendingOrder,
  StrategyPlot, StrategyInputDef, StrategyError, StrategyLog, PythonRunOutput, OrderParams, ExitParams,
} from './strategy/types';
export { createCodeEditor, highlightPython } from './ui/codeEditor';

export const version = '0.2.0';
