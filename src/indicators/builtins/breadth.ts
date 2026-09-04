import type { IndicatorDefinition } from '../Indicator';

/**
 * Market-breadth / data-feed-dependent studies (spec §3.3, §3.31, §3.71, §5).
 *
 * These need external data that a plain OHLCV datafeed cannot provide, so nothing is registered here:
 * - Advance/Decline Line — cumulative (advancing issues − declining issues), needs exchange breadth feeds (USI:ADVN / USI:DECN).
 * - Advance/Decline Ratio — advancing / declining issues (same feeds).
 * - Cumulative Volume Index — CVI = CVI[1] + (advancing volume − declining volume), needs USI:UVOL / USI:DVOL.
 * - Open Interest — derivatives feed; also Funding rate, Long/Short ratios, Basis, Premium, Index/Mark price, Liquidation data.
 * - Fundamentals / estimates (Dividend Yield, Analyst price forecast, Price target) and the on-chain metrics family.
 *
 * The bars-based library study `Advance/Decline` (up-bars / down-bars over N bars on the chart symbol) is
 * computable and lives in misc.ts.
 */
export const breadthIndicators: IndicatorDefinition[] = [];
