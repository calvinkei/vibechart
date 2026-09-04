# 02 — TradingView Drawing Tools: Exhaustive Behaviour & Style Specification

Target: a 1:1 open-source clone of the TradingView (TV) chart drawing layer in pure JavaScript.
Scope: every tool in TV's left toolbar (Supercharts / Charting Library "Advanced Charts"), the
drawing engine behaviours around them, and the full default property set per tool.

Research date: 2026-09-04.

## How to read this document

Confidence markers used throughout:

| Marker | Meaning |
|---|---|
| (doc) | Taken verbatim / directly from TradingView documentation (Help Center article or Charting Library API reference, latest = v31). |
| (lib) | Value comes from the Charting Library `*LineToolOverrides` interface pages (machine-parsed, complete). These are the authoritative defaults of the TV chart engine; tradingview.com uses the same engine. |
| (old) | Value from the older (v1.x–v18) community-mirrored Charting Library docs (`Drawings-Overrides.md`, `Shapes-and-Overrides.md`). Useful for legacy names/constants; superseded by (lib) where they differ. |
| (obs) | Behaviour observed in the TV UI / widely reported by TV-authored tutorials, but not stated in an official reference page. Treat as "matches TV in practice, verify pixel details". |
| (?) | Could not be confirmed from any fetched source. Best effort; verify against tradingview.com before relying on it. |

Primary sources:

- Help Center folder "Drawings" and the master list "Drawing tools available on TradingView"
  (`https://www.tradingview.com/support/solutions/43000703396`) plus one article per tool (IDs cited inline).
- Charting Library docs: `ui_elements/drawings/`, `ui_elements/drawings/Drawings-List/`,
  `ui_elements/drawings/drawings-api/`, `customization/overrides/Drawings-Overrides/`,
  `getting_started/Shortcuts/`, `customization/Featuresets/`, and the API reference
  `api/modules/Charting_Library/` (`SupportedLineTools`, `DrawingEventType`, `ChartActionId`)
  and every `api/interfaces/Charting_Library.<Tool>LineToolOverrides/` page (86 parsed + 6 probed).
- Community mirrors of the older library docs (github.com/rushinarasimha/TradingView_ChartingLibrary_Documentation).
- TV-authored tutorials ("TradingView Masterclass: How To Use Drawing Tools", "How To Use TradingView Hotkeys and Shortcuts", TV posts on X).

---

## 0. Conventions and shared enumerations

### 0.1 Coordinate model

Every drawing is a list of **points**. A point is `{ time, price }` on the main pane (or on an
indicator pane when the drawing is owned by a study — see §3.2).

- `time` is the bar's open time (Unix seconds). Charting Library `ShapePoint` = `StickedPoint | PricedPoint | TimePoint` (doc):
  - `StickedPoint { time, channel: 'open' | 'high' | 'low' | 'close' }` — price is taken from the bar's OHLC at creation; default channel `open` (old).
  - `PricedPoint { time, price }`.
  - `TimePoint { time }` — vertical-only tools (vertical line, etc.).
- Some tools store extra scalar state instead of/in addition to points (e.g. Trend angle stores `angle`; Long/Short position store `profitLevel`, `stopLevel` in ticks; Anchored text/note store `{x%, y%}` screen percentages).

### 0.2 Enumerations used by override properties (lib/old)

| Enum | Values |
|---|---|
| `linestyle` | `0` Solid, `1` Dotted, `2` Dashed, `3` Large dashed (old constant `LINESTYLE_LARGE_DASHED`; the UI exposes Solid / Dashed / Dotted). |
| `leftEnd` / `rightEnd` (line ends) | `0` Normal, `1` Arrow, `2` Circle (old constant `LINEEND_CIRCLE`; UI dropdown shows Normal / Arrow). |
| `statsPosition` (trend-line family) | Dropdown "Stats position": Left / Center / Right / Auto (doc, Trend angle article). Numeric mapping (?): `0` Left, `1` Center, `2` Right, `3` Auto. Defaults: Trend line/Ray/Extended/Arrow = `2`; Info line = `1`. |
| `horzLabelsAlign` | `'left' | 'center' | 'right'` |
| `vertLabelsAlign` | `'top' | 'middle' | 'bottom'` |
| `textOrientation` (Vertical line) | `'vertical' | 'horizontal'` |
| Bars-pattern `mode` | `0` Bars, `1` Line, `2` Open/Close, `3` Line (open), `4` Line (high), `5` Line (low), `6` Line (HL/2) (old). |
| Pitchfork `style` | `0` Original, `1` Schiff, `2` Inside, `3` Modified Schiff (lib, current). (old docs listed `SCHIFF2=2, INSIDE=3` — reversed; use the current values.) |
| `riskDisplayMode` | `'percents' | 'money'` |
| `transparency` | 0–100 (percent transparent). Note the UI shows **opacity**; `transparency = 100 − opacity`. |
| Level object shapes | `LEVELS_TYPE_B {coeff,color,visible}`, `LEVELS_TYPE_C {coeff,color,visible,linestyle,linewidth}`, `LEVELS_TYPE_D {color,width,visible}`, `LEVELS_TYPE_E {color,visible,width,x,y}`, `LEVELS_TYPE_F {coeff1,coeff2,color,visible,linestyle,linewidth}` (old). |

### 0.3 UI value lists (obs)

- Line width choices: **1, 2, 3, 4** px (the floating toolbar "width" menu). Override `linewidth` accepts any number.
- Line style choices: Solid, Dashed, Dotted.
- Font size choices in text dropdowns: **10, 11, 12, 14, 16, 20, 24, 28, 32, 40**.
- Opacity slider in the colour picker: 0–100 %.
- Default font family: web UI uses the chart font (`-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif`); override defaults name `Verdana` (old) / `Arial` for balloon/note.

### 0.4 Default colour vocabulary (lib)

These hex values appear over and over in the defaults and are TV's design-system colours:

| Name | Hex | Typical use |
|---|---|---|
| TV blue | `#2962FF` | Default line colour of most line tools, level 1.618, arrows, notes |
| TV red | `#F23645` | Stop zones, fib 0.236 / 2.618, pitchfork median |
| TV green/teal | `#089981` | Profit zones, fib 0.618, arrow-mark-up |
| Green | `#4CAF50` | fib 0.5, success state |
| Orange | `#FF9800` | fib 0.382, flat top/bottom |
| Cyan | `#00BCD4` | fib 0.786, brush, polyline |
| Purple | `#9C27B0` | fib 3.618, rectangle |
| Deep purple | `#673AB7` | fib-time 3, triangle pattern, double curve |
| Pink | `#E91E63` | fib 4.236, arc |
| Grey | `#808080` (lib) / `#787B86` (web UI grey) | fib 0 / 1, trend lines of fib tools |
| Yellow | `#FFEB3B` | theme `color7` |
| Light orange | `#FFB74D` | pitchfork 0.25 |
| Light green | `#81C784` | pitchfork 0.382 |
| Salmon | `#F77C80` | pitchfork 2.0 |
| Label grey | `#585858` | range-tool label backgrounds |

Charting Library custom theme tokens (doc): `color1 #2962ff` (blue), `color2 #787b86` (grey), `color3 #f23645` (red), `color4 #089981` (green), `color5 #ff9800` (orange), `color6 #9c27b0` (purple), `color7 #ffeb3b` (yellow); each has 19 shades in the theme system.

---

## 1. Master tool table

Groups follow TV's left toolbar (doc: "Drawing tools available on TradingView"). Library `shape` id
is the `SupportedLineTools` string; the override namespace is the `linetool…` prefix used by
`overrides` / `applyOverrides` / `setProperties`.

Point counts: **creation clicks** (what the user does) and **stored points** (what the model holds) can differ — both are listed.

### Cursors

| Tool | Library id | Notes |
|---|---|---|
| Cross | `cursor` | default; crosshair lines + axis labels |
| Dot | `dot` | crosshair with a dot |
| Arrow | `arrow_cursor` | plain pointer, no crosshair |
| Eraser | `eraser` | click a drawing to delete it; `Ctrl` + eraser partially erases (brush/highlighter) |
| Demonstration | — (web only) | `Alt` + draw temporary strokes that fade after a few seconds |
| Magic | — (web only, listed in TV's tool list; behaviour not documented in fetched sources) (?) | |

### Trend tools

| Tool (TV) | Library id | Override ns | Clicks | Stored pts |
|---|---|---|---|---|
| Trend line | `trend_line` | `linetooltrendline` | 2 | 2 |
| Ray | `ray` | `linetoolray` | 2 | 2 |
| Info line | `info_line` | `linetoolinfoline` | 2 | 2 |
| Extended line | `extended` | `linetoolextended` | 2 | 2 |
| Trend angle | `trend_angle` | `linetooltrendangle` | 2 | 1 + `angle` |
| Horizontal line | `horizontal_line` | `linetoolhorzline` | 1 | 1 |
| Horizontal ray | `horizontal_ray` | `linetoolhorzray` | 1 | 1 |
| Vertical line | `vertical_line` | `linetoolvertline` | 1 | 1 |
| Cross line | `cross_line` | `linetoolcrossline` | 1 | 1 |
| Arrow | `arrow` | `linetoolarrow` | 2 | 2 |
| Parallel channel | `parallel_channel` | `linetoolparallelchannel` | 3 | 3 |
| Regression trend | `regression_trend` | `linetoolregressiontrend` | 2 | 2 |
| Flat top/bottom | `flat_bottom` | `linetoolflatbottom` | 3 | 3 (obs: 4 handles) |
| Disjoint channel | `disjoint_angle` | `linetooldisjointangle` | 3 | 4 (obs) |
| Anchored VWAP | `anchored_vwap` | `linetoolanchoredvwap` | 1 | 1 |

### Pitchforks (TV lists these under Trend tools ▸ Pitchforks; library groups them under Gann & Fib)

| Tool | Library id | Override ns | Clicks | Stored pts |
|---|---|---|---|---|
| Pitchfork | `pitchfork` | `linetoolpitchfork` | 3 | 3 |
| Schiff pitchfork | `schiff_pitchfork` | `linetoolschiffpitchfork` | 3 | 3 |
| Modified Schiff pitchfork | `schiff_pitchfork_modified` | `linetoolschiffpitchfork2` | 3 | 3 |
| Inside pitchfork | `inside_pitchfork` | `linetoolinsidepitchfork` | 3 | 3 |
| Pitchfan | `pitchfan` | `linetoolpitchfan` | 3 | 3 |

### Fibonacci

| Tool | Library id | Override ns | Clicks | Stored pts |
|---|---|---|---|---|
| Fib retracement | `fib_retracement` | `linetoolfibretracement` | 2 | 2 |
| Trend-based fib extension | `fib_trend_ext` | `linetooltrendbasedfibextension` | 3 | 3 |
| Fib channel | `fib_channel` | `linetoolfibchannel` | 3 | 3 |
| Fib time zone | `fib_timezone` | `linetoolfibtimezone` | 2 | 2 |
| Fib speed resistance fan | `fib_speed_resist_fan` | `linetoolfibspeedresistancefan` | 2 | 2 |
| Trend-based fib time | `fib_trend_time` | `linetooltrendbasedfibtime` | 3 | 3 |
| Fib circles | `fib_circles` | `linetoolfibcircles` | 2 | 2 |
| Fib spiral | `fib_spiral` | `linetoolfibspiral` | 2 | 2 |
| Fib speed resistance arcs | `fib_speed_resist_arcs` | `linetoolfibspeedresistancearcs` | 2 | 2 |
| Fib wedge | `fib_wedge` | `linetoolfibwedge` | 3 | 3 |

### Gann

| Tool | Library id | Override ns | Clicks | Stored pts |
|---|---|---|---|---|
| Gann box | `gannbox` | `linetoolgannsquare` | 2 | 2 |
| Gann square fixed | `gannbox_fixed` | `linetoolgannfixed` | 2 | 2 |
| Gann square | `gannbox_square` | `linetoolganncomplex` | 2 | 2 |
| Gann fan | `gannbox_fan` | `linetoolgannfan` | 2 | 2 |

(Note the naming inversion: TV "Gann box" is `linetoolgannsquare`; TV "Gann square" is `linetoolganncomplex`.)

### Patterns

| Tool | Library id | Override ns | Clicks / pts | Labels |
|---|---|---|---|---|
| XABCD pattern | `xabcd_pattern` | `linetool5pointspattern` | 5 | X A B C D |
| Cypher pattern | `cypher_pattern` | `linetoolcypherpattern` | 5 | X A B C D |
| ABCD pattern | `abcd_pattern` | `linetoolabcd` | 4 | A B C D |
| Triangle pattern | `triangle_pattern` | `linetooltrianglepattern` | 4 | A B C D |
| Three drives pattern | `3divers_pattern` | `linetoolthreedrivers` | 7 (doc: Price 1–7) | 0? 1 A 2 C 3 (see §H) |
| Head and shoulders | `head_and_shoulders` | `linetoolheadandshoulders` | 7 (obs) | LS H RS + neckline |
| Elliott impulse wave (12345) | `elliott_impulse_wave` | `linetoolelliottimpulse` | 6 | 0 1 2 3 4 5 |
| Elliott correction wave (ABC) | `elliott_correction` | `linetoolelliottcorrection` | 4 | 0 A B C |
| Elliott triangle wave (ABCDE) | `elliott_triangle_wave` | `linetoolelliotttriangle` | 6 | 0 A B C D E |
| Elliott double combo (WXY) | `elliott_double_combo` | `linetoolelliottdoublecombo` | 4 | 0 W X Y |
| Elliott triple combo (WXYXZ) | `elliott_triple_combo` | `linetoolelliotttriplecombo` | 6 | 0 W X Y X Z |
| Cyclic lines | `cyclic_lines` | `linetoolcirclelines` | 2 | — |
| Time cycles | `time_cycles` | `linetooltimecycles` | 2 | — |
| Sine line | `sine_line` | `linetoolsineline` | 2 | — |

### Forecasting & measurement

| Tool | Library id | Override ns | Clicks | Stored pts |
|---|---|---|---|---|
| Long position | `long_position` | `linetoolriskrewardlong` | 1 | 1 + profit/stop levels + width |
| Short position | `short_position` | `linetoolriskrewardshort` | 1 | same |
| Forecast (Position forecast) | `forecast` | `linetoolprediction` | 2 | 2 |
| Bars pattern | `bars_pattern` | `linetoolbarspattern` | 2 (select) + drag | 2 + copied bars |
| Ghost feed | `ghost_feed` | `linetoolghostfeed` | 1 + n | n |
| Projection (TV "Sector") | `projection` | `linetoolprojection` | 3 | 3 |
| Price range | `price_range` | `linetoolpricerange` | 2 | 2 |
| Date range (Bars range) | `date_range` | `linetooldaterange` | 2 | 2 |
| Date and price range | `date_and_price_range` | `linetooldateandpricerange` | 2 | 2 |
| Anchored VWAP | `anchored_vwap` | `linetoolanchoredvwap` | 1 | 1 |
| Fixed range volume profile | `fixed_range_volume_profile` | study `FixedRangeIndicatorOverrides` | 2 | 2 |
| Anchored volume profile | — (no shape id; `linetoolanchoredvp`) | `AnchoredvpLineToolOverrides` | 1 | 1 |

### Geometric shapes

| Tool | Library id | Override ns | Clicks | Stored pts |
|---|---|---|---|---|
| Brush | `brush` | `linetoolbrush` | drag | n |
| Highlighter | `highlighter` | `linetoolhighlighter` | drag | n |
| Arrow marker | `arrow_marker` | `linetoolarrowmarker` | 2 | 2 |
| Arrow mark up / down / left / right | `arrow_up` `arrow_down` `arrow_left` `arrow_right` | `linetoolarrowmark{up,down,left,right}` | 1 | 1 |
| Rectangle | `rectangle` | `linetoolrectangle` | 2 | 2 |
| Rotated rectangle | `rotated_rectangle` | `linetoolrotatedrectangle` | 3 | 3 |
| Ellipse | `ellipse` | `linetoolellipse` | 3 (obs) | 3 |
| Circle | `circle` | `linetoolcircle` | 2 | 2 |
| Polyline | `polyline` | `linetoolpolyline` | n | n |
| Path | `path` | `linetoolpath` | n | n |
| Triangle | `triangle` | `linetooltriangle` | 3 | 3 |
| Arc | `arc` | `linetoolarc` | 3 | 3 |
| Curve | `curve` | `linetoolbezierquadro` | 3 | 3 |
| Double curve | `double_curve` | `linetoolbeziercubic` | 4 | 4 |

### Annotation tools

| Tool | Library id | Override ns | Clicks | Stored |
|---|---|---|---|---|
| Text | `text` | `linetooltext` | 1 | 1 |
| Anchored text | `anchored_text` | `linetooltextabsolute` | 1 | `{x%,y%}` |
| Note | `note` / `text_note` | `linetoolnote` | 1 | 1 |
| Anchored note | `anchored_note` | `linetoolnoteabsolute` | 1 | `{x%,y%}` |
| Pin | — (web only) | — | 1 | 1 |
| Callout | `callout` | `linetoolcallout` | 2 | 2 |
| Comment | `comment` (new) / `balloon` (old bubble) | `linetoolcomment` / `linetoolballoon` | 1 | 1 |
| Price label | `price_label` | `linetoolpricelabel` | 1 | 1 |
| Price note | `price_note` | (no interface page) | 2 | 2 |
| Signpost | `signpost` | `linetoolsignpost` | 1 + vertical drag | 1 + offset |
| Flag mark | `flag` | `linetoolflagmark` | 1 | 1 |
| Table | `table` | (no interface page) | 1 + resize | anchor/size |
| Image | — (web; `ImageLineToolOverrides` exists) | `linetoolimage` | 1 | 1 |
| X post / Idea | — (web only) | — | link dialog | time of post |
| Icons / Emojis / Stickers | `icon` `emoji` `sticker` | `linetoolicon` `linetoolemoji` `linetoolsticker` | 1 | 1 |

### Utilities

| Tool | Library id / action |
|---|---|
| Measure | `measure` (also `Shift`+click) |
| Zoom in | `zoom` |
| Magnet (weak / strong) | toolbar toggle; `Ctrl` hold |
| Stay in drawing mode | action `stayInDrawingModeAction` |
| Lock all drawings | toolbar toggle (`lineToggleLock` per drawing) |
| Hide all drawings | `Ctrl+Alt+H` (`lineHide` per drawing) |
| Remove drawings / indicators / all | action `paneRemoveAllStudiesDrawingTools` |
| Show object tree | action `paneObjectTree` |
| Sync drawings (in layout / globally) | web only |

---

## 2. Drawing engine — general behaviours

### 2.1 Creating a drawing

1. User selects a tool (toolbar click, favourites bar, or hotkey — §2.12). The cursor changes to a crosshair with the tool's glyph; the toolbar button shows as active (obs).
2. Each **click** places the next anchor point. While the pointer moves between clicks the drawing is rendered as a live preview using the current pointer position as the next point ("rubber-band"). For freehand tools (Brush, Highlighter) the stroke is created by **press-drag-release** (doc). Some 2-point tools also accept **press-drag-release** as an alternative to click-click (obs: TV accepts both; if the mouse moves a few px while pressed the release completes the drawing).
3. Multi-point tools of fixed arity finish automatically after the last point. Open-ended tools (Polyline, Path, Ghost feed, Brush) finish on double-click, `Esc`, right-click, or — for Polyline — clicking the first point again (doc).
4. `Esc` while a drawing is in progress cancels it (obs). After completion the tool deactivates and the cursor returns to the default cursor unless **Stay in drawing mode** is on (doc: "Keep drawing — add multiple objects consecutively").
5. The finished drawing becomes **selected** and the floating toolbar appears (§2.7).
6. Points placed while **Magnet** is on snap per §2.5. `Shift` held during placement constrains angle per tool (§2.6).
7. Creation is pushed on the undo stack (`Ctrl+Z` / `Ctrl+Y`) (doc).
8. Library events: `drawing` (added) and `drawing_event(id, type)` where `type ∈ "click" | "move" | "remove" | "hide" | "show" | "create" | "properties_changed" | "points_changed"` (doc). `points_changed` fires for any point move; `move` fires when the whole drawing is moved (`points_changed` always accompanies `move`, not vice-versa). `properties_changed` may fire before `create` and is **not debounced** (fires for every slider tick).

### 2.2 Anchoring in time and price

- Points are stored as (time, price) and rendered by `x = timeScale.timeToCoordinate(time)`, `y = priceScale.priceToCoordinate(price)`. Because the x-axis is **bar-indexed** (equal spacing per bar, not linear time), time→x goes through **bar index**: find the bar with that time; if the time falls between two bars use a **fractional index** by linear interpolation of time between the neighbours (obs: this is why a line drawn on 1-minute stays anchored to the same instants when viewed on 1-hour, where those instants fall inside a bar). For API-created points the library states it "adjusts the time value to the nearest appropriate point" (e.g. 09:30 → 09:00 on 1h) and keeps it there even after switching to 30m (doc) — for the clone: snap on creation to the resolution's bar time, keep exact time thereafter.
- **Right margin / future**: a point beyond the last bar has no bar. TV stores it as the last bar's time plus a **bar offset** in the current interval (obs: the serialised point carries `offset` and `interval`). When the resolution changes, the offset is rescaled by the ratio of intervals so the point keeps its approximate wall-clock position; when new bars arrive the offset is decremented (the point stays at its wall time; obs). Vertical tools with future time follow the same rule.
- Points on **indicator panes**: a drawing belongs to a pane; with `ownerStudyId` it follows the study when the study is moved to another pane and is deleted with the study (doc).
- Price on **log scale**: price→y uses the pane's current scale; fib tools have a "Fib levels based on log scale" option that changes the *level math*, not the projection (§C.1).
- Price on **percent / indexed scale**: drawings keep raw prices (obs).
- A drawing is stored **per symbol** (and per layout/chart unless synced — §2.11). Switching symbol hides drawings of other symbols (obs). Drawings on a symbol not currently open cannot be restored by undo if deleted (doc).

### 2.3 Hit-testing, hover, selection

- Hit-test order: top-most z-order first (§2.9). A drawing is hit when the pointer is within a tolerance of its stroke, inside its filled body (for filled shapes/backgrounds), on a label, or on an anchor.
- Tolerance (obs/?): ≈ **3 px** around a 1-px line for the stroke ("line" tolerance), ≈ **6 px** radius for anchor handles, a few px for text labels. The clone should use `max(3, lineWidth/2 + 2)` for strokes.
- **Hover** (obs): when the pointer is over an unselected drawing, its anchor points are drawn as small hollow circles and the cursor becomes a pointer/grab; the stroke is not restyled.
- **Selection** (obs): click selects (and deselects others unless `Ctrl`/`⌘` held). A selected drawing shows **filled circular anchor handles** at every point (≈ 8–9 px diameter, fill = drawing's main colour, 1-px stroke in the chart background colour; some tools show extra handles, e.g. Trend line "middle point", Long position profit/stop/width handles, Table corner handles). Selected drawings also show their price/time axis labels if that option is on, and their stats labels if "Always show stats" is off (§B).
- Multi-select: `Ctrl`/`⌘`+click adds/removes; `Ctrl`/`⌘`+drag on empty chart draws a rubber-band rectangle selecting everything inside (doc: 43000682552). The library exposes `ISelectionApi` (`add`, `remove`, `set`, `clear`, `contains`, `isEmpty`, `allItems`, `onChanged`).
- Clicking on empty chart or pressing `Esc` clears the selection (obs).
- `disableSelection` (API) makes a drawing non-selectable; `lock` disables moving/deleting in the UI (doc).

### 2.4 Editing with the mouse

- Drag an **anchor handle** → moves that point only (rubber-band re-render). Magnet applies (§2.5). `Shift` constrains angle for angle-snapping tools (§2.6).
- Drag the **body** (stroke / fill / label) → moves the whole drawing: all points translated by the same Δtime (in bars) and Δprice (obs). `Shift` while dragging the body constrains to strictly horizontal or vertical movement (doc: 43000538248).
- `Ctrl`/`⌘`+drag body → **clone** and move the clone (doc: 43000537251; works for multi-selection).
- Double-click a drawing → opens its **Settings** dialog (doc, many articles: "double-click the drawing or the Settings button of the floating panel").
- Right-click → context menu (§2.8).
- Text tools: single click into the text field of a selected text-bearing drawing edits the text inline (doc: Trend line, Rectangle, Text, Note, Callout, Comment, Horizontal line, Fib retracement level texts). `Enter` / click outside commits; `Shift+Enter` newline (obs).
- Locked drawings (`lock`, "Lock all drawings") ignore drags but can still be selected/inspected (obs).

### 2.5 Magnet mode

(doc: 43000472715, 43000722509, Supercharts guide)

- Toolbar magnet button with two modes: **Weak magnet** — "pulls the drawing points to chart values (bars) when you are drawing near them"; **Strong magnet** — "pulls the drawing points to chart values (bars), regardless of the distance between the points and chart values". Off = free placement.
- Snap targets are the **open, high, low, close** of the bar under the pointer (doc: "snaps every line you draw to the nearest OHLC price point"). Not indicator values.
- Weak-magnet threshold (obs/?): a few pixels (≈ 5–10 px vertical distance to the nearest OHLC value). Strong: always snap to the nearest of O/H/L/C of the hovered bar.
- Magnet applies during **creation** and while **dragging a single point**; whole-drawing moves are not snapped (obs).
- `Ctrl`/`⌘` held while placing or moving a point **temporarily inverts** the magnet state (doc: "Temporary turn on/off magnet mode — Ctrl + Move a point").
- Library: action ids `magnet` (weak/strong toggles available in the toolbar; `getCheckableActionState`).

### 2.6 Shift-constraints

(doc: Shortcuts page)

- Trend line / channel + `Shift` → "Draw 45 degrees angle or horizontal": the second point is snapped so the line is at 0°, 45° or 90° in **screen space** (multiples of 45° measured in pixels, not price units). Applies to tools with `snapTo45Degrees` (old): Trend line, Info line, Trend angle, Rectangle, Rotated rectangle, Fib circles, Fib speed resistance fan, Icon.
- Rectangle + `Shift` → square (screen-space equal sides). Ellipse + `Shift` → circle. Fib circles + `Shift` → "45-degree angle and perfectly round circles" (doc).
- Gann box (fixed) + `Shift` → "Enable Gann box fixed increments" (doc) — the second point moves in fixed price/bar increments so the box keeps a square price/bar ratio. Gann square: `Shift`+click anchor "preserves the Price/Bar ratio" (doc).
- Dragging a whole drawing + `Shift` → axis-locked move (§2.4).

### 2.7 Floating toolbar (selection toolbar)

Appears near the top of the chart when one or more drawings are selected (obs; doc mentions its contents piecemeal). Left-to-right (obs):

1. **Template** ▾ — apply a saved template to the selected drawing(s) of the same type; "Save as…", "Apply defaults" (doc: 43000677801, Trading Platform only in the library, `drawing_templates` featureset).
2. **Colour** — colour + opacity picker for the main stroke (for filled shapes a second swatch for fill/background; for text tools a text-colour swatch) (doc).
3. **Line width** (1/2/3/4) (doc).
4. **Line style** (solid/dashed/dotted) (doc).
5. Tool-specific quick controls: text font size / bold / italic / align (text tools); "levels" quick toggles for fib (obs); "Anchor to screen" (Table); add row/column (Table) (doc).
6. **Settings** ⚙ — opens the properties dialog (doc).
7. **Alert** 🕒 — create an alert on the drawing (Trend line, Ray, Extended, Horizontal line/ray, Vertical line, Parallel channel, Long/Short position…) (doc).
8. **Lock** 🔒 toggle (doc: "lock and remove the drawing").
9. **Hide** 👁 (obs; hidden drawings are only restorable from the Object tree — doc).
10. **Remove** 🗑 (doc).
11. **More** ⋯ — Visual order (Bring to front / Send to back / Bring forward / Send backward), Clone, Copy, Sync (in layout / globally), Intervals visibility presets, Add to favourites, "Show in object tree" (doc: 43000686263 says the three-dots icon holds "Intervals visibility"; 43000474299 says right-click ▸ Visual order).

When multiple drawings of **different** types are selected the toolbar shows only the common controls (colour/width/style/lock/hide/remove/settings) (obs).

### 2.8 Context menu (right-click on a drawing) (obs unless noted)

`Clone` · `Copy` (Ctrl+C) · `Paste` (Ctrl+V, on empty chart) · `Add alert on <tool>` (doc) · `Lock` · `Hide` · `Intervals visibility ▸` (Current interval only / Current and above / Current and below / All intervals — presets that write the Visibility tab, doc 43000686263) · `Visual order ▸` (Bring to front, Send to back, Bring forward, Send backward — doc 43000474299) · `Sync in layout` / `Sync globally` (doc 43000629998) · `Template ▸` · `Settings…` · `Remove`.

Right-click on **empty chart**: … `Object tree`, `Remove drawings` (doc), `Hide drawings` (obs), `Paste`.

### 2.9 Z-order and the Object tree

- New drawings go on top of all existing chart objects unless `zOrder: 'bottom'` is passed (doc). Drawings render above the series and above indicators by default; the Object tree lets the user reorder drawings relative to indicators and the series ("Visual order", doc 43000474299).
- Object tree (right toolbar button "Object tree and data window", action `paneObjectTree`) lists panes ▸ series/indicators/drawings top-down in z-order; drag to reorder; eye icon = show/hide; padlock = lock; double-click/rename (obs); multi-select with `Ctrl`/`⌘` then "Settings" applies to all (doc 43000660419); groups: "Create group from selection", group visibility/lock/rename/z-order (doc, `IShapesGroupControllerApi`: `createGroupFromSelection`, `addShapeToGroup`, `excludeShapeFromGroup`, `removeGroup`, `groups`, `shapesInGroup`, `getGroupName/setGroupName`, `groupVisibility/setGroupVisibility`, `groupLock/setGroupLock`, `bringToFront/sendToBack/bringForward/sendBackward/insertAfter/insertBefore`, `availableZOrderOperations`, `canBeGroupped`). Group rules (doc): a drawing belongs to at most one group; only same-pane drawings; empty groups auto-removed; group members have **sequential z-indexes** (nothing can sit between them); groups are bound to symbols.
- `showInObjectsTree:false` hides a drawing from the tree (doc).

### 2.10 Lock / Hide / Remove

- **Lock all drawings** (toolbar): "prevents accidental movement of drawings" (doc). Per-drawing `lineToggleLock` action.
- **Hide** options (toolbar eye menu): Hide drawings / Hide indicators / Hide positions & orders / Hide all (doc). Shortcut `Ctrl+Alt+H` = Hide all drawings (doc). Per-drawing `lineHide` action. Hidden drawings are restored from the Object tree (doc 43000484389).
- **Remove** options (toolbar bin menu): Remove drawings / Remove indicators / Remove all (doc). `Delete`/`Backspace` removes the selection (obs). API: `removeEntity(id, {disableUndo})`, `removeAllShapes()`.
- Warning surfaced by TV (doc 43000692404): deleting drawings on a symbol that is not open cannot be undone; applying an indicator template removes drawings that live on indicator panes.

### 2.11 Sync drawings across charts/layouts (web only; mention only)

Three modes (doc 43000629998): **Off** — drawing exists only on that chart of that layout; **Sync in layout** — same symbol's drawings shown on all charts of the current layout; **Sync globally** — shown on every chart & layout (real-time across tabs/devices only with layout autosave). Switching a drawing's mode removes it from the other charts/layouts (doc).

### 2.12 Keyboard shortcuts

From the Charting Library shortcut page (doc) — tradingview.com adds a few more (marked web):

| Action | Shortcut |
|---|---|
| Draw Trend line | `Alt+T` |
| Draw Horizontal line | `Alt+H` |
| Draw Vertical line | `Alt+V` |
| Draw Cross line | `Alt+C` |
| Draw Fib retracement | `Alt+F` |
| Draw Rectangle | `Alt+Shift+R` |
| Square / Circle / 45° | `Shift` while drawing Rectangle / Ellipse / Trend line & channels |
| Gann box fixed increments | hold `Shift` |
| Measure | hold `Shift` + click (+drag) |
| Copy / Paste drawing | `Ctrl+C` / `Ctrl+V` (paste lands at the same coordinates, also across tabs — web) |
| Clone | `Ctrl`+drag |
| Multi-select | `Ctrl`+click; `Ctrl`+drag rubber band (web) |
| Move drawing axis-locked | drag + `Shift` |
| Nudge selected drawing | `←` `→` (1 bar), `↑` `↓` (1 min-tick) |
| Temporarily invert magnet | hold `Ctrl` while moving a point |
| Hide all drawings | `Ctrl+Alt+H` |
| Partially erase (Brush/Highlighter) | Eraser + `Ctrl` |
| Delete selection | `Delete` / `Backspace` (obs) |
| Cancel in-progress drawing / deselect | `Esc` (obs) |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` |
| Favourites bar | (web) favourites toolbar is draggable by its 6-dot grip; no number hotkeys documented |
| macOS | `⌘`/`⌥`/`⇧` replace `Ctrl`/`Alt`/`Shift` |

Not confirmed: `Alt+I` = invert scale (not a drawing), `Alt+J`, `Shift+T` (?).

### 2.13 Settings dialog structure

Every drawing's dialog has a **Template** dropdown in the header (Apply defaults / Save as default / Save as… / saved templates) and tabs (doc, per-tool articles):

- **Style** — colours, widths, styles, fills, levels, stats toggles.
- **Text** — for tools that carry text: text box, font size, bold, italic, colour, alignment (horizontal: left/center/right; vertical: top/middle/bottom), background, border, text wrap.
- **Inputs** — for study-backed tools (Regression trend, Anchored VWAP, Volume profiles, Long/Short position).
- **Coordinates** — one row per point: `Price` (number) and `Bar` (bar index, integer; positive index of the bar, future points appear as index beyond last bar) (doc: "Price 1 … using a bar number and price"). Some tools expose extra fields: Trend angle "Angle", Parallel channel "Price offset", Signpost "vertical position %".
- **Visibility** — interval buckets (§2.14).
- Multi-selection settings add a **Displacement** tab: apply `+`, `-`, `*`, `/` to price coordinates and `+`/`-` to bar indices of all points of all selected objects (doc 43000682552).
- OK / Cancel; changes preview live and are undoable.

### 2.14 Visibility per interval

The Visibility tab lists interval **buckets**; each has a checkbox and a from/to range (obs; field names as in TV's saved-layout JSON):

| Bucket | Range | Default |
|---|---|---|
| Ticks | — | on |
| Seconds | 1 – 59 | on, 1–59 |
| Minutes | 1 – 59 | on, 1–59 |
| Hours | 1 – 24 | on, 1–24 |
| Days | 1 – 366 | on, 1–366 |
| Weeks | 1 – 52 | on, 1–52 |
| Months | 1 – 12 | on, 1–12 |
| Ranges | — | on |

Serialised as `intervalsVisibilities: { ticks, seconds, secondsFrom, secondsTo, minutes, minutesFrom, minutesTo, hours, hoursFrom, hoursTo, days, daysFrom, daysTo, weeks, weeksFrom, weeksTo, months, monthsFrom, monthsTo, ranges }` (obs). Context-menu presets (doc): current interval only / current and above / current and below / all. A drawing outside its visible intervals is not rendered and not hit-testable but stays in the Object tree (obs).

### 2.15 Templates

- Per tool type. "Save as default" makes the current style the default for new drawings of that type; "Apply defaults" resets (obs; doc calls it "save current style as a template or reset to default settings").
- Apply to several same-type selected tools at once via floating toolbar or context menu (doc 43000677801).
- Library: templates only in Trading Platform; storage via REST `charts_storage` or custom `save_load_adapter` (doc).

### 2.16 Favourites

Star icon next to a tool in its group menu adds it to the **Favourite drawings toolbar** (floating, draggable) (doc). Library: `favorites.drawingTools` widget option; disable with `items_favoriting` featureset.

### 2.17 Alerts on drawings

Alert icon in floating toolbar / context menu for line-type drawings (trend line, ray, extended, horizontal line/ray, vertical line, parallel channel, long/short position (single condition monitors entry/TP/SL)) (doc). Condition list: Crossing / Crossing up / Crossing down / Entering channel / Exiting channel / Inside / Outside / Moving up / Moving down (obs).

### 2.18 Persistence model (for the clone)

Suggested shape per drawing (mirrors TV's layout JSON, obs):

```
{
  id, type: 'LineToolTrendLine', symbol, ownerSource: 'series'|studyId,
  points: [{ time_t, price, offset?, interval? }, ...],
  state: { ...style/text/coords props..., intervalsVisibilities, frozen(locked), visible, title, zorder },
  version
}
```

### 2.19 Rendering conventions (obs)

- Lines are drawn on the device-pixel grid, crisp for width 1 (offset 0.5 px).
- Dashed pattern ≈ `[6,3]`·width? (?) and dotted ≈ `[1,3]`·width (?). Verify.
- Backgrounds use `backgroundColor` with `transparency` (percent) — e.g. `rgba(41,98,255,0.2)` at transparency 80.
- Axis labels: a selected/hovered drawing with `showPrice`/`showTime`/`showPriceLabels` paints small rounded labels on the price/time axes in the drawing's colour with white text.
- Stats labels are rounded rectangles (radius ≈ 4 px) with the tool's `labelBackgroundColor` (`#585858`) or the drawing colour and white text, font 12 px; multi-line for Info line / ranges.
- Label text for prices uses the symbol's price formatter; percentages 2 decimals; bar counts integers; durations as `Nd Nh Nm` (obs).

---

## A. Cursors group

| Cursor | Behaviour |
|---|---|
| **Cross** (`cursor`, default) | Full-height/width crosshair lines following the pointer; price label on the price axis and date/time label on the time axis; OHLC/indicator values in the legend update to the hovered bar. Crosshair snaps to bar centres horizontally (obs). |
| **Dot** (`dot`) | Same crosshair behaviour, pointer drawn as a small dot (doc: "Similar to the cross"). Crosshair lines are supported only by Cross and Dot (doc). |
| **Arrow** (`arrow_cursor`) | Classic system arrow, **no crosshair** (doc). Axis labels still follow the pointer (obs). |
| **Eraser** (`eraser`) | Click a drawing to delete it (doc: "for fixing unwanted drawings"). `Ctrl` + eraser partially erases (removes stroke segments under the pointer on Brush/Highlighter) (doc: "Partially erase drawing — Eraser + Ctrl"). |
| **Demonstration** (web) | Hold `Alt`/`⌥` and click (dot) or drag (stroke) to draw temporary highlighter-like marks that "gradually disappear after a few seconds" (doc 43000747626). Not persisted. |
| **Magic** (web) | Listed in TV's cursor list (doc 43000703396); behaviour not documented in fetched sources (?). |

Crosshair style is a chart setting (colour, width, style) not a drawing property.

---

## B. Trend line tools

Shared **stats block** (trend-line family: Trend line, Ray, Extended line, Arrow, Info line, Trend angle). When enabled, a label is drawn next to the line (position per `statsPosition`) listing one line per enabled item (obs order):

1. **Price range** (`showPriceRange`) — absolute price change `p2 − p1` formatted with symbol precision.
2. **Percent change** (`showPercentPriceRange`) — `(p2 − p1) / p1 × 100`, 2 decimals, with sign.
3. **Change in pips** (`showPipsPriceRange`) — `(p2 − p1) / pipSize` (pip = 10 × min tick for FX with ≥4 decimals; otherwise min tick) (obs).
4. **Bars range** (`showBarsRange`) — `index2 − index1` (signed integer, "N bars").
5. **Date/time range** (`showDateTimeRange`) — elapsed calendar time between the two points, e.g. `3d 4h` (obs).
6. **Distance** (`showDistance`) — pixel-free "distance" TV shows as a combined `Δprice (Δ%), N bars, elapsed` ... (obs: rendered as the Euclidean length is **not** used; TV shows `distance` as the price-and-bars pair). (?)
7. **Angle** (`showAngle`) — inclination in degrees relative to the horizontal axis, computed in **screen space** (`atan2(y1 − y2, x2 − x1)` in pixels), so it changes when the chart is zoomed (doc: "displays the inclination angle of the trendline (in degrees)"; obs for screen-space).

"Always show stats" (`alwaysShowStats`) — when off, stats show only while the drawing is selected (doc).
"Stats position" (`statsPosition`) — Left / Center / Right / Auto (doc).
"Middle point" (`showMiddlePoint`) — draws an extra handle at the segment midpoint; dragging it moves the whole line (obs).
"Price labels" (`showPriceLabels`) — shows the two endpoint prices on the price axis (doc).
"Extend" — dropdown None / Left / Right / Both ⇒ `extendLeft` / `extendRight` (doc).
Line ends — dropdowns for left and right end: Normal / Arrow ⇒ `leftEnd` / `rightEnd` (doc).

Shared **Text tab** (trend-line family, doc): checkbox to show text; text box; font size; bold; italic; text colour; "Text alignment" along the line (horizontal: left / center / right ⇒ `horzLabelsAlign`; vertical: top / middle / bottom ⇒ `vertLabelsAlign`). Text is editable inline on the chart.

### B.1 Trend line — `trend_line` / `linetooltrendline` (doc 43000518095)

- Points: 2 clicks (or press-drag-release). Live preview between clicks. `Shift` → 0°/45°/90° snap. Hotkey `Alt+T`.
- Geometry: segment p1→p2; `extendLeft`/`extendRight` extend to the pane edges as an infinite line through both points. Line ends drawn as arrow heads when `leftEnd`/`rightEnd = 1` (arrow head ≈ 3×lineWidth+? px; obs).
- Handles: p1, p2, optional middle point. Body drag moves both. Alerts supported.
- Style defaults (lib):

| Property | Default |
|---|---|
| `linecolor` | `#2962FF` |
| `linewidth` | `2` |
| `linestyle` | `0` (solid) |
| `extendLeft` / `extendRight` | `false` / `false` |
| `leftEnd` / `rightEnd` | `0` / `0` |
| `showMiddlePoint` | `false` |
| `showPriceLabels` | `false` |
| `showPriceRange` / `showPercentPriceRange` / `showPipsPriceRange` | `false` |
| `showBarsRange` / `showDateTimeRange` / `showDistance` / `showAngle` | `false` |
| `alwaysShowStats` | `false` |
| `statsPosition` | `2` |
| `textcolor` | `#2962FF` |
| `fontsize` | `14` |
| `bold` / `italic` | `false` |
| `horzLabelsAlign` / `vertLabelsAlign` | `center` / `bottom` |
| (old) `font` `Verdana`, `snapTo45Degrees` `true`, `linecolor` `rgba(21,153,128,1)`, `linewidth` `1`, `textcolor` `rgba(21,119,96,1)`, `fontsize` `12` | legacy defaults |

- Coordinates tab: Price 1 / Bar 1, Price 2 / Bar 2. Visibility tab: standard.

### B.2 Ray — `ray` / `linetoolray` (doc 43000518113)

- Points: 2. "The first point defines the origin, the second the direction"; extends infinitely past p2 (`extendRight: true` default; `extendLeft:false`). Choosing "Extend left" too turns it into an extended line (doc: "For rays extending in multiple directions, use the standard ray tool… ").
- Same style/text/stats set as Trend line. Defaults identical except `extendRight = true` (lib). Middle point = midpoint of p1–p2 (doc: "midpoint between the ray's initial points").

### B.3 Info line — `info_line` / `linetoolinfoline` (doc 43000791601)

- Points: 2 (click, drag/move, click).
- Same geometry as Trend line; differs by default stats: **all stats on and always shown** (lib): `alwaysShowStats true`, `showPriceRange true`, `showPercentPriceRange true`, `showPipsPriceRange true`, `showBarsRange true`, `showDateTimeRange true`, `showDistance true`, `showAngle true`, `statsPosition 1` (center), `showMiddlePoint false`, `showPriceLabels false`, `linecolor #2962FF`, `linewidth 2`, `fontsize 14`, `textcolor #2962FF`.
- Displayed window (doc): absolute price change, percentage change, distance in bars, time elapsed, line angle (plus pips when enabled).

### B.4 Extended line — `extended` / `linetoolextended` (doc 43000518131)

- Points: 2. Infinite line through both points in both directions (`extendLeft = extendRight = true` default). Line ends only visible when extension is turned off (doc). Otherwise identical to Trend line (defaults lib: same as trend line with both extends true).

### B.5 Trend angle — `trend_angle` / `linetooltrendangle` (doc 43000791602)

- Points: 2 clicks. Stored as **point 1 + angle** (Coordinates tab: "Price 1 / Bar 1" and "Angle" in degrees relative to the horizontal) — the second handle is derived; dragging it changes angle **and length** (obs: TV also keeps a length so the segment end is draggable).
- Geometry: segment from p1 at `angle` (screen-space degrees, counter-clockwise positive = upward). Label shows `N°` near p2 with an arc glyph (obs). Extend left/right/both/none (doc).
- Style (lib): `linecolor #2962FF`, `linewidth 2`, `linestyle 0`, `extendLeft/Right false`, `showMiddlePoint false`, `showPriceLabels false`, `showPriceRange/showPercentPriceRange/showPipsPriceRange/showBarsRange false`, `alwaysShowStats false`, `statsPosition 2`, `fontsize 12`, `bold false` (old: `bold true`), `italic false`. Text-tab: colour/size/bold/italic.
- Note: no date/time-range / distance / angle checkboxes (angle is always shown as the tool's purpose) (doc lists stats: price range, percent change, pips, bars range).

### B.6 Horizontal line — `horizontal_line` / `linetoolhorzline` (doc 43000518124)

- Points: 1 click (hotkey `Alt+H` places at the pointer's price). Live preview follows pointer vertically before the click.
- Geometry: infinite horizontal line across the pane at `price`. Price label on the axis (`showPrice`, default `true`).
- Handles: one handle at the click x (obs: TV keeps the x of the click as the anchor's time; dragging anywhere on the line moves it vertically; the handle itself can also be dragged horizontally without effect on rendering).
- Text tab (doc): show text checkbox, colour, size, bold, italic, "Text alignment" dropdowns — horizontal (left/center/right, `horzLabelsAlign` default `center`) and vertical (top/middle/bottom, `vertLabelsAlign` default `middle`; old default `top`).
- Style (lib): `linecolor #2962FF`, `linewidth 2`, `linestyle 0`, `showPrice true`, `textcolor #2962FF`, `fontsize 12`, `bold false`, `italic false`. (old: `linecolor rgba(128,204,219,1)`, `linewidth 1`, `showLabel false`, `text ''`.)
- Coordinates: Price only. Alerts supported.

### B.7 Horizontal ray — `horizontal_ray` / `linetoolhorzray` (doc 43000518121)

- Points: 1. Horizontal line from the anchor **rightwards** to infinity. Coordinates: Price + Bar (the origin) (doc).
- Style/text identical to Horizontal line; `vertLabelsAlign` default `top` (lib). Alerts supported.

### B.8 Vertical line — `vertical_line` / `linetoolvertline` (doc 43000518093)

- Points: 1 (hotkey `Alt+V`). Infinite vertical line at `time`. Coordinates: Bar only.
- Style (lib): `linecolor #2962FF`, `linewidth 2`, `linestyle 0`, `showTime true` (time label on the axis), `extendLine true` — "Extend: allows the vertical line to extend through indicator panes below the main chart" (doc). Text tab: colour, size (`fontsize 14`), bold, italic, "Text alignment" (`horzLabelsAlign center`, `vertLabelsAlign middle`), "Text orientation" (`textOrientation 'vertical'` default; or horizontal) (doc). Alerts supported.

### B.9 Cross line — `cross_line` / `linetoolcrossline` (doc 43000477747)

- Points: 1 (hotkey `Alt+C`). Draws an infinite horizontal + vertical line through the point with a reference dot at the crossing; price and date labels on both axes (`showPrice true`, `showTime true`).
- Style (lib): `linecolor #2962FF`, `linewidth 2`, `linestyle 0`. Coordinates: Price + Bar. (old colour `rgba(6,160,227,1)`.)

### B.10 Arrow — `arrow` / `linetoolarrow` (doc 43000518134)

- Points: 2. A trend line whose right end is an arrow head by default (`rightEnd = 1`, `leftEnd = 0`). Everything else as Trend line (lib: `linecolor #2962FF`, `linewidth 2`, stats all off, `statsPosition 2`, `fontsize 14`). Listed by TV under Geometric shapes but implemented as a line tool.

### B.11 Parallel channel — `parallel_channel` / `linetoolparallelchannel` (doc 43000518117)

- Points: 3 clicks — p1, p2 define the base line; the third click sets the parallel line's offset (the pointer's vertical distance from the base line). Live preview: after the 2nd click the second line follows the pointer.
- Stored: p1, p2, p3 (p3 = one point on the second line; Coordinates tab shows `#1`, `#2` and a **"Price offset"** = price distance between level 1 and level 0 measured at the same time) (doc).
- Geometry: line A through p1–p2; line B = A translated by the price offset; optional **middle line** midway (`showMidline`, dashed by default). Extend left/right applies to both lines (checkboxes "Extend left line" / "Extend right line", doc). Background fill between the lines (`fillBackground`, `backgroundColor`, `transparency`).
- Handles: p1, p2 (base ends), p3 (second line; dragging it changes the offset), plus the second line's other end and midpoints (obs: TV shows 4 corner handles + centre handles; dragging a corner of line B moves both B endpoints). Body drag moves all.
- Style (lib):

| Property | Default |
|---|---|
| `linecolor` | `#2962FF` |
| `linewidth` | `2` |
| `linestyle` | `0` |
| `extendLeft` / `extendRight` | `false` |
| `fillBackground` | `true` |
| `backgroundColor` | `rgba(41, 98, 255, 0.2)` |
| `transparency` | `20` |
| `showMidline` | `true` (old: `false`) |
| `midlinecolor` / `midlinewidth` / `midlinestyle` | `#2962FF` / `1` / `2` (dashed) |
| `labelVisible` | `false` (text label) |
| `labelTextColor` / `labelFontSize` / `labelBold` / `labelItalic` | `#2962FF` / `14` / `false` / `false` |
| `labelHorzAlign` / `labelVertAlign` | `left` / `bottom` |

- Doc also mentions "Channel's levels … toggle visibility of additional levels and enter custom ratios" — the web UI shows the two channel lines plus the middle line; no further levels in the override set. Alerts supported (entering/exiting channel).

### B.12 Regression trend — `regression_trend` / `linetoolregressiontrend` (doc 43000518108)

- Points: 2 clicks selecting the bar range [p1.time, p2.time] (prices of the clicks are irrelevant; Coordinates tab shows only "Point 1 Bar" and "Point 2 Bar" (doc)).
- Calculation (doc + standard): over the N bars in range, ordinary least-squares line of `source` (default `close`) vs bar index ⇒ **base line** ("Linear Regression Line or Mean"). `σ` = standard deviation of `(source − regression value)` over the range. **Upper line** = base + `upper deviation` × σ (default `2`); **Lower line** = base + `lower deviation` × σ (default `−2`). **Pearson's R** = |correlation coefficient| between index and source (doc: shown as an absolute value; direction read visually), displayed as text near the channel (obs: at the left/start of the base line).
- `extendLines` — extend all three lines indefinitely to the **right** (doc). Backgrounds: upper half fill ("Up" channel) and lower half fill ("Down" channel) each with border settings.
- Inputs (lib): `inputs.upper diviation 2`, `inputs.lower diviation -2`, `inputs.use upper diviation true`, `inputs.use lower diviation true`, `inputs.source close`, `inputs.first bar time 0`, `inputs.last bar time 0` (spelling "diviation" is TV's).
- Style (lib): `styles.baseLine.color rgba(242,54,69,0.3)`, `.linestyle 2` (dashed), `.linewidth 1`; `styles.upLine.color rgba(41,98,255,0.3)`, `.linestyle 0`, `.linewidth 2`; `styles.downLine` same as upLine; `styles.extendLines false`; `styles.showPearsons true`; `styles.transparency 70`; `linewidth 1`, `linestyle 0`, `precision default`.
- Doc Style labels: "Base" (colour/thickness/style + fill visibility), "Up", "Down" (each with border thickness/style + visibility checkbox), "Extend Lines", "Pearson's R".

### B.13 Flat top/bottom — `flat_bottom` / `linetoolflatbottom` (doc 43000791603)

- Points: 3 clicks — p1, p2 define the sloped line; p3 sets the price of the **horizontal** line. Preview: after 2nd click a horizontal line follows the pointer's price.
- Geometry: sloped segment p1→p2 and a horizontal segment at `p3.price` spanning the same time range [p1.time, p2.time]; filled between (obs; TV renders 4 handles: two on the sloped line, two on the flat line — flat-line handles move vertically together and horizontally with the sloped line's ends (?)). Extend none/left/right/both extends both lines.
- Style (lib): `linecolor #FF9800`, `linewidth 2`, `linestyle 0`, `leftEnd/rightEnd 0`, `extendLeft/Right false`, `fillBackground true`, `backgroundColor rgba(255,152,0,0.2)`, `transparency 20`, `showPrices false` ("Prices" label toggle), `showPriceRange/showBarsRange/showDateTimeRange false`, `textcolor #FF9800`, `fontsize 12`, `bold/italic false`, label: `labelVisible false`, `labelTextColor #FF9800`, `labelFontSize 14`, `labelHorzAlign left`, `labelVertAlign bottom`.

### B.14 Disjoint channel — `disjoint_angle` / `linetooldisjointangle` (doc 43000791604)

- Points: 3 clicks — p1, p2 define line 1; the 3rd click places line 2 (initially parallel, through p3). After creation TV exposes **four** handles: both ends of each line can be moved independently, so the two lines need not stay parallel ("two trendlines that do not necessarily share the same starting points") (obs; stored as 4 points — the library requires 4 points for `disjoint_angle` (?)).
- Geometry: two independent segments + fill of the quadrilateral between them; extend left/right/both/none applies to both lines.
- Style (lib): `linecolor #089981`, `linewidth 2`, `linestyle 0`, `fillBackground true`, `backgroundColor rgba(8,153,129,0.2)`, `transparency 20`, `showPrices false`, `showPriceRange/showBarsRange/showDateTimeRange false`, `textcolor #089981`, `fontsize 12`, label `labelVisible false`, `labelTextColor #089981`, `labelFontSize 14`, `labelHorzAlign left`, `labelVertAlign bottom`, `leftEnd/rightEnd 0`.

### B.15 Anchored VWAP — `anchored_vwap` / `linetoolanchoredvwap` (doc 43000669764, 43000502018)

- Points: 1 click = anchor bar. Handle: the anchor point (drag along time). Rendered from the anchor to the last bar and keeps updating with new bars.
- Calculation from the anchor bar `a` to bar `i`: `VWAP_i = Σ_{k=a..i}(src_k·vol_k) / Σ_{k=a..i} vol_k`, `src` default `hlc3` (options: open, high, low, close, hl2, hlc3, ohlc4) (doc). Bands: mode **Standard Deviation** — `σ_i = sqrt( Σ(src²·vol)/Σvol − VWAP_i² )` (volume-weighted stdev of the source since the anchor; doc: "Standard Deviations of all VWAP values since the last anchor"), band_k = VWAP ± mult_k·σ; mode **Percentage** — band_k = VWAP × (1 ± mult_k/100). Three band pairs with multipliers 1, 2, 3; only band 1 enabled by default (lib: `inputs.calculate_stDev true`, `_2 false`, `_3 false`).
- Inputs (lib): `inputs.source hlc3`, `inputs.Bands Calculation Mode 'Standard Deviation'`, `inputs.bands_multiplier 1`, `inputs.bands_multiplier_2 2`, `inputs.bands_multiplier_3 3`, `inputs.start_time 0`, `precision default`.
- Style (lib): `styles.VWAP.color #1E88E5`, `.linewidth 1`, `.linestyle 0`, `.plottype 0` (line); `UpperBand`/`LowerBand` `#4CAF50` w1; `UpperBand_2`/`LowerBand_2` `#808000` w1; `UpperBand_3`/`LowerBand_3` `#00897B` w1; `areaBackground.fillBackground true`, `.backgroundColor #4CAF50`, `.transparency 95` (`filledAreasStyle.Background_1` same).
- Listed by TV under Forecasting & measurement ▸ Volume-based; library lists it under Trend tools.

---

## C. Fibonacci tools

### C.0 Shared fib-level machinery

All price-level fib tools (Retracement, Trend-based extension, Channel) use the same 24-slot level table
`level1…level24 { coeff, color, visible, text? }` with a shared `levelsStyle { linewidth, linestyle }`,
plus: `showCoeffs` (show level values), `showPrices` (show price at each level), `coeffsAsPercents`
(display 61.8 % instead of 0.618), `horzLabelsAlign` (left/center/right — where along the level line the
label sits), `vertLabelsAlign` (top/middle/bottom — label above/on/below the line), `labelFontSize`,
`fillBackground` + `transparency` (fill between consecutive **visible** levels, each band coloured with the
upper level's colour at the given transparency), `extendLines`/`extendLinesLeft` (extend level lines right/left to the pane edge),
`reverse` (swap which end is 0 and which is 1), `fibLevelsBasedOnLogScale` (when the price scale is
logarithmic, compute level prices geometrically: `price(c) = p1 · (p2/p1)^c` instead of linearly — doc:
"calculating the levels of the fib retracement in an alternative way when the logarithmic scale is on";
the checkbox only appears while log scale is active), and `trendline {visible,color,linewidth,linestyle}`
(the dashed grey base line between the anchor points). "Use one color" in the UI sets every level's colour and the background to one colour (doc).

Default 24-level table (lib; identical for `fib_retracement`, `fib_trend_ext`, `fib_channel`):

| # | coeff | colour | visible |
|---|---|---|---|
| 1 | 0 | `#808080` | ✔ |
| 2 | 0.236 | `#F23645` | ✔ |
| 3 | 0.382 | `#FF9800` | ✔ |
| 4 | 0.5 | `#4CAF50` | ✔ |
| 5 | 0.618 | `#089981` | ✔ |
| 6 | 0.786 | `#00BCD4` | ✔ |
| 7 | 1 | `#808080` | ✔ |
| 8 | 1.618 | `#2962FF` | ✔ |
| 9 | 2.618 | `#F23645` | ✔ |
| 10 | 3.618 | `#9C27B0` | ✔ |
| 11 | 4.236 | `#E91E63` | ✔ |
| 12 | 1.272 | `#FF9800` | ✘ |
| 13 | 1.414 | `#F23645` | ✘ |
| 14 | 2.272 | `#FF9800` | ✘ |
| 15 | 2.414 | `#4CAF50` | ✘ |
| 16 | 2 | `#089981` | ✘ |
| 17 | 3 | `#00BCD4` | ✘ |
| 18 | 3.272 | `#808080` | ✘ |
| 19 | 3.414 | `#2962FF` | ✘ |
| 20 | 4 | `#F23645` | ✘ |
| 21 | 4.272 | `#9C27B0` | ✘ |
| 22 | 4.414 | `#E91E63` | ✘ |
| 23 | 4.618 | `#FF9800` | ✘ |
| 24 | 4.764 | `#089981` | ✘ |

(Old 2010s defaults for comparison: 0.764 instead of 0.786 as level 6; colours `#CC2828`, `#95CC28`, `#28CC28`, `#28CC95`, `#2895CC`, `#2828CC`, `#9528CC`, `#CC2895`.)

Level line label format (obs): `0.618 (1234.56)` when both `showCoeffs` and `showPrices` are on;
`61.8%` when `coeffsAsPercents`; custom `level.text` (editable inline on the chart, doc) is appended.
Label default position: `horzLabelsAlign left`, `vertLabelsAlign middle`.

### C.1 Fib retracement — `fib_retracement` / `linetoolfibretracement` (doc 43000518158)

- Points: 2 clicks (hotkey `Alt+F`). p1 = 0 % end, p2 = 100 % end (so drawing bottom→top gives 0 at the bottom; `reverse` flips).
- Geometry: for every visible level `c`: horizontal line at `price = p1.price + c·(p2.price − p1.price)` (linear) or `p1.price·(p2.price/p1.price)^c` (log option), spanning x from `min(x1,x2)` to `max(x1,x2)`; `extendLines` (right) / `extendLinesLeft` push the ends to the pane edges. Dashed trend line p1→p2. Background bands between consecutive visible levels.
- Handles: p1, p2. Body drag (on any level line or band) moves both.
- Style defaults (lib): `trendline.visible true`, `.color #808080`, `.linewidth 2`, `.linestyle 2` (dashed); `levelsStyle.linewidth 2`, `.linestyle 0`; `extendLines false`, `extendLinesLeft false`; `reverse false`; `showCoeffs true`, `showPrices true`, `showText true`, `coeffsAsPercents false`; `horzLabelsAlign left`, `vertLabelsAlign middle`, `horzTextAlign center`, `vertTextAlign middle`; `labelFontSize 12`; `fillBackground true`, `transparency 80`; `fibLevelsBasedOnLogScale false`. Levels: table above (24 slots; 11 visible).
- Doc UI labels: Trend line; Levels line (thickness, style); Extend lines left / right; per-level checkbox + value + colour; Use one color; Background (+opacity); Reverse; Prices; Levels (Values / Percents); Labels (position); Text; Font size; Fib levels based on log scale.
- Coordinates: Price 1 / Bar 1, Price 2 / Bar 2.

### C.2 Trend-based fib extension — `fib_trend_ext` / `linetooltrendbasedfibextension` (doc 43000518137)

- Points: 3 — p1 start of move, p2 end of move, p3 end of retracement (doc).
- Geometry: `d = p2.price − p1.price`; level `c` at `price = p3.price + c·d` (levels are projected from p3 in the direction of the p1→p2 move; `reverse` negates). Level lines span from `x3` rightwards to the last of the three x's (obs: from `min(x)` of the trio to `max(x)`; extend options as retracement). Dashed trend lines p1→p2 and p2→p3.
- Same 24-level table and defaults as C.1 (lib: identical property set incl. `fibLevelsBasedOnLogScale`, `extendLinesLeft`).
- Coordinates: 3 × (Price, Bar).

### C.3 Fib channel — `fib_channel` / `linetoolfibchannel` (doc 43000791610)

- Points: 3 — p1, p2 define the base trend line; p3 defines the channel width (level 1 line passes through p3, parallel to p1→p2; level 0 is the base line).
- Geometry: level `c` line = base line translated by `c × offset` where `offset` = perpendicular price offset of p3 from the base (measured vertically at equal time). Lines extend left/right per `extendLeft`/`extendRight`; otherwise span the x-range of p1–p2 (obs).
- Levels (lib): same table but the interface exposes **levels 1–24** with `{coeff,color,visible}`; defaults identical to C.0 (levels 1–11 visible, 12–24 hidden). `levelsStyle.linewidth 2`, `.linestyle 0`; `extendLeft false`, `extendRight false`; `fillBackground true`, `transparency 80`; `showCoeffs true`, `showPrices true`, `coeffsAsPercents false`; `horzLabelsAlign left`, `vertLabelsAlign middle`; `labelFontSize 12`.
- Doc UI: Levels line; Extend (left/right/both/none); level checkboxes + colours; Use one color; Background; Prices; Levels (Values/Percents); Labels (horizontal & vertical); Font size.

### C.4 Fib time zone — `fib_timezone` / `linetoolfibtimezone` (doc 43000518155)

- Points: 2 — p1 = origin bar (level 0), p2 = bar defining the unit interval (level 1).
- Geometry: `unit = index2 − index1` bars; for level coefficient `k` a vertical line at `index1 + k·unit` — default coefficients are the Fibonacci numbers **0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89** (11 levels). Lines span the full pane height. Optional fill between consecutive lines (`fillBackground`, off by default). Base dashed trend line p1→p2.
- Labels: level value shown at each line (`showLabels true`), `horzLabelsAlign right`, `vertLabelsAlign bottom`.
- Style (lib): `level1 {0, #808080}`, `level2…11 {1,2,3,5,8,13,21,34,55,89, #2962FF}` all `visible true`, `linewidth 2`, `linestyle 0`; `trendline {visible true, #808080, linewidth 1, linestyle 2}`; `fillBackground false`, `transparency 80`. (old colour `rgba(0,85,219,1)`, `baselinecolor` grey.)
- Doc UI: Initial line (visibility/colour/thickness/style), level rows with custom values, Use one color, Background, Labels.

### C.5 Fib speed resistance fan — `fib_speed_resist_fan` / `linetoolfibspeedresistancefan` (doc 43000518156)

- Points: 2 (p1 origin, p2 opposite corner). `Shift` snaps to 45°.
- Geometry: the rectangle p1–p2 is divided horizontally (price levels `hlevel1..7`) and vertically (time levels `vlevel1..7`) at coefficients **0, 0.25, 0.382, 0.5, 0.618, 0.75, 1** (both axes). A **grid** of those horizontal/vertical lines is drawn inside the box (`grid`). **Fan lines** radiate from p1 through each point where a price level meets the far vertical edge and through each point where a time level meets the far horizontal edge (i.e. lines from origin to `(x2, y(c))` and to `(x(c), y2)`), extended beyond the box to the pane edge (obs). Labels at top/bottom/left/right (`showTopLabels` etc.). `reverse` mirrors the fan direction. Fill between fan lines (`fillBackground`, 80 transparency).
- Style (lib): `hlevel1..7` = `{0 #808080, 0.25 #FF9800, 0.382 #00BCD4, 0.5 #4CAF50, 0.618 #089981, 0.75 #2962FF, 1 #808080}` all visible; `vlevel1..7` identical; `grid {color rgba(21,56,153,0.8), linewidth 1, linestyle 0, visible true}`; `linewidth 2`, `linestyle 0`; `showTopLabels/showBottomLabels/showLeftLabels/showRightLabels true`; `fillBackground true`, `transparency 80`; `reverse false`; (old) `snapTo45Degrees true`, `font Verdana`.

### C.6 Trend-based fib time — `fib_trend_time` / `linetooltrendbasedfibtime` (doc 43000518136)

- Points: 3 (p1, p2 define the time distance `T = index2 − index1`; p3 = projection origin).
- Geometry: vertical line for each visible coefficient `c` at `index3 + c·T` (obs; lines span the pane). Dashed trend lines p1→p2→p3. Labels (`showCoeffs`), `horzLabelsAlign right`, `vertLabelsAlign bottom`. Fill between lines (`fillBackground true`, transparency 80).
- Default levels (lib): `0 #808080 ✔`, `0.382 #F23645 ✔`, `0.5 #81C784 ✘`, `0.618 #4CAF50 ✔`, `1 #089981 ✔`, `1.382 #00BCD4 ✔`, `1.618 #808080 ✔`, `2 #2962FF ✔`, `2.382 #E91E63 ✔`, `2.618 #9C27B0 ✔`, `3 #673AB7 ✔`; each `linewidth 2`, `linestyle 0`; `trendline {visible, #808080, 2, dashed}`.

### C.7 Fib circles — `fib_circles` / `linetoolfibcircles` (doc 43000518159)

- Points: 2 (p1 centre, p2 defines the radius vector). `Shift` → 45° / perfectly round.
- Geometry: for each visible coefficient `c`, an ellipse centred at p1 with radii `c·|dx|` (px) and `c·|dy|` (px) where `(dx,dy)` = p2 − p1 in **screen pixels** (so circles are round only when the chart's px ratio makes them so; TV suggests `Shift` or "lock price to bar ratio") (doc: "some circles may be invisible because of chart-window scale limits"). Level 1 circle passes through p2. Labels at the circle's rightmost/topmost point (obs). Fill between consecutive circles (`fillBackground`, 80).
- Defaults (lib): 11 levels — `0.236 #F23645`, `0.382 #FF9800`, `0.5 #089981`, `0.618 #4CAF50`, `0.786 #00BCD4`, `1 #808080`, `1.618 #2962FF`, `2.618 #E91E63`, `3.618 #2962FF`, `4.236 #E91E63`, `4.618 #F23645`, all visible, `linewidth 2`, `linestyle 0`; `trendline {visible, #808080, 2, dashed}`; `showCoeffs true`, `coeffsAsPercents false`; (old) `snapTo45Degrees true`.
- Doc UI: Trend line; circle levels with custom values; Use one color; Levels (labels); Coeffs as percents; Background.

### C.8 Fib spiral — `fib_spiral` / `linetoolfibspiral` (doc 43000791611)

- Points: 2 (p1 centre/start, p2 sets initial radius and orientation).
- Geometry: golden (logarithmic) spiral `r(θ) = r0 · φ^(2θ/π)` starting at p2's radius/angle, growing clockwise (`counterclockwise false`) for several turns until it leaves the pane (obs). Drawn in screen space (radius in px).
- Style (lib): `linecolor #00BCD4`, `linewidth 1`, `linestyle 0`, `counterclockwise false`. (old colour `rgba(21,153,128,1)`.)

### C.9 Fib speed resistance arcs — `fib_speed_resist_arcs` / `linetoolfibspeedresistancearcs` (doc 43000518157)

- Points: 2 (p1 start of trend/centre, p2 end).
- Geometry: for each coefficient `c`, an arc centred at **p2** (the end of the trend line) with radius `c · |p2 − p1|` in screen pixels, drawn as a half-circle opening away from p1 (doc: "arcs intersecting the trend line at the chosen percentage distances between the line's start and end points"; obs for the centre/orientation). With `fullCircles true` the arcs become full circles (doc). Fill between arcs.
- Defaults (lib): `0.236 #F23645`, `0.382 #FF9800`, `0.5 #089981`, `0.618 #F23645`, `0.786 #00BCD4`, `1 #808080`, `1.618 #2962FF`, `2.618 #E91E63`, `3.618 #2962FF`, `4.236 #E91E63`, `4.618 #F23645`, all visible, w2 solid; `trendline {visible, #808080, 2, dashed}`; `fullCircles false`; `fillBackground true`, `transparency 80`; `showCoeffs true`.

### C.10 Fib wedge — `fib_wedge` / `linetoolfibwedge` (doc 43000518153)

- Points: 3 — p1 apex, p2 and p3 the two ray ends (obs; doc text is ambiguous but the tool has three coordinates in the UI).
- Geometry: two rays from p1 through p2 and p3 ("Trend line" toggles these side lines, doc); for each coefficient `c` an arc centred at p1 with radius `c · |p2 − p1|` (px) clipped between the two rays (obs). Fill between arcs.
- Defaults (lib): `0.236 #F23645 ✔`, `0.382 #FF9800 ✔`, `0.5 #4CAF50 ✔`, `0.618 #089981 ✔`, `0.786 #00BCD4 ✔`, `1 #808080 ✔`, `1.618 #2962FF ✘`, `2.618 #F23645 ✘`, `3.618 #673AB7 ✘`, `4.236 #E91E63 ✘`, `4.618 #E91E63 ✘`; w2 solid; `trendline {visible, #808080, 2, solid}`; `fillBackground true`, `transparency 80`; `showCoeffs true`.

### C.11 Pitchfan — `pitchfan` / `linetoolpitchfan` (doc 43000518143) — see §E.5.

---

## D. Gann tools

### D.1 Gann box — `gannbox` / `linetoolgannsquare` (doc 43000518152)

- Points: 2 (opposite corners). Rectangle p1–p2.
- Geometry: horizontal **price levels** at `hlevel` coefficients across the box height and vertical **time levels** at `vlevel` coefficients across the width — default coefficients **0, 0.25, 0.382, 0.5, 0.618, 0.75, 1** for both. Labels on all four sides (`showTop/Bottom/Left/RightLabels`). Two background groups: fill between horizontal levels (`fillHorzBackground`, `horzTransparency 80`) and between vertical levels (`fillVertBackground`, `vertTransparency 80`). Optional **Angles** (`fans`): rays from the box corners through the box (doc: "draws corner rays throughout the box"), off by default. `reverse` "rotates the drawing around its main points (reflects it diagonally)" (doc).
- Style (lib): `color rgba(21,56,153,0.8)`, `linewidth 2`, `linestyle 0`; `hlevel1..7` `{0 #808080, 0.25 #FF9800, 0.382 #00BCD4, 0.5 #4CAF50, 0.618 #089981, 0.75 #2962FF, 1 #808080}` visible; `vlevel1..7` identical; `fans {color #9C9C9C, visible false}`; labels all `true`; `reverse false`.

### D.2 Gann square fixed — `gannbox_fixed` / `linetoolgannfixed` (doc 43000791675)

- Points: 2 (origin + size/orientation). `Shift` = fixed price/bar increments so the box is "square" in price-per-bar units (doc).
- Geometry: a square grid (**Levels** 0–5 ⇒ 6 lines per axis dividing the box into 5×5 cells, obs), **Fans** = rays from the origin corner with ratio `x:y` (grid units) and **Arcs** = quarter circles centred at the origin passing through grid point `(x,y)` (radius `√(x²+y²)` grid units) (obs). `reverse` flips orientation.
- Levels (lib): `levels.0..5` colours `#808080, #FF9800, #00BCD4, #4CAF50, #089981, #808080`, `width 2`, visible.
- Fanlines (lib, `{x,y}` = ratio): `(8,1) #B39DDB ✘`, `(5,1) #F23645 ✘`, `(4,1) #808080 ✘`, `(3,1) #FF9800 ✘`, `(2,1) #00BCD4 ✔`, `(1,1) #4CAF50 ✔`, `(1,2) #089981 ✔`, `(1,3) #089981 ✘`, `(1,4) #2962FF ✘`, `(1,5) #9575CD ✘`, `(1,8) #B39DDB ✘`; width 2.
- Arcs (lib, `{x,y}`): `(1,0) #FF9800`, `(1,1) #FF9800`, `(1.5,0) #FF9800`, `(2,0) #00BCD4`, `(2,1) #00BCD4`, `(3,0) #4CAF50`, `(3,1) #4CAF50`, `(4,0) #089981`, `(4,1) #089981`, `(5,0) #2962FF`, `(5,1) #2962FF`; all visible, width 2. `arcsBackground {fillBackground true, transparency 80}`; `fillBackground false` (levels background); `reverse false`.
- UI labels (doc): Levels 0–5, Fans (8x1, 1x1, 1x2 …), Arcs (1x0, 1x1, 1.5x0 …), Use one color, Background, Reverse.

### D.3 Gann square — `gannbox_square` / `linetoolganncomplex` (doc 43000518149)

- Same construction as D.2 but the price/bar ratio is **not fixed**: the second point freely sets width and height; a "Price/Bar ratio" is shown and `Shift`+click on an anchor preserves it (doc). Extra: `scaleRatio` (undefined by default = use current ratio), `showLabels true`, `labelsStyle {fontSize 12, bold false, italic false}` — "Ranges and Ratio metrics display at corners" (doc). Identical default levels/fans/arcs to D.2.

### D.4 Gann fan — `gannbox_fan` / `linetoolgannfan` (doc 43000518151)

- Points: 2 — p1 origin, p2 defines the **1×1** line. Nine rays from p1.
- Geometry: let `s = (y2 − y1)/(x2 − x1)` in **screen px** (obs: TV computes the fan in screen space of the 1×1 line). Ray `a×b` (a price units per b time units) has slope `s · (a/b)`; using `coeff1/coeff2` from the table: slope factor = `coeff1 / coeff2` … with level1 `1/8` flattest and level9 `8/1` steepest. Rays extend to the pane edge. Labels `1/8 … 8/1` at the ray ends (`showLabels`). Fill between adjacent rays (`fillBackground`, 80).
- Defaults (lib): `level1 1×8 #FF9800`, `level2 1×4 #089981`, `level3 1×3 #4CAF50`, `level4 1×2 #089981`, `level5 1×1 #00BCD4`, `level6 2×1 #2962FF`, `level7 3×1 #9C27B0`, `level8 4×1 #E91E63`, `level9 8×1 #F23645`; all visible, `linewidth 2`, `linestyle 0`; `showLabels true`; `fillBackground true`, `transparency 80`.
- Doc: 16×1 mentioned in theory text but not in the default set.

---

## E. Pitchfork tools

Shared model (lib): 3 points p1 (A), p2 (B), p3 (C); `median {visible,color,linewidth,linestyle}`;
levels `level0..level8 {coeff,color,visible,linestyle,linewidth}`; `extendLines` (extend to the **left**/back as well — doc for Schiff: "toggle backward line extension"; default false = lines start at the origin and extend right); `fillBackground` + `transparency`; `style` dropdown (Original / Schiff / Modified Schiff / Inside) that re-computes the same drawing in another variant without redrawing (doc).

Default levels (lib, all four pitchforks and Pitchfan):

| level | coeff | colour | visible |
|---|---|---|---|
| 0 | 0.25 | `#FFB74D` | ✘ |
| 1 | 0.382 | `#81C784` | ✘ |
| 2 | 0.5 | `#089981` (pitchfan: `#00BCD4`) | ✔ |
| 3 | 0.618 | `#089981` | ✘ |
| 4 | 0.75 | `#00BCD4` | ✘ |
| 5 | 1 | `#2962FF` | ✔ |
| 6 | 1.5 | `#9C27B0` | ✘ |
| 7 | 1.75 | `#E91E63` | ✘ |
| 8 | 2 | `#F77C80` | ✘ |

`median {visible true, color #F23645, linewidth 2, linestyle 0}`, every level `linewidth 2`, `linestyle 0`, `fillBackground true`, `transparency 80`, `extendLines false`.

Geometry (original Andrews pitchfork):

```
M   = midpoint(B, C)                      // in (index, price) space
O   = origin (depends on style)
dir = M − O                               // median direction
median: ray from O through M, extended right to the pane edge (and left if extendLines)
half = (C − B) / 2                        // half channel vector (vertical offset at same time)
level k (coeff c): two rays parallel to the median, offset by ±c·half from it,
                   starting at the median's start x (obs: TV starts tines at B and C's x for c=1)
```

So level `1` gives the classic upper/lower tines through B and C; `0.5` halfway between median and tines; `1.5`, `1.75`, `2` outside the tines. Fill: between symmetric pairs of visible levels (obs).

Origin per style (doc + obs):

| style | `style` value | Origin O |
|---|---|---|
| Original (Andrews) | 0 | `A` |
| Schiff | 1 | `(A.x, (A.y + B.y)/2)` — median start shifted **vertically** to the A–B midpoint price (obs; TV help text says "1/2 vertical and 1/2 horizontal" for all three variants, which is imprecise) |
| Inside | 2 | origin at `A`, but the channel is built on the *inner* points: the tines pass through the midpoints of A–B and… (?) — TV help repeats the Schiff wording; exact construction not confirmed. Verify against TV rendering. |
| Modified Schiff | 3 | `midpoint(A, B)` — shifted halfway in both time and price (doc 43000791609) |

### E.1 Pitchfork — `pitchfork` / `linetoolpitchfork` (doc 43000518141)
Points: 3 clicks (A, B, C). Handles A, B, C; body drag moves all. Style dropdown default Original. Up to 9 level sets (doc). Alerts: not offered (obs).

### E.2 Schiff pitchfork — `schiff_pitchfork` / `linetoolschiffpitchfork` (doc 43000518140) — `style 1`.

### E.3 Modified Schiff pitchfork — `schiff_pitchfork_modified` / `linetoolschiffpitchfork2` (doc 43000791609) — `style 3`.

### E.4 Inside pitchfork — `inside_pitchfork` / `linetoolinsidepitchfork` (doc 43000518146) — `style 2`.

### E.5 Pitchfan — `pitchfan` / `linetoolpitchfan` (doc 43000518143)

- Points: 3 (A trend start, B trend end, C end of first correction) — same anchors as a pitchfork.
- Geometry: rays from **A** (not parallel lines): the median ray A→midpoint(B,C); for each level `c` a ray from A through `M ± c·half` (i.e. through the point on segment B–C at fraction `c` from the median toward B / toward C) (obs). Fill between rays. Defaults as table above (level 2 colour `#00BCD4`). No `style`/`extendLines` properties.

---

## F. Geometric shapes

### F.1 Brush — `brush` / `linetoolbrush` (doc 43000516987)

- Creation: press, drag, release (freehand). Points sampled from pointer motion (TV thins them; `smooth 5` = smoothing factor, obs: Catmull-Rom / moving-average over 5 samples). Each point is a (time, price) so the stroke rescales with the chart.
- Geometry: polyline through the sample points; optional fill of the closed shape (`fillBackground`, off); line ends Normal/Arrow (`leftEnd`/`rightEnd`).
- Handles: none per sample; selection shows the first/last points (obs). Body drag moves all. Eraser + `Ctrl` removes segments.
- Style (lib): `linecolor #00BCD4`, `linewidth 2`, `smooth 5`, `fillBackground false`, `backgroundColor #00BCD4`, `transparency 50`, `leftEnd 0`, `rightEnd 0`. (old: `rgba(53,53,53,1)`.)

### F.2 Highlighter — `highlighter` / `linetoolhighlighter` (doc 43000791735)

- Creation: press-drag-release like Brush. A wide semi-transparent stroke (marker pen).
- Style (lib): `linecolor rgba(242,54,69,0.2)`, `width 20` (px), `transparency 80`, `smooth 5`. Round caps/joins (obs).

### F.3 Arrow marker — `arrow_marker` / `linetoolarrowmarker` (doc 43000791736)

- Points: 2 (tail, head). A thick filled arrow glyph from p1 to p2 with an optional text signature (doc).
- Style (lib): `backgroundColor #1E53E5` (arrow fill), `textColor #1E53E5`, `fontSize 16`, `bold true`, `italic false`. (old: `#1E88E5`.)

### F.4 Arrow marks up / down / left / right — `arrow_up` … / `linetoolarrowmark{up,down,left,right}` (doc 43000518087)

- Points: 1. Fixed-size glyph (doc: "the size of the arrow marks is fixed and cannot be changed") pointing in the named direction, anchored so the tip touches the point; optional label text beside it (`showLabel true`).
- Style (lib): up `arrowColor/color #089981`; down `#CC2F3C`; left/right `#2962FF`; `fontsize 14`, `bold/italic false`. (old: `#787878`, `fontsize 20`.) Doc: "green for up arrows and red for down arrows by default".

### F.5 Rectangle — `rectangle` / `linetoolrectangle` (doc 43000516984)

- Points: 2 (opposite corners); hotkey `Alt+Shift+R`; `Shift` → square.
- Geometry: axis-aligned rectangle between p1 and p2; optional **middle line** (horizontal, dashed, at mid-price); `extendLeft`/`extendRight` push the left/right edges to the pane edges (doc "Extends the rectangle to the right/left indefinitely"). Fill.
- Handles: 4 corners + 4 edge midpoints (obs); corner drags resize; edge drags move one edge.
- Text tab (doc): text, colour, size, bold/italic, alignment (`horzLabelsAlign center`, `vertLabelsAlign middle`), inline editable.
- Style (lib): `color #9C27B0` (border), `linewidth 2`, `fillBackground true`, `backgroundColor rgba(156,39,176,0.2)`, `transparency 50`, `extendLeft/extendRight false`, `middleLine {showLine false, lineColor #9C27B0, lineWidth 1, lineStyle 2}`, `showLabel false`, `textColor #9C27B0`, `fontSize 14`, `bold/italic false`. (old: `rgba(21,56,153,1)`.)

### F.6 Rotated rectangle — `rotated_rectangle` / `linetoolrotatedrectangle` (doc 43000791738)

- Points: 3 — p1, p2 = first edge (length + angle); p3 = perpendicular distance = width (doc).
- Geometry: parallelogram/rectangle in **screen space** with edge p1–p2 and the opposite edge offset by the perpendicular component of p3 (obs). Fill.
- Style (lib): `color #4CAF50`, `linewidth 2`, `fillBackground true`, `backgroundColor rgba(76,175,80,0.2)`, `transparency 50`. (old: `#9800FF`.)

### F.7 Ellipse — `ellipse` / `linetoolellipse` (doc 43000516988)

- Points: 3 (obs) — p1, p2 define one axis; p3 the half-length of the other axis. `Shift` → circle.
- Geometry: ellipse in screen space (centre = midpoint(p1,p2), major axis p1–p2, minor semi-axis = distance of p3 from that axis). Fill. Text tab available (lib exposes text props).
- Style (lib): `color #F23645`, `linewidth 2`, `fillBackground true`, `backgroundColor rgba(242,54,69,0.2)`, `transparency 50`, `textColor #F23645`, `fontSize 14`, `bold/italic false`. (old: `#999915`.)

### F.8 Circle — `circle` / `linetoolcircle` (doc 43000662172)

- Points: 2 — centre, then radius point (doc). Circle in screen space (stays round; content under it shifts when the scale changes — doc suggests "lock price to bar ratio").
- Style (lib): `color #FF9800`, `linewidth 2`, `fillBackground true`, `backgroundColor rgba(255,152,0,0.2)`, `textColor #FF9800`, `fontSize 14`, `bold/italic false`.

### F.9 Polyline — `polyline` / `linetoolpolyline` (doc 43000516986)

- Points: n clicks; finish by clicking the first point (closes the shape), double-click, right-click, or `Esc` (leaves it open) (doc).
- Geometry: straight segments; `filled` closes and fills the polygon (`fillBackground` + `backgroundColor`). Handles at every vertex.
- Style (lib): `linecolor #00BCD4`, `linewidth 2`, `linestyle 0`, `fillBackground true`, `filled false`, `backgroundColor rgba(0,188,212,0.2)`, `transparency 80`. (old: `rgba(53,53,53,1)`.)

### F.10 Path — `path` / `linetoolpath` (doc 43000791739)

- Points: n clicks; finish with double-click or `Esc` (doc). Open polyline with arrow head at the end by default.
- Style (lib): `lineColor #2962FF`, `lineWidth 2`, `lineStyle 0`, `leftEnd 0`, `rightEnd 1` (arrow). (old: `#2196F3`.)

### F.11 Triangle — `triangle` / `linetooltriangle` (doc 43000516814)

- Points: 3. Filled triangle; handles at the 3 vertices; Coordinates 3 × (Price, Bar).
- Style (lib): `color #089981`, `linewidth 2`, `fillBackground true`, `backgroundColor rgba(8,153,129,0.2)`, `transparency 80`. (old: `#991515`.)

### F.12 Arc — `arc` / `linetoolarc` (doc 43000516989)

- Points: 3 — two endpoints and a third point that sets the bulge (obs; TV draws a circular arc through/controlled by the 3rd point, filled to the chord). Used for cup-and-handle.
- Style (lib): `color #E91E63`, `linewidth 2`, `fillBackground true`, `backgroundColor rgba(233,30,99,0.2)`, `transparency 80`. (old: `#999915`.)

### F.13 Curve — `curve` / `linetoolbezierquadro` (doc 43000791740)

- Points: 3 — p1, p2 endpoints, p3 control point ("click and pull the curves", doc). Quadratic Bézier `B(t) = (1−t)²P1 + 2(1−t)t·P3 + t²P2` in screen space. Extend left/right/both extends the tangent beyond the endpoints (obs). Line ends Normal/Arrow. Optional fill under the arc (to the chord).
- Style (lib): `linecolor #2962FF`, `linewidth 2`, `linestyle 0`, `extendLeft/Right false`, `leftEnd/rightEnd 0`, `fillBackground false`, `backgroundColor rgba(41,98,255,0.2)`, `transparency 50`. (old: `rgba(21,153,128,1)`.)

### F.14 Double curve — `double_curve` / `linetoolbeziercubic` (doc 43000791740)

- Points: 4 — endpoints + two control points; cubic Bézier. Same options as Curve.
- Style (lib): `linecolor #673AB7`, `linewidth 2`, `linestyle 0`, `extendLeft/Right false`, `leftEnd/rightEnd 0`, `fillBackground false`, `backgroundColor rgba(103,58,183,0.2)`, `transparency 80`.

---

## G. Text & annotation tools

Shared text model (lib/old): `text`, `color` (text colour), `fontsize`, `bold`, `italic`, `fillBackground` + `backgroundColor` + `backgroundTransparency`, `drawBorder` + `borderColor`, `wordWrap` + `wordWrapWidth` (px), `fixedSize` (true = font size stays in px when zooming; false = text scales with the chart? — obs: `fixedSize` keeps the box a fixed pixel size). Inline editing on the chart (click the text field) (doc). Emojis may be pasted into any text field (doc 43000662396).

### G.1 Text — `text` / `linetooltext` (doc 43000516983)

- Points: 1 (top-left anchor of the text box). Moves with the chart.
- Options (doc): text box; colour; font size; bold; italic; Background (toggle, colour, opacity); Border (toggle, colour); Text wrap (toggle + width). Alignment left/center/right (obs).
- Style (lib): `color #2962FF`, `fontsize 14`, `bold/italic false`, `fillBackground false`, `backgroundColor rgba(41,98,255,0.25)`, `backgroundTransparency 70`, `drawBorder false`, `borderColor #707070`, `wordWrap false`, `wordWrapWidth 200`, `fixedSize true`. (old: `#667B8B`, `fontsize 20`, `wordWrapWidth 400`, `text 'Text'`.)

### G.2 Anchored text — `anchored_text` / `linetooltextabsolute`

- Anchored to the **screen** (does not scroll with the chart): position stored as percentages of the pane `{x: 0..1, y: 0..1}` (`createAnchoredShape({x,y})`, `getAnchoredPosition()` / `setAnchoredPosition()`). Same style set; `fixedSize false` (lib).

### G.3 Note — `note` / `linetoolnote` (doc 43000737571) and `text_note`

- Points: 1. A marker (pin icon in `markerColor`) at the price/time point with a text bubble; "place a comment directly on the chart with a link to the selected price level" (doc). Double-click / Settings to edit; on the web the note text is shown in a popup when the marker is clicked (obs).
- Style (lib): `markerColor #2962FF`, `textColor #FFFFFF`, `backgroundColor rgba(41,98,255,0.7)`, `backgroundTransparency 0`, `borderColor #2962FF`, `fontSize 14`, `bold/italic false`, `fixedSize true`. (old: marker `#2E66FF`, text black on white, Arial 12.)

### G.4 Anchored note — `anchored_note` / `linetoolnoteabsolute` — screen-anchored variant of Note; same defaults.

### G.5 Pin — (web only) (doc 43000791743)

- Points: 1. Small pin icon; hidden text note revealed on click. Style: pin colour. Text tab: colour/size/bold/italic, text, background toggle (colour/opacity), border toggle (colour/opacity). Coordinates: Price + Bar. No library id / overrides found (?).

### G.6 Callout — `callout` / `linetoolcallout` (doc 43000516978)

- Points: 2 — p1 = pointer/anchor tip, p2 = text box position. A rounded box at p2 with a tail to p1.
- Style (lib): `color #FFFFFF` (text), `backgroundColor rgba(0,151,167,0.7)`, `bordercolor #0097A7`, `linewidth 2` (border/tail), `fontsize 14`, `bold/italic false`, `transparency 50`, `wordWrap false`, `wordWrapWidth 200`. (old: `#991515`, `Verdana 12`.)
- Doc options: text colour/size/bold/italic, text box, background colour/opacity, border colour/opacity/thickness/style, text wrap.

### G.7 Comment — `comment` / `linetoolcomment` (doc 43000516981) (legacy bubble: `balloon` / `linetoolballoon`)

- Points: 1. Speech-bubble with a pointer at the anchor; "smaller, more targeted than a text box" (doc).
- Style (lib, comment): `color #FFFFFF`, `backgroundColor #2962FF`, `borderColor #2962FF`, `fontsize 16`, `transparency 0`. Balloon (lib): `color #FFFFFF`, `backgroundColor rgba(156,39,176,0.7)`, `borderColor rgba(156,39,176,0)`, `fontsize 14`, `transparency 30` (old: yellow `#FFFECE` bubble, Arial 12 bold, text 'Comment').

### G.8 Price label — `price_label` / `linetoolpricelabel` (doc 43000518083)

- Points: 1. A label showing the anchor's **price** (formatted) with a pointer to the point; the text is the price and updates when the label is moved (obs). Style: text colour/size/opacity, background colour/opacity, border colour/opacity (doc).
- Style (lib): `color #FFFFFF`, `backgroundColor #2962FF`, `borderColor #2962FF`, `fontsize 14`, `fontWeight bold`, `transparency 0`. (old: white bg, `#667B8B` text, Arial 11 bold.)

### G.9 Price note — `price_note` (doc 43000791741)

- Points: 2 — p1 = anchored price level, p2 = label position. Draws a connecting line and a label containing the **automatic price value** of p1 plus custom text (doc). Style: label text colour/size/bold/italic; label background colour/opacity; label border colour/opacity; line colour/opacity. No override interface page exists (?) — defaults presumably match Price label (`#2962FF`).

### G.10 Signpost — `signpost` / `linetoolsignpost` (doc 43000791744)

- Points: 1 anchor + a **strictly vertical** drag to set the label distance ("can only be extended straight up or straight down", doc). Coordinates: Price 1 / Bar 1 and a "vertical position %" for the label (doc).
- Geometry: optional emoji "pin" at the anchor, a vertical line, and a text plate (`plateColor`) at the end.
- Style (lib): `showImage false` (emoji pin checkbox), `emoji 🙂`, `plateColor #2962FF`, `fontSize 12`, `bold/italic false`. Doc: emoji selection button + background colour for the emoji.

### G.11 Flag mark — `flag` / `linetoolflagmark`

- Points: 1. A small flag icon at the point (default shape for `createShape`). Style (lib): `flagColor #2962FF` (old `#FF0000`).

### G.12 Table — `table` (doc 43000744162)

- Creation: select tool, click to place; resize by dragging a corner point; rows/columns resize by dragging borders (highlighted blue on hover); add row/column via floating toolbar or context menu (new column to the right / new row below the selected cell, else at the end); delete via context menu with a cell selected; cells edited by click + type; **Anchor to screen** toggle so the table stays visible regardless of scroll (doc).
- Style (doc): background colour/opacity, border colour, text colour/size, text alignment per cell. Visibility tab only. No override interface (?).

### G.13 Image — (web) `linetoolimage` (doc 43000632957)

- Insert via toolbar (file picker), drag-and-drop, or `Ctrl+V` paste. JPG/PNG only, ≤ 2 MB, ≤ 2000×2000 px. Resize with corner handles; settings: rename, transparency, replace image, visibility. Overrides (lib): `angle 0`, `cssWidth 0`, `cssHeight 0`, `transparency 0`.

### G.14 Icons / Emojis / Stickers — `icon` / `emoji` / `sticker`

- Points: 1. Icons: Font-Awesome-style glyphs selected by hex code (`icon: 0xf0da`), `size 40`, `angle π/2`, `color #2962FF`, `scale 1` (old). Emoji: Twemoji v13 (library), `size 40`, `angle π/2`. Sticker: `size 110`, `angle π/2`. Selection handles allow resize (and rotate for icons, obs).

### G.15 X posts and ideas — (web) (doc 43000662394)

- Annotation tools ▸ "X post" / "Idea": paste a URL; the card is placed on the timeline at the post's publish time; the container can be dragged vertically (doc).

---

## H. Patterns

Shared model for harmonic/classic patterns (lib): `color` (lines), `textcolor` (label text), `fillBackground` + `backgroundColor` + `transparency` (triangles between legs), `linewidth`, `fontsize 12`, `bold/italic false`. Labels are the point letters drawn in a small filled circle/box at each anchor (obs: white text on `color` background); **ratio labels** are drawn on the legs (doc: "displays calculated Fibonacci ratios").

### H.1 XABCD pattern — `xabcd_pattern` / `linetool5pointspattern` (doc 43000569909)

- Points: 5 (X, A, B, C, D) alternating highs/lows. Legs XA, AB, BC, CD drawn; triangles XAB and BCD filled (obs).
- Ratio labels (obs): on AB: `|AB|/|XA|`; on BC: `|BC|/|AB|`; on CD: `|CD|/|BC|`; on the XD/AD dashed line: `|AD|/|XA|` (3 decimals). Gartley/Butterfly/Crab/Bat ratios listed in doc are guidance only.
- Style (lib): `color #2962FF`, `textcolor #FFFFFF`, `fillBackground true`, `backgroundColor #2962FF`, `transparency 85`, `linewidth 2`. (old: `#CC2895`.) Coordinates: Price 1–5.

### H.2 Cypher pattern — `cypher_pattern` / `linetoolcypherpattern` (doc 43000791680)

- Points: 5 (X A B C D); same rendering/labels as XABCD, with validation guidance: B = 0.382–0.618 of XA, C = 1.13–1.414 extension of XA, D = 0.786 of XC (doc). Style identical to H.1 (lib: `#2962FF`, transparency 85).

### H.3 ABCD pattern — `abcd_pattern` / `linetoolabcd` (doc 43000570202)

- Points: 4 (A B C D). Legs AB, BC, CD; no fill (lib has no background props). Ratio labels: `BC/AB` and `CD/BC` (obs).
- Style (lib): `color #089981`, `textcolor #FFFFFF`, `linewidth 2`, `fontsize 12`. (old: `#009B00`.)

### H.4 Triangle pattern — `triangle_pattern` / `linetooltrianglepattern` (doc 43000570208)

- Points: 4 (A, B, C, D) — A & C consecutive highs (or lows), B & D the opposite; lines A–C and B–D form the converging/flat triangle; fill between (doc).
- Style (lib): `color #673AB7`, `backgroundColor #673AB7`, `transparency 85`, `textcolor #FFFFFF`, `linewidth 2`. (old: `#9528FF`/`#9528CC`.)

### H.5 Three drives pattern — `3divers_pattern` / `linetoolthreedrivers` (doc 43000570172)

- Points: **7** (Coordinates Price 1–7, doc). Labels (obs): `0, 1, A, 2, C, 3` … the sequence start, drive 1, retracement A, drive 2, retracement C, drive 3 (+ end). Ratio labels on retracements/extensions.
- Style (lib): `color #673AB7`, `backgroundColor rgba(149,40,204,0.5)`, `fillBackground true`, `transparency 50`, `textcolor #FFFFFF`, `linewidth 2`.

### H.6 Head and shoulders — `head_and_shoulders` / `linetoolheadandshoulders` (doc 43000570149)

- Points: 7 (obs): start, **LS** (left shoulder peak), valley 1, **H** (head), valley 2, **RS** (right shoulder), end. The **neckline** connects the two valleys and is extended; fill between the price path and the neckline (obs).
- Style (lib): `color #089981`, `backgroundColor #089981`, `transparency 85`, `fillBackground true`, `textcolor #FFFFFF`, `linewidth 2`. (old: `#45682F`.)

### H.7 Elliott waves — `elliott_impulse_wave`, `elliott_correction`, `elliott_triangle_wave`, `elliott_double_combo`, `elliott_triple_combo` (doc 43000653212)

| Tool | Points | Labels |
|---|---|---|
| Impulse (12345) | 6 | 0 1 2 3 4 5 |
| Correction (ABC) | 4 | 0 A B C |
| Triangle (ABCDE) | 6 | 0 A B C D E |
| Double combo (WXY) | 4 | 0 W X Y |
| Triple combo (WXYXZ) | 6 | 0 W X Y X Z |

- Geometry: polyline through the points (`showWave true` draws the connecting lines; off = labels only); labels placed above highs / below lows (obs).
- **Degree** (`degree`, default `7`): dropdown of 15 degrees, largest → smallest (doc/TV list): 0 Supermillennium, 1 Millennium, 2 Submillennium, 3 Grand Supercycle, 4 Supercycle, 5 Cycle, 6 Primary, **7 Intermediate**, 8 Minor, 9 Minute, 10 Minuette, 11 Subminuette, 12 Micro, 13 Submicro, 14 Minuscule (index mapping obs from default 7 = Intermediate). Each degree changes the label notation; standard Elliott notation (obs — TV draws circled variants as a circle around the glyph):

| Degree | Impulse labels | Corrective labels |
|---|---|---|
| Grand Supercycle | ⓘ ⓘⓘ ⓘⓘⓘ ⓘⓥ ⓥ (circled roman) | Ⓐ Ⓑ Ⓒ |
| Supercycle | (I) (II) (III) (IV) (V) | (A) (B) (C) |
| Cycle | I II III IV V | A B C |
| Primary | ① ② ③ ④ ⑤ (circled arabic) | Ⓐ Ⓑ Ⓒ |
| Intermediate | (1) (2) (3) (4) (5) | (A) (B) (C) |
| Minor | 1 2 3 4 5 | A B C |
| Minute | ⓘ ⓘⓘ … (circled lower roman) | ⓐ ⓑ ⓒ |
| Minuette | (i) (ii) (iii) (iv) (v) | (a) (b) (c) |
| Subminuette | i ii iii iv v | a b c |
| Supermillennium / Millennium / Submillennium / Micro / Submicro / Minuscule | extended notations (TV-specific; not found in docs) (?) | |

- Style (lib): impulse & correction `color #3D85C6`; triangle `#FF9800`; double/triple combo `#6AA84F`; all `linewidth 2` (old 1), `degree 7`, `showWave true`.

### H.8 Cyclic lines — `cyclic_lines` / `linetoolcirclelines` (doc 43000518161)

- Points: 2 (define one interval `T = index2 − index1`). Vertical lines at `index1 + k·T` for `k = 0, 1, 2, …` "indefinitely into the future" (doc) (obs: also drawn to the left? — doc says forward only).
- Style (lib): `linecolor #80CCDB`, `linewidth 1`, `linestyle 0`; `trendline {visible true, color #808080, linewidth 1, linestyle 2}` (the dashed base segment between p1 and p2).

### H.9 Time cycles — `time_cycles` / `linetooltimecycles` (doc 43000791682)

- Points: 2 (cycle length). Repeating vertical lines forward at the interval, with **alternating shaded backgrounds** between them (doc). (obs: TV also draws semicircle arcs spanning each cycle in older versions — the current doc describes vertical lines + shading.)
- Style (lib): `linecolor #159980`, `linewidth 2`, `linestyle 0`, `fillBackground true`, `backgroundColor rgba(106,168,79,0.5)`, `transparency 50`.

### H.10 Sine line — `sine_line` / `linetoolsineline` (doc 43000791685)

- Points: 2 — p1 = start (a peak/trough), p2 = "defines the overall amplitude and frequency" (doc). Geometry (obs): half-period = `index2 − index1` bars, amplitude = `price2 − price1`; `y(x) = p1.price + A·sin(π·(x − x1)/T)` … projected across the whole pane (both directions).
- Style (lib): `linecolor #159980`, `linewidth 2`, `linestyle 0`.

---

## I. Prediction & measurement tools

### I.1 Long position / Short position — `long_position` / `short_position`; `linetoolriskrewardlong` / `linetoolriskrewardshort` (doc 43000517002, 43000516992, 43000475660)

- Creation: **1 click** at the entry price/time. Default profit and stop distances are derived from the visible range (old doc: `profitLevel = stopLevel = (visible bars' high − low) × 20` in ticks ⇒ i.e. `(H−L)·20·tickSize` in price). The box has a default width of a number of bars to the right (obs).
- Geometry: entry line at `entry` from `x_entry` to `x_entry + width`; green **profit zone** rectangle between entry and target (above entry for long / below for short), red **stop zone** between entry and stop; three horizontal lines (target, entry, stop) in `linecolor`.
- Handles (obs): target line centre (drag vertically), stop line centre, entry (left middle; dragging moves the whole tool), right edge (width in bars), plus the whole body.
- Displayed labels (doc): on the target zone — target price, % from entry, distance in ticks, profit amount, Risk/Reward ratio; on the stop zone — stop price, %, ticks, loss amount; on the entry — Qty (position size), Risk (amount and %), account balances at TP / SL, open P&L (obs). `compact` ("Compact stats mode") shortens the tags; `alwaysShowStats` false ⇒ tags only when selected.
- Formulas (doc):
  - Long `RR = (Profit − Entry) / (Entry − Stop)`; Short `RR = (Entry − Profit) / (Stop − Entry)`.
  - `RiskSize` = `risk` in money, or `accountSize × risk / 100` when `riskDisplayMode = percents`.
  - `QtyRisk = (RiskSize / (|Entry − Stop| × PointValue)) / LotSize`.
  - `QtyLeverage = (AccountSize × Leverage / EntryPrice) × PointValue / LotSize` (as quoted by TV).
  - `Qty = min(QtyRisk, QtyLeverage)` (leverage branch only when leverage is set), rounded per `QTY Precision`.
  - Profit `= |Profit − Entry| × Qty × PointValue × LotSize`; Loss `= |Entry − Stop| × Qty × PointValue × LotSize`.
  - Account at TP `= accountSize + Profit`; at SL `= accountSize − Loss`.
- Inputs (doc): Account size, Lot size, Risk (money or %), Entry price, Leverage, Profit level (ticks or price), Stop level (ticks or price), QTY precision, Currency.
- Style (lib): `accountSize 1000`, `lotSize 1`, `risk 25`, `riskDisplayMode percents`, `currency NONE`, `compact false`, `alwaysShowStats false`, `showPriceLabels true`, `linecolor #808080`, `linewidth 1`, `profitBackground rgba(8,153,129,0.2)`, `profitBackgroundTransparency 80`, `stopBackground rgba(242,54,69,0.2)`, `stopBackgroundTransparency 80`, `fillBackground true`, `fillLabelBackground true`, `labelBackgroundColor #585858`, `textcolor #FFFFFF`, `fontsize 12`, `drawBorder false`, `borderColor #667B8B`. Doc Style labels: Lines, Stop color, Target color, Text, Price labels, Stats, Compact stats mode, Always show stats.
- Alerts: one alert watches entry, TP and SL crossings (doc).

### I.2 Forecast (Position forecast) — `forecast` / `linetoolprediction` (doc 43000517004)

- Points: 2 — source (entry price/time) and target (price/time in the future).
- Geometry: line from source to target with a **source label** (price + date) and a **target label**; state colouring: pending/intermediate (yellow) until the target time; then **success** if price reached the target price before/at the target time, else **failure** (doc: "marks trades as successful or unsuccessful"). Centre markers in `centersColor`.
- Style (lib): `linecolor #2962FF`, `linewidth 2`, `sourceBackColor #2962FF`, `sourceStrokeColor #2962FF`, `sourceTextColor #FFFFFF`, `targetBackColor #2962FF`, `targetStrokeColor #2962FF`, `targetTextColor #FFFFFF`, `successBackground #4CAF50`, `successTextColor #FFFFFF`, `failureBackground #F23645`, `failureTextColor #FFFFFF`, `intermediateBackColor #EAD289`, `intermediateTextColor #6D4D22`, `centersColor #202020`, `transparency 10`.

### I.3 Bars pattern — `bars_pattern` / `linetoolbarspattern` (doc 43000517006)

- Creation: 2 clicks select a bar range; the copied bars become a movable object; drag anywhere (time and price offsets) to compare (doc).
- Modes (`mode`): 0 Bars, 1 Line, 2 Open/Close, 3 Line (open), 4 Line (high), 5 Line (low), 6 Line (HL/2). `mirrored` (vertical reflection) / `flipped` (horizontal reflection) checkboxes (doc).
- Style (lib): `color #2962FF`, `mode 0`, `mirrored false`, `flipped false`. (old `#5091CC`.)

### I.4 Ghost feed — `ghost_feed` / `linetoolghostfeed` (doc 43000748168)

- Creation: click a start point, then each further click adds a segment endpoint (up/down/backwards allowed); the tool fills each segment with synthetic candles; finish with double-click/`Esc` (obs).
- Generation (doc): `averageHL` = average candle high-low size in min-ticks (default 20), `variance` = distance between candles in ticks (default 50); candles are random-walked so their closes follow the segment.
- Style (lib): `candleStyle.upColor #ACE5DC`, `.downColor #FAA1A4`, `.borderUpColor #089981`, `.borderDownColor #F23645`, `.borderColor #378658`, `.wickColor #808080`, `.drawBorder true`, `.drawWick true`, `transparency 50`. Coordinates: start price and bar (doc: bar default 300 (?)).

### I.5 Projection (TV "Sector") — `projection` / `linetoolprojection` (doc 43000516995)

- Points: 3 — origin, a second point to the right (future), a third at the estimated price (doc). Geometry (obs): a filled triangle/wedge from p1 spanning p2–p3, upper half coloured `color1` (bullish) and lower `color2`; a dashed trend line; `level1 coeff 1` = the projected level.
- Style (lib): `color1 rgba(41,98,255,0.2)`, `color2 rgba(156,39,176,0.2)`, `linewidth 2`, `fillBackground true`, `transparency 80`, `showCoeffs true`, `trendline {visible true, color #9C9C9C, linestyle 0}`, `level1 {coeff 1, color #808080, visible true, linewidth 2, linestyle 0}`. (old: green/red.)

### I.6 Price range — `price_range` / `linetoolpricerange` (doc 43000516996)

- Points: 2 (vertical extent; the box spans both points' x and y). Label (obs, centred): `Δprice (Δ%)`, `N pips/ticks` per the Stats dropdown (Price range, Percent change, Change in pips). Extend option: "extend horizontally across the chart" (doc). A vertical line with end caps between the two prices (obs).
- Style (defaults, old + by analogy with date range lib): `linecolor #2962FF`, `linewidth 2`, `fillBackground true`, `backgroundColor #2962FF` at `backgroundTransparency 60`, `drawBorder false`, `borderColor #2962FF`, `fillLabelBackground true`, `labelBackgroundColor #585858`, `textColor` white/`#000000` per theme, `fontsize 12`, `shadow rgba(0,0,0,0.2)`, `customText {visible false, color #2962FF, fontsize 12, bold/italic false}`, `showPriceRange/showPercentPriceRange/showPipsPriceRange true`. (No library interface page found for `pricerange` (?).)

### I.7 Date range (Bars range) — `date_range` / `linetooldaterange` (doc 43000516996)

- Points: 2 (horizontal extent). Label (obs): `N bars`, elapsed time (e.g. `2d 3h`), optional **volume** sum over the range (`showVolume`). Extend option: "extend vertically" — `extendTop` / `extendBottom` (lib) push the box to the top/bottom of the pane.
- Style (lib): `linecolor #2962FF`, `linewidth 2`, `fillBackground true`, `backgroundColor #2962FF`, `backgroundTransparency 60`, `fillLabelBackground true`, `labelBackgroundColor #585858`, `textColor #000000`, `fontsize 12`, `shadow rgba(0,0,0,0.2)`, `extendTop false`, `extendBottom false`, `showBarsRange true`, `showDateTimeRange true`, `showVolume true`, `customText {visible false, color #2962FF, fontsize 12}`. (old: `#667B8B` line, `#BADAFF` bg, white text, `#5B85BF` label.)

### I.8 Date and price range — `date_and_price_range` / `linetooldateandpricerange` (doc 43000516996)

- Points: 2 (diagonal). Box between the points, diagonal arrow from p1 to p2 (obs), single label with: price change, %, pips, bars, elapsed time, volume (all toggles). Border toggle (`drawBorder`, `borderColor`, `borderWidth 1`).
- Style (lib): as I.7 plus `drawBorder false`, `borderColor #2962FF`, `borderWidth 1`, `showPriceRange true`, `showPercentPriceRange true`, `showPipsPriceRange true`, `extendTop/extendBottom false`.
- Text tab (doc, all three range tools): custom note with colour, font size, bold, italic.

### I.9 Fixed range volume profile — `fixed_range_volume_profile` (doc 43000707985, 43000480324)

- Points: 2 clicks (left and right bar borders; `#1 (bar)` / `#2 (bar)` in Coordinates). Draws a horizontal volume histogram for the bars in range, anchored to the right border (extends leftwards into the range; obs) or with **Extend right** on, keeps accumulating new bars.
- Inputs (doc): **Rows layout** — "Number of Rows" (then **Row size** = number of rows; ticks/row computed as `(top − bottom) / rows / tickSize`, rounded) or "Ticks Per Row" (row size = ticks per row; row count computed, may exceed the limit); **Volume** — Up/Down (each row split into up-volume (close ≥ open of the LTF bars) and down), Total, Delta (difference); **Value Area Volume** — % of total volume highlighted as the value area (default 70 % (obs)); **Extend Right**; (VRVP-style) width/placement not exposed for the drawing.
- Calculation (doc): uses a lower timeframe chosen from `1, 5, 15, 30, 60, 240, 1D` — the first for which the range has fewer than 5000 bars; for ≤ 5-minute or second charts uses 1-second data; futures/spreads use one step lower than the chart TF. **POC** = row with the highest total volume; value area = the contiguous set of rows around the POC accumulating `VA%` of the volume (standard VA expansion: add the larger of the two neighbouring row pairs above/below until the percentage is reached) (obs); **VAH/VAL** = top/bottom of that set.
- Style (obs, defaults of TV's FRVP indicator): Up volume `rgba(8,153,129,0.5)`-ish green, Down volume `rgba(242,54,69,0.5)`-ish red, Value-area up/down darker variants, POC line red `#FF0000`? width 1, VAH/VAL lines optional, "Developing POC/VA" step lines (lib `developing poc/va high/va low` — `display 0` (off), `linewidth 1`, `plottype step_line`), histogram box background, values labels. Exact colours not confirmed (?).
- Library override interfaces: `FixedRangeIndicatorOverrides` (developing POC/VA styles), `AnchoredvpLineToolOverrides` (`graphics.hhists.histBars2.colors.0/1`, `histBarsVA.colors.0/1`, `valuesColor`, `graphics.horizlines.pocLines.color`, `vahLines.color`, `valLines.color`, `graphics.polygons.histBoxBg.color`, `styles.developingPoc/VAHigh/VALow.color`) — defaults `undefined` (theme-dependent).

### I.10 Anchored volume profile — `linetoolanchoredvp` (doc 43000707989)

- Points: 1 (anchor bar). Profile from the anchor "to the end of the available bars", updating live. Same inputs (Rows layout / Row size / Volume / Value area) and LTF selection (`1, 3, 5, 15, 30, 60, 240, 1D`; falls back to chart TF when no LTF history; for a one-bar profile `close > open` ⇒ up volume) (doc).

### I.11 Anchored VWAP — see §B.15.

---

## J. Utilities

### J.1 Measure — `measure` (doc; Shift+click)

- Activate via toolbar ruler icon or hold `Shift` and click. Click (or press) the start bar, drag/move to the end, click/release. Shows a shaded box and a label with: price change (abs and %), number of bars, elapsed time (obs; TV's measure = a temporary Date-and-price-range). Box/label **blue when the end price is higher, red when lower** (obs). Disappears on the next click / `Esc`; never persisted.

### J.2 Zoom in / Zoom out — `zoom`

- Zoom in: drag a rectangle; the visible range is set to that area (doc: "magnify a particular area"). Zoom out (toolbar) restores the previous range (obs). Not persisted.

### J.3 Magnet — §2.5. Weak / Strong sub-modes; `Ctrl` temporary toggle.

### J.4 Stay in drawing mode — pencil+padlock icon; keeps the selected tool active after each drawing (doc "Keep drawing"). Action `stayInDrawingModeAction` (checkable).

### J.5 Lock all drawings — toggle; new drawings are also locked while on (obs).

### J.6 Hide options — Hide drawings / Hide indicators / Hide positions & orders / Hide all (doc). `Ctrl+Alt+H`.

### J.7 Remove options — Remove drawings / Remove indicators / Remove all (doc). Confirmation dialog (obs). Undoable.

### J.8 Object tree — §2.9.

### J.9 Sync drawings — §2.11 (web).

---

## K. Colour picker, palette and UI value lists

### K.1 Colour picker (obs)

The TV colour popover (used by every colour swatch in the floating toolbar and settings dialogs):

1. A grid of preset swatches (small squares). It is organised as **hue columns × shade rows**, derived from the Material Design palette plus TV's own brand colours; the top row is a grayscale ramp (white → black) and the following rows go from light tints to dark shades. Exact swatch matrix not available from documentation — reconstruct from the Material palette below and verify against tradingview.com (?).
2. A "+" button opening a custom colour dialog (hex input / spectrum), and a row of recently used custom colours.
3. An **Opacity** slider (0–100 %) — stored as `transparency = 100 − opacity` for fills, or folded into `rgba()` for line colours.

TV grayscale ramp used in the UI theme (obs): `#FFFFFF, #D1D4DC, #B2B5BE, #9598A1, #787B86, #5D606B, #434651, #2A2E39, #131722, #000000`.

Material Design hues (columns) with the 500 shade — TV substitutes its brand values where marked:

| Hue | 500 | TV brand substitute |
|---|---|---|
| Red | `#F44336` | `#F23645` |
| Pink | `#E91E63` | |
| Purple | `#9C27B0` | |
| Deep purple | `#673AB7` | |
| Indigo | `#3F51B5` | |
| Blue | `#2196F3` | `#2962FF` (A700) |
| Light blue | `#03A9F4` | |
| Cyan | `#00BCD4` | |
| Teal | `#009688` | `#089981` |
| Green | `#4CAF50` | |
| Light green | `#8BC34A` | |
| Lime | `#CDDC39` | |
| Yellow | `#FFEB3B` | |
| Amber | `#FFC107` | |
| Orange | `#FF9800` | |
| Deep orange | `#FF5722` | |
| Brown | `#795548` | |
| Grey | `#9E9E9E` | `#787B86` |
| Blue grey | `#607D8B` | |

Shade rows (Material 100 → 900) for each hue can be generated from the standard Material table; TV's picker shows a subset (≈ 6–7 rows) (?).

Pine Script named colours (useful cross-check of TV's brand values; obs): `color.red #F23645`, `color.green #4CAF50`, `color.blue #2196F3`, `color.orange #FF9800`, `color.purple #9C27B0`, `color.teal #00897B`, `color.aqua #00BCD4`, `color.lime #00E676`, `color.yellow #FFEB3B`, `color.fuchsia #E040FB`, `color.navy #311B92`, `color.maroon #880E4F`, `color.olive #808000`, `color.silver #B2B5BE`, `color.gray #787B86`, `color.white #FFFFFF`, `color.black #000000`.

### K.2 Dropdown value lists (obs)

- Line width: 1, 2, 3, 4.
- Line style: Solid, Dashed, Dotted.
- Line ends: Normal, Arrow.
- Extend: None, Left, Right, Both.
- Stats position: Left, Center, Right, Auto.
- Text alignment: Left / Center / Right; Top / Middle / Bottom.
- Font sizes: 10, 11, 12, 14, 16, 20, 24, 28, 32, 40.
- Levels display: Values / Percents.
- Pitchfork style: Original, Schiff, Modified Schiff, Inside.
- Bars pattern mode: Bars, Line, Open/Close, Line (open), Line (high), Line (low), Line (HL/2).
- Volume profile Rows layout: Number of Rows / Ticks Per Row; Volume: Up/Down, Total, Delta.
- Anchored VWAP source: open, high, low, close, hl2, hlc3, ohlc4; Bands mode: Standard Deviation / Percentage.
- Elliott degree: 15 entries (§H.7).
- Risk display: Money / Percent (%).

---

## L. Charting Library API surface relevant to a clone (doc)

- `IChartWidgetApi.createShape(point, options)`, `createMultipointShape(points, options)`, `createAnchoredShape({x,y}, options)`, `createExecutionShape()`, `getShapeById(id) → ILineDataSourceApi`, `getAllShapes() → [{id,name}]`, `removeEntity(id, {disableUndo})`, `removeAllShapes()`, `selection() → ISelectionApi`, `shapesGroupController()`, `selectLineTool(tool)`, `cancelLineTool()`, `isSelectingDrawingTool()`, `showPropertiesDialog(id)`, `executeActionById(id)`, `getCheckableActionState(id)`.
- `CreateShapeOptionsBase`: `shape`, `text`, `lock`, `disableSelection`, `disableSave`, `disableUndo`, `overrides`, `zOrder: 'top'|'bottom'`, `showInObjectsTree`, `ownerStudyId`; multipoint adds `filled`, `icon` (hex), `emoji`.
- `ILineDataSourceApi`: `getPoints()`, `setPoints(points)` (all points required), `getProperties()`, `setProperties(props, saveDefaults?)`, `bringToFront()`, `sendToBack()`, `isSelectionEnabled()/setSelectionEnabled()`, `isSavingEnabled()/setSavingEnabled()`, `isUserEditEnabled()/setUserEditEnabled()`, `getAnchoredPosition()/setAnchoredPosition()`, `isShowInObjectsTreeEnabled()/setShowInObjectsTreeEnabled()`.
- `ChartActionId` (drawing-related): `drawingToolbarAction`, `stayInDrawingModeAction`, `lineToggleLock`, `lineHide`, `paneObjectTree`, `paneRemoveAllStudiesDrawingTools`, `undo`, `redo`.
- Events: `widget.subscribe('drawing', e)`, `widget.subscribe('drawing_event', (id, type))`.
- Featuresets: `left_toolbar`, `hide_left_toolbar_by_default`, `side_toolbar_in_fullscreen_mode`, `items_favoriting`, `drawing_templates`, `datasource_copypaste`, `show_object_tree`, `object_tree_legend_mode`, `keep_selected_group_on_tool_creation`, `snapshot_trading_drawings`; widget options `favorites.drawingTools`, `drawings_access` (allow/deny lists).
- Emojis: Twemoji v13.

---

## M. Not found / unverified (verify against tradingview.com)

1. **Inside pitchfork** exact origin/tine construction (TV help repeats the Schiff wording).
2. **Stats position** numeric mapping (0/1/2/3 ⇒ Left/Center/Right/Auto) and the "Distance" stat's exact text.
3. **Colour picker** exact swatch matrix (rows × columns) — only theme tokens and brand colours are documented.
4. **Hit-test tolerances**, anchor-handle radius/colours, hover styling, dashed/dotted dash arrays — no documentation; values given are approximations.
5. **Weak-magnet pixel threshold**.
6. **Elliott extended degrees** (Supermillennium … Minuscule) label notations.
7. **Disjoint channel** stored-point count (3 vs 4) and Flat top/bottom handle behaviour.
8. **Price range**, **Price note**, **Pin**, **Table** override interfaces (no API pages; TV-web only or undocumented).
9. **Fixed-range / Anchored volume profile** default histogram colours and POC/VA line styles (interface defaults are `undefined`).
10. **Magic cursor** behaviour.
11. **Ghost feed** default bar position "300" and finishing gesture.
12. **Long/Short position** default box width (bars) and the exact tag wording/order.
13. Right-margin future-point serialisation (`offset`/`interval`) — inferred from layout JSON, not documented.
14. `Alt+J`, `Shift+T` hotkeys — not found (likely do not exist).

---

## Appendix A — Complete default property dump per tool (lib, v31 API reference)

The tables below are machine-extracted from every `Charting_Library.<Tool>LineToolOverrides` page
(property name → documented default). Property names are relative to the `linetool<tool>.` prefix,
e.g. `linetoolfibretracement.level1.coeff`. `undefined` means theme-dependent / unset.


### AbcdLineToolOverrides  (`linetoolabcd`)

| property | type | default |
|---|---|---|
| `bold` | boolean | `false` |
| `color` | string | `#089981` |
| `fontsize` | number | `12` |
| `italic` | boolean | `false` |
| `linewidth` | number | `2` |
| `textcolor` | string | `#ffffff` |

### AnchoredVWAPIndicatorOverrides  (`background #1`)

| property | type | default |
|---|---|---|
| `color` | string | `#4caf50` |
| `transparency` | number | `95` |
| `visible` | boolean | `true` |
| `color` | string | `#4caf50` |
| `display` | number | `15` |
| `linestyle` | number | `0` |
| `linewidth` | number | `1` |
| `plottype` | boolean | `line` |
| `trackprice` | boolean | `false` |
| `transparency` | number | `0` |
| `color` | string | `#808000` |
| `display` | number | `15` |
| `linestyle` | number | `0` |
| `linewidth` | number | `1` |
| `plottype` | boolean | `line` |
| `trackprice` | boolean | `false` |
| `transparency` | number | `0` |
| `color` | string | `#00897b` |
| `display` | number | `15` |
| `linestyle` | number | `0` |
| `linewidth` | number | `1` |
| `plottype` | boolean | `line` |
| `trackprice` | boolean | `false` |
| `transparency` | number | `0` |
| `color` | string | `#4caf50` |
| `display` | number | `15` |
| `linestyle` | number | `0` |
| `linewidth` | number | `1` |
| `plottype` | boolean | `line` |
| `trackprice` | boolean | `false` |
| `transparency` | number | `0` |
| `color` | string | `#808000` |
| `display` | number | `15` |
| `linestyle` | number | `0` |
| `linewidth` | number | `1` |
| `plottype` | boolean | `line` |
| `trackprice` | boolean | `false` |
| `transparency` | number | `0` |
| `color` | string | `#00897b` |
| `display` | number | `15` |
| `linestyle` | number | `0` |
| `linewidth` | number | `1` |
| `plottype` | boolean | `line` |
| `trackprice` | boolean | `false` |
| `transparency` | number | `0` |
| `color` | string | `#1e88e5` |
| `display` | number | `15` |
| `linestyle` | number | `0` |
| `linewidth` | number | `1` |
| `plottype` | boolean | `line` |
| `trackprice` | boolean | `false` |
| `transparency` | number | `0` |

### AnchoredvpLineToolOverrides  (`linetoolanchoredvp`)

| property | type | default |
|---|---|---|
| `graphics.hhists.histBars2.colors.0` | string | `undefined` |
| `graphics.hhists.histBars2.colors.1` | string | `undefined` |
| `graphics.hhists.histBars2.valuesColor` | string | `undefined` |
| `graphics.hhists.histBarsVA.colors.0` | string | `undefined` |
| `graphics.hhists.histBarsVA.colors.1` | string | `undefined` |
| `graphics.hhists.histBarsVA.valuesColor` | string | `undefined` |
| `graphics.horizlines.pocLines.color` | string | `undefined` |
| `graphics.horizlines.vahLines.color` | string | `undefined` |
| `graphics.horizlines.valLines.color` | string | `undefined` |
| `graphics.polygons.histBoxBg.color` | string | `undefined` |
| `styles.developingPoc.color` | string | `undefined` |
| `styles.developingVAHigh.color` | string | `undefined` |
| `styles.developingVALow.color` | string | `undefined` |

### AnchoredvwapLineToolOverrides  (`linetoolanchoredvwap`)

| property | type | default |
|---|---|---|
| `areaBackground.backgroundColor` | string | `#4caf50` |
| `areaBackground.fillBackground` | boolean | `true` |
| `areaBackground.transparency` | number | `95` |
| `filledAreasStyle.Background_1.color` | string | `#4caf50` |
| `filledAreasStyle.Background_1.transparency` | number | `95` |
| `filledAreasStyle.Background_1.visible` | boolean | `true` |
| `inputs.Bands Calculation Mode` | string | `Standard Deviation` |
| `inputs.bands_multiplier` | number | `1` |
| `inputs.bands_multiplier_2` | number | `2` |
| `inputs.bands_multiplier_3` | number | `3` |
| `inputs.calculate_stDev` | boolean | `true` |
| `inputs.calculate_stDev_2` | boolean | `false` |
| `inputs.calculate_stDev_3` | boolean | `false` |
| `inputs.source` | string | `hlc3` |
| `inputs.start_time` | number | `0` |
| `precision` | string | `default` |
| `styles.LowerBand.color` | string | `#4caf50` |
| `styles.LowerBand.display` | number | `15` |
| `styles.LowerBand.linestyle` | number | `0` |
| `styles.LowerBand.linewidth` | number | `1` |
| `styles.LowerBand.plottype` | number | `0` |
| `styles.LowerBand.trackPrice` | boolean | `false` |
| `styles.LowerBand.transparency` | number | `0` |
| `styles.LowerBand_2.color` | string | `#808000` |
| `styles.LowerBand_2.display` | number | `15` |
| `styles.LowerBand_2.linestyle` | number | `0` |
| `styles.LowerBand_2.linewidth` | number | `1` |
| `styles.LowerBand_2.plottype` | number | `0` |
| `styles.LowerBand_2.trackPrice` | boolean | `false` |
| `styles.LowerBand_2.transparency` | number | `0` |
| `styles.LowerBand_3.color` | string | `#00897b` |
| `styles.LowerBand_3.display` | number | `15` |
| `styles.LowerBand_3.linestyle` | number | `0` |
| `styles.LowerBand_3.linewidth` | number | `1` |
| `styles.LowerBand_3.plottype` | number | `0` |
| `styles.LowerBand_3.trackPrice` | boolean | `false` |
| `styles.LowerBand_3.transparency` | number | `0` |
| `styles.UpperBand.color` | string | `#4caf50` |
| `styles.UpperBand.display` | number | `15` |
| `styles.UpperBand.linestyle` | number | `0` |
| `styles.UpperBand.linewidth` | number | `1` |
| `styles.UpperBand.plottype` | number | `0` |
| `styles.UpperBand.trackPrice` | boolean | `false` |
| `styles.UpperBand.transparency` | number | `0` |
| `styles.UpperBand_2.color` | string | `#808000` |
| `styles.UpperBand_2.display` | number | `15` |
| `styles.UpperBand_2.linestyle` | number | `0` |
| `styles.UpperBand_2.linewidth` | number | `1` |
| `styles.UpperBand_2.plottype` | number | `0` |
| `styles.UpperBand_2.trackPrice` | boolean | `false` |
| `styles.UpperBand_2.transparency` | number | `0` |
| `styles.UpperBand_3.color` | string | `#00897b` |
| `styles.UpperBand_3.display` | number | `15` |
| `styles.UpperBand_3.linestyle` | number | `0` |
| `styles.UpperBand_3.linewidth` | number | `1` |
| `styles.UpperBand_3.plottype` | number | `0` |
| `styles.UpperBand_3.trackPrice` | boolean | `false` |
| `styles.UpperBand_3.transparency` | number | `0` |
| `styles.VWAP.color` | string | `#1e88e5` |
| `styles.VWAP.display` | number | `15` |
| `styles.VWAP.linestyle` | number | `0` |
| `styles.VWAP.linewidth` | number | `1` |
| `styles.VWAP.plottype` | number | `0` |
| `styles.VWAP.trackPrice` | boolean | `false` |
| `styles.VWAP.transparency` | number | `0` |

### ArcLineToolOverrides  (`linetoolarc`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(233, 30, 99, 0.2)` |
| `color` | string | `#e91e63` |
| `fillBackground` | boolean | `true` |
| `linewidth` | number | `2` |
| `transparency` | number | `80` |

### ArrowLineToolOverrides  (`linetoolarrow`)

| property | type | default |
|---|---|---|
| `alwaysShowStats` | boolean | `false` |
| `bold` | boolean | `false` |
| `extendLeft` | boolean | `false` |
| `extendRight` | boolean | `false` |
| `fontsize` | number | `14` |
| `horzLabelsAlign` | string | `center` |
| `italic` | boolean | `false` |
| `leftEnd` | number | `0` |
| `linecolor` | string | `#2962FF` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `rightEnd` | number | `1` |
| `showAngle` | boolean | `false` |
| `showBarsRange` | boolean | `false` |
| `showDateTimeRange` | boolean | `false` |
| `showDistance` | boolean | `false` |
| `showMiddlePoint` | boolean | `false` |
| `showPercentPriceRange` | boolean | `false` |
| `showPipsPriceRange` | boolean | `false` |
| `showPriceLabels` | boolean | `false` |
| `showPriceRange` | boolean | `false` |
| `statsPosition` | number | `2` |
| `textcolor` | string | `#2962FF` |
| `vertLabelsAlign` | string | `bottom` |

### ArrowmarkdownLineToolOverrides  (`linetoolarrowmarkdown`)

| property | type | default |
|---|---|---|
| `arrowColor` | string | `#CC2F3C` |
| `bold` | boolean | `false` |
| `color` | string | `#CC2F3C` |
| `fontsize` | number | `14` |
| `italic` | boolean | `false` |
| `showLabel` | boolean | `true` |

### ArrowmarkerLineToolOverrides  (`linetoolarrowmarker`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `#1E53E5` |
| `bold` | boolean | `true` |
| `fontsize` | number | `16` |
| `italic` | boolean | `false` |
| `textColor` | string | `#1E53E5` |

### ArrowmarkleftLineToolOverrides  (`linetoolarrowmarkleft`)

| property | type | default |
|---|---|---|
| `arrowColor` | string | `#2962FF` |
| `bold` | boolean | `false` |
| `color` | string | `#2962FF` |
| `fontsize` | number | `14` |
| `italic` | boolean | `false` |
| `showLabel` | boolean | `true` |

### ArrowmarkrightLineToolOverrides  (`linetoolarrowmarkright`)

| property | type | default |
|---|---|---|
| `arrowColor` | string | `#2962FF` |
| `bold` | boolean | `false` |
| `color` | string | `#2962FF` |
| `fontsize` | number | `14` |
| `italic` | boolean | `false` |
| `showLabel` | boolean | `true` |

### ArrowmarkupLineToolOverrides  (`linetoolarrowmarkup`)

| property | type | default |
|---|---|---|
| `arrowColor` | string | `#089981` |
| `bold` | boolean | `false` |
| `color` | string | `#089981` |
| `fontsize` | number | `14` |
| `italic` | boolean | `false` |
| `showLabel` | boolean | `true` |

### BalloonLineToolOverrides  (`linetoolballoon`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(156, 39, 176, 0.7)` |
| `borderColor` | string | `rgba(156, 39, 176, 0)` |
| `color` | string | `#ffffff` |
| `fontsize` | number | `14` |
| `transparency` | number | `30` |

### BarspatternLineToolOverrides  (`linetoolbarspattern`)

| property | type | default |
|---|---|---|
| `color` | string | `#2962FF` |
| `flipped` | boolean | `false` |
| `mirrored` | boolean | `false` |
| `mode` | number | `0` |

### BeziercubicLineToolOverrides  (`linetoolbeziercubic`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(103, 58, 183, 0.2)` |
| `extendLeft` | boolean | `false` |
| `extendRight` | boolean | `false` |
| `fillBackground` | boolean | `false` |
| `leftEnd` | number | `0` |
| `linecolor` | string | `#673ab7` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `rightEnd` | number | `0` |
| `transparency` | number | `80` |

### BezierquadroLineToolOverrides  (`linetoolbezierquadro`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(41, 98, 255, 0.2)` |
| `extendLeft` | boolean | `false` |
| `extendRight` | boolean | `false` |
| `fillBackground` | boolean | `false` |
| `leftEnd` | number | `0` |
| `linecolor` | string | `#2962FF` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `rightEnd` | number | `0` |
| `transparency` | number | `50` |

### BrushLineToolOverrides  (`linetoolbrush`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `#00bcd4` |
| `fillBackground` | boolean | `false` |
| `leftEnd` | number | `0` |
| `linecolor` | string | `#00bcd4` |
| `linewidth` | number | `2` |
| `rightEnd` | number | `0` |
| `smooth` | number | `5` |
| `transparency` | number | `50` |

### CalloutLineToolOverrides  (`linetoolcallout`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(0, 151, 167, 0.7)` |
| `bold` | boolean | `false` |
| `bordercolor` | string | `#0097A7` |
| `color` | string | `#ffffff` |
| `fontsize` | number | `14` |
| `italic` | boolean | `false` |
| `linewidth` | number | `2` |
| `transparency` | number | `50` |
| `wordWrap` | boolean | `false` |
| `wordWrapWidth` | number | `200` |

### CircleLineToolOverrides  (`linetoolcircle`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(255, 152, 0, 0.2)` |
| `bold` | boolean | `false` |
| `color` | string | `#FF9800` |
| `fillBackground` | boolean | `true` |
| `fontSize` | number | `14` |
| `italic` | boolean | `false` |
| `linewidth` | number | `2` |
| `textColor` | string | `#FF9800` |

### CirclelinesLineToolOverrides  (`linetoolcirclelines`)

| property | type | default |
|---|---|---|
| `linecolor` |  | `#80ccdb` |
| `linestyle` |  | `0` |
| `linewidth` |  | `1` |
| `trendline.color` |  | `#808080` |
| `trendline.linestyle` |  | `2` |
| `trendline.linewidth` |  | `1` |
| `trendline.visible` |  | `true` |

### CommentLineToolOverrides  (`linetoolcomment`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `#2962FF` |
| `borderColor` | string | `#2962FF` |
| `color` | string | `#ffffff` |
| `fontsize` | number | `16` |
| `transparency` | number | `0` |

### CrosslineLineToolOverrides  (`linetoolcrossline`)

| property | type | default |
|---|---|---|
| `linecolor` | string | `#2962FF` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `showPrice` | boolean | `true` |
| `showTime` | boolean | `true` |

### CypherpatternLineToolOverrides  (`linetoolcypherpattern`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `#2962FF` |
| `bold` | boolean | `false` |
| `color` | string | `#2962FF` |
| `fillBackground` | boolean | `true` |
| `fontsize` | number | `12` |
| `italic` | boolean | `false` |
| `linewidth` | number | `2` |
| `textcolor` | string | `#ffffff` |
| `transparency` | number | `85` |

### DateandpricerangeLineToolOverrides  (`linetooldateandpricerange`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `#2962FF` |
| `backgroundTransparency` | number | `60` |
| `borderColor` | string | `#2962FF` |
| `borderWidth` | number | `1` |
| `customText.bold` | boolean | `false` |
| `customText.color` | string | `#2962FF` |
| `customText.fontsize` | number | `12` |
| `customText.italic` | boolean | `false` |
| `customText.visible` | boolean | `false` |
| `drawBorder` | boolean | `false` |
| `extendBottom` | boolean | `false` |
| `extendTop` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `fillLabelBackground` | boolean | `true` |
| `fontsize` | number | `12` |
| `labelBackgroundColor` | string | `#585858` |
| `linecolor` | string | `#2962FF` |
| `linewidth` | number | `2` |
| `shadow` | string | `rgba(0, 0, 0, 0.2)` |
| `showBarsRange` | boolean | `true` |
| `showDateTimeRange` | boolean | `true` |
| `showPercentPriceRange` | boolean | `true` |
| `showPipsPriceRange` | boolean | `true` |
| `showPriceRange` | boolean | `true` |
| `showVolume` | boolean | `true` |
| `textColor` | string | `#000000` |

### DaterangeLineToolOverrides  (`linetooldaterange`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `#2962FF` |
| `backgroundTransparency` | number | `60` |
| `customText.bold` | boolean | `false` |
| `customText.color` | string | `#2962FF` |
| `customText.fontsize` | number | `12` |
| `customText.italic` | boolean | `false` |
| `customText.visible` | boolean | `false` |
| `extendBottom` | boolean | `false` |
| `extendTop` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `fillLabelBackground` | boolean | `true` |
| `fontsize` | number | `12` |
| `labelBackgroundColor` | string | `#585858` |
| `linecolor` | string | `#2962FF` |
| `linewidth` | number | `2` |
| `shadow` | string | `rgba(0, 0, 0, 0.2)` |
| `showBarsRange` | boolean | `true` |
| `showDateTimeRange` | boolean | `true` |
| `showVolume` | boolean | `true` |
| `textColor` | string | `#000000` |

### DisjointangleLineToolOverrides  (`linetooldisjointangle`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(8, 153, 129, 0.2)` |
| `bold` | boolean | `false` |
| `extendLeft` | boolean | `false` |
| `extendRight` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `fontsize` | number | `12` |
| `italic` | boolean | `false` |
| `labelBold` | boolean | `false` |
| `labelFontSize` | number | `14` |
| `labelHorzAlign` | string | `left` |
| `labelItalic` | boolean | `false` |
| `labelTextColor` | string | `#089981` |
| `labelVertAlign` | string | `bottom` |
| `labelVisible` | boolean | `false` |
| `leftEnd` | number | `0` |
| `linecolor` | string | `#089981` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `rightEnd` | number | `0` |
| `showBarsRange` | boolean | `false` |
| `showDateTimeRange` | boolean | `false` |
| `showPriceRange` | boolean | `false` |
| `showPrices` | boolean | `false` |
| `textcolor` | string | `#089981` |
| `transparency` | number | `20` |

### ElliottcorrectionLineToolOverrides  (`linetoolelliottcorrection`)

| property | type | default |
|---|---|---|
| `color` | string | `#3d85c6` |
| `degree` | number | `7` |
| `linewidth` | number | `2` |
| `showWave` | boolean | `true` |

### ElliottdoublecomboLineToolOverrides  (`linetoolelliottdoublecombo`)

| property | type | default |
|---|---|---|
| `color` | string | `#6aa84f` |
| `degree` | number | `7` |
| `linewidth` | number | `2` |
| `showWave` | boolean | `true` |

### ElliottimpulseLineToolOverrides  (`linetoolelliottimpulse`)

| property | type | default |
|---|---|---|
| `color` | string | `#3d85c6` |
| `degree` | number | `7` |
| `linewidth` | number | `2` |
| `showWave` | boolean | `true` |

### ElliotttriangleLineToolOverrides  (`linetoolelliotttriangle`)

| property | type | default |
|---|---|---|
| `color` | string | `#FF9800` |
| `degree` | number | `7` |
| `linewidth` | number | `2` |
| `showWave` | boolean | `true` |

### ElliotttriplecomboLineToolOverrides  (`linetoolelliotttriplecombo`)

| property | type | default |
|---|---|---|
| `color` | string | `#6aa84f` |
| `degree` | number | `7` |
| `linewidth` | number | `2` |
| `showWave` | boolean | `true` |

### EllipseLineToolOverrides  (`linetoolellipse`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(242, 54, 69, 0.2)` |
| `bold` | boolean | `false` |
| `color` | string | `#F23645` |
| `fillBackground` | boolean | `true` |
| `fontSize` | number | `14` |
| `italic` | boolean | `false` |
| `linewidth` | number | `2` |
| `textColor` | string | `#F23645` |
| `transparency` | number | `50` |

### EmojiLineToolOverrides  (`linetoolemoji`)

| property | type | default |
|---|---|---|
| `angle` | number | `1.5707963267948966` |
| `size` | number | `40` |

### ExecutionLineToolOverrides  (`linetoolexecution`)

| property | type | default |
|---|---|---|
| `arrowBuyColor` | string | `#4094e8` |
| `arrowHeight` | number | `8` |
| `arrowSellColor` | string | `#e75656` |
| `arrowSpacing` | number | `1` |
| `direction` | string | `buy` |
| `fontBold` | boolean | `false` |
| `fontFamily` | string | `Verdana` |
| `fontItalic` | boolean | `false` |
| `fontSize` | number | `10` |
| `text` | string | `undefined` |
| `textColor` | string | `#000000` |
| `textTransparency` | number | `0` |
| `tooltip` | string | `undefined` |

### ExtendedLineToolOverrides  (`linetoolextended`)

| property | type | default |
|---|---|---|
| `alwaysShowStats` | boolean | `false` |
| `bold` | boolean | `false` |
| `extendLeft` | boolean | `true` |
| `extendRight` | boolean | `true` |
| `fontsize` | number | `14` |
| `horzLabelsAlign` | string | `center` |
| `italic` | boolean | `false` |
| `leftEnd` | number | `0` |
| `linecolor` | string | `#2962FF` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `rightEnd` | number | `0` |
| `showAngle` | boolean | `false` |
| `showBarsRange` | boolean | `false` |
| `showDateTimeRange` | boolean | `false` |
| `showDistance` | boolean | `false` |
| `showMiddlePoint` | boolean | `false` |
| `showPercentPriceRange` | boolean | `false` |
| `showPipsPriceRange` | boolean | `false` |
| `showPriceLabels` | boolean | `false` |
| `showPriceRange` | boolean | `false` |
| `statsPosition` | number | `2` |
| `textcolor` | string | `#2962FF` |
| `vertLabelsAlign` | string | `bottom` |

### FibchannelLineToolOverrides  (`linetoolfibchannel`)

| property | type | default |
|---|---|---|
| `coeffsAsPercents` | boolean | `false` |
| `extendLeft` | boolean | `false` |
| `extendRight` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `horzLabelsAlign` | string | `left` |
| `labelFontSize` | number | `12` |
| `level1.coeff` | number | `0` |
| `level1.color` | string | `#808080` |
| `level1.visible` | boolean | `true` |
| `level10.coeff` | number | `3.618` |
| `level10.color` | string | `#9c27b0` |
| `level10.visible` | boolean | `true` |
| `level11.coeff` | number | `4.236` |
| `level11.color` | string | `#e91e63` |
| `level11.visible` | boolean | `true` |
| `level12.coeff` | number | `1.272` |
| `level12.color` | string | `#FF9800` |
| `level12.visible` | boolean | `false` |
| `level13.coeff` | number | `1.414` |
| `level13.color` | string | `#F23645` |
| `level13.visible` | boolean | `false` |
| `level14.coeff` | number | `2.272` |
| `level14.color` | string | `#FF9800` |
| `level14.visible` | boolean | `false` |
| `level15.coeff` | number | `2.414` |
| `level15.color` | string | `#4caf50` |
| `level15.visible` | boolean | `false` |
| `level16.coeff` | number | `2` |
| `level16.color` | string | `#089981` |
| `level16.visible` | boolean | `false` |
| `level17.coeff` | number | `3` |
| `level17.color` | string | `#00bcd4` |
| `level17.visible` | boolean | `false` |
| `level18.coeff` | number | `3.272` |
| `level18.color` | string | `#808080` |
| `level18.visible` | boolean | `false` |
| `level19.coeff` | number | `3.414` |
| `level19.color` | string | `#2962FF` |
| `level19.visible` | boolean | `false` |
| `level2.coeff` | number | `0.236` |
| `level2.color` | string | `#F23645` |
| `level2.visible` | boolean | `true` |
| `level20.coeff` | number | `4` |
| `level20.color` | string | `#F23645` |
| `level20.visible` | boolean | `false` |
| `level21.coeff` | number | `4.272` |
| `level21.color` | string | `#9c27b0` |
| `level21.visible` | boolean | `false` |
| `level22.coeff` | number | `4.414` |
| `level22.color` | string | `#e91e63` |
| `level22.visible` | boolean | `false` |
| `level23.coeff` | number | `4.618` |
| `level23.color` | string | `#FF9800` |
| `level23.visible` | boolean | `false` |
| `level24.coeff` | number | `4.764` |
| `level24.color` | string | `#089981` |
| `level24.visible` | boolean | `false` |
| `level3.coeff` | number | `0.382` |
| `level3.color` | string | `#FF9800` |
| `level3.visible` | boolean | `true` |
| `level4.coeff` | number | `0.5` |
| `level4.color` | string | `#4caf50` |
| `level4.visible` | boolean | `true` |
| `level5.coeff` | number | `0.618` |
| `level5.color` | string | `#089981` |
| `level5.visible` | boolean | `true` |
| `level6.coeff` | number | `0.786` |
| `level6.color` | string | `#00bcd4` |
| `level6.visible` | boolean | `true` |
| `level7.coeff` | number | `1` |
| `level7.color` | string | `#808080` |
| `level7.visible` | boolean | `true` |
| `level8.coeff` | number | `1.618` |
| `level8.color` | string | `#2962FF` |
| `level8.visible` | boolean | `true` |
| `level9.coeff` | number | `2.618` |
| `level9.color` | string | `#F23645` |
| `level9.visible` | boolean | `true` |
| `levelsStyle.linestyle` | number | `0` |
| `levelsStyle.linewidth` | number | `2` |
| `showCoeffs` | boolean | `true` |
| `showPrices` | boolean | `true` |
| `transparency` | number | `80` |
| `vertLabelsAlign` | string | `middle` |

### FibcirclesLineToolOverrides  (`linetoolfibcircles`)

| property | type | default |
|---|---|---|
| `coeffsAsPercents` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `level1.coeff` | number | `0.236` |
| `level1.color` | string | `#F23645` |
| `level1.linestyle` | number | `0` |
| `level1.linewidth` | number | `2` |
| `level1.visible` | boolean | `true` |
| `level10.coeff` | number | `4.236` |
| `level10.color` | string | `#e91e63` |
| `level10.linestyle` | number | `0` |
| `level10.linewidth` | number | `2` |
| `level10.visible` | boolean | `true` |
| `level11.coeff` | number | `4.618` |
| `level11.color` | string | `#F23645` |
| `level11.linestyle` | number | `0` |
| `level11.linewidth` | number | `2` |
| `level11.visible` | boolean | `true` |
| `level2.coeff` | number | `0.382` |
| `level2.color` | string | `#FF9800` |
| `level2.linestyle` | number | `0` |
| `level2.linewidth` | number | `2` |
| `level2.visible` | boolean | `true` |
| `level3.coeff` | number | `0.5` |
| `level3.color` | string | `#089981` |
| `level3.linestyle` | number | `0` |
| `level3.linewidth` | number | `2` |
| `level3.visible` | boolean | `true` |
| `level4.coeff` | number | `0.618` |
| `level4.color` | string | `#4caf50` |
| `level4.linestyle` | number | `0` |
| `level4.linewidth` | number | `2` |
| `level4.visible` | boolean | `true` |
| `level5.coeff` | number | `0.786` |
| `level5.color` | string | `#00bcd4` |
| `level5.linestyle` | number | `0` |
| `level5.linewidth` | number | `2` |
| `level5.visible` | boolean | `true` |
| `level6.coeff` | number | `1` |
| `level6.color` | string | `#808080` |
| `level6.linestyle` | number | `0` |
| `level6.linewidth` | number | `2` |
| `level6.visible` | boolean | `true` |
| `level7.coeff` | number | `1.618` |
| `level7.color` | string | `#2962FF` |
| `level7.linestyle` | number | `0` |
| `level7.linewidth` | number | `2` |
| `level7.visible` | boolean | `true` |
| `level8.coeff` | number | `2.618` |
| `level8.color` | string | `#e91e63` |
| `level8.linestyle` | number | `0` |
| `level8.linewidth` | number | `2` |
| `level8.visible` | boolean | `true` |
| `level9.coeff` | number | `3.618` |
| `level9.color` | string | `#2962FF` |
| `level9.linestyle` | number | `0` |
| `level9.linewidth` | number | `2` |
| `level9.visible` | boolean | `true` |
| `showCoeffs` | boolean | `true` |
| `transparency` | number | `80` |
| `trendline.color` | string | `#808080` |
| `trendline.linestyle` | number | `2` |
| `trendline.linewidth` | number | `2` |
| `trendline.visible` | boolean | `true` |

### FibretracementLineToolOverrides  (`linetoolfibretracement`)

| property | type | default |
|---|---|---|
| `coeffsAsPercents` | boolean | `false` |
| `extendLines` | boolean | `false` |
| `extendLinesLeft` | boolean | `false` |
| `fibLevelsBasedOnLogScale` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `horzLabelsAlign` | string | `left` |
| `horzTextAlign` | string | `center` |
| `labelFontSize` | number | `12` |
| `level1.coeff` | number | `0` |
| `level1.color` | string | `#808080` |
| `level1.text` | string | `undefined` |
| `level1.visible` | boolean | `true` |
| `level10.coeff` | number | `3.618` |
| `level10.color` | string | `#9c27b0` |
| `level10.text` | string | `undefined` |
| `level10.visible` | boolean | `true` |
| `level11.coeff` | number | `4.236` |
| `level11.color` | string | `#e91e63` |
| `level11.text` | string | `undefined` |
| `level11.visible` | boolean | `true` |
| `level12.coeff` | number | `1.272` |
| `level12.color` | string | `#FF9800` |
| `level12.text` | string | `undefined` |
| `level12.visible` | boolean | `false` |
| `level13.coeff` | number | `1.414` |
| `level13.color` | string | `#F23645` |
| `level13.text` | string | `undefined` |
| `level13.visible` | boolean | `false` |
| `level14.coeff` | number | `2.272` |
| `level14.color` | string | `#FF9800` |
| `level14.text` | string | `undefined` |
| `level14.visible` | boolean | `false` |
| `level15.coeff` | number | `2.414` |
| `level15.color` | string | `#4caf50` |
| `level15.text` | string | `undefined` |
| `level15.visible` | boolean | `false` |
| `level16.coeff` | number | `2` |
| `level16.color` | string | `#089981` |
| `level16.text` | string | `undefined` |
| `level16.visible` | boolean | `false` |
| `level17.coeff` | number | `3` |
| `level17.color` | string | `#00bcd4` |
| `level17.text` | string | `undefined` |
| `level17.visible` | boolean | `false` |
| `level18.coeff` | number | `3.272` |
| `level18.color` | string | `#808080` |
| `level18.text` | string | `undefined` |
| `level18.visible` | boolean | `false` |
| `level19.coeff` | number | `3.414` |
| `level19.color` | string | `#2962FF` |
| `level19.text` | string | `undefined` |
| `level19.visible` | boolean | `false` |
| `level2.coeff` | number | `0.236` |
| `level2.color` | string | `#F23645` |
| `level2.text` | string | `undefined` |
| `level2.visible` | boolean | `true` |
| `level20.coeff` | number | `4` |
| `level20.color` | string | `#F23645` |
| `level20.text` | string | `undefined` |
| `level20.visible` | boolean | `false` |
| `level21.coeff` | number | `4.272` |
| `level21.color` | string | `#9c27b0` |
| `level21.text` | string | `undefined` |
| `level21.visible` | boolean | `false` |
| `level22.coeff` | number | `4.414` |
| `level22.color` | string | `#e91e63` |
| `level22.text` | string | `undefined` |
| `level22.visible` | boolean | `false` |
| `level23.coeff` | number | `4.618` |
| `level23.color` | string | `#FF9800` |
| `level23.text` | string | `undefined` |
| `level23.visible` | boolean | `false` |
| `level24.coeff` | number | `4.764` |
| `level24.color` | string | `#089981` |
| `level24.text` | string | `undefined` |
| `level24.visible` | boolean | `false` |
| `level3.coeff` | number | `0.382` |
| `level3.color` | string | `#FF9800` |
| `level3.text` | string | `undefined` |
| `level3.visible` | boolean | `true` |
| `level4.coeff` | number | `0.5` |
| `level4.color` | string | `#4caf50` |
| `level4.text` | string | `undefined` |
| `level4.visible` | boolean | `true` |
| `level5.coeff` | number | `0.618` |
| `level5.color` | string | `#089981` |
| `level5.text` | string | `undefined` |
| `level5.visible` | boolean | `true` |
| `level6.coeff` | number | `0.786` |
| `level6.color` | string | `#00bcd4` |
| `level6.text` | string | `undefined` |
| `level6.visible` | boolean | `true` |
| `level7.coeff` | number | `1` |
| `level7.color` | string | `#808080` |
| `level7.text` | string | `undefined` |
| `level7.visible` | boolean | `true` |
| `level8.coeff` | number | `1.618` |
| `level8.color` | string | `#2962FF` |
| `level8.text` | string | `undefined` |
| `level8.visible` | boolean | `true` |
| `level9.coeff` | number | `2.618` |
| `level9.color` | string | `#F23645` |
| `level9.text` | string | `undefined` |
| `level9.visible` | boolean | `true` |
| `levelsStyle.linestyle` | number | `0` |
| `levelsStyle.linewidth` | number | `2` |
| `reverse` | boolean | `false` |
| `showCoeffs` | boolean | `true` |
| `showPrices` | boolean | `true` |
| `showText` | boolean | `true` |
| `transparency` | number | `80` |
| `trendline.color` | string | `#808080` |
| `trendline.linestyle` | number | `2` |
| `trendline.linewidth` | number | `2` |
| `trendline.visible` | boolean | `true` |
| `vertLabelsAlign` | string | `middle` |
| `vertTextAlign` | string | `middle` |

### FibspeedresistancearcsLineToolOverrides  (`linetoolfibspeedresistancearcs`)

| property | type | default |
|---|---|---|
| `fillBackground` | boolean | `true` |
| `fullCircles` | boolean | `false` |
| `level1.coeff` | number | `0.236` |
| `level1.color` | string | `#F23645` |
| `level1.linestyle` | number | `0` |
| `level1.linewidth` | number | `2` |
| `level1.visible` | boolean | `true` |
| `level10.coeff` | number | `4.236` |
| `level10.color` | string | `#e91e63` |
| `level10.linestyle` | number | `0` |
| `level10.linewidth` | number | `2` |
| `level10.visible` | boolean | `true` |
| `level11.coeff` | number | `4.618` |
| `level11.color` | string | `#F23645` |
| `level11.linestyle` | number | `0` |
| `level11.linewidth` | number | `2` |
| `level11.visible` | boolean | `true` |
| `level2.coeff` | number | `0.382` |
| `level2.color` | string | `#FF9800` |
| `level2.linestyle` | number | `0` |
| `level2.linewidth` | number | `2` |
| `level2.visible` | boolean | `true` |
| `level3.coeff` | number | `0.5` |
| `level3.color` | string | `#089981` |
| `level3.linestyle` | number | `0` |
| `level3.linewidth` | number | `2` |
| `level3.visible` | boolean | `true` |
| `level4.coeff` | number | `0.618` |
| `level4.color` | string | `#4caf50` |
| `level4.linestyle` | number | `0` |
| `level4.linewidth` | number | `2` |
| `level4.visible` | boolean | `true` |
| `level5.coeff` | number | `0.786` |
| `level5.color` | string | `#00bcd4` |
| `level5.linestyle` | number | `0` |
| `level5.linewidth` | number | `2` |
| `level5.visible` | boolean | `true` |
| `level6.coeff` | number | `1` |
| `level6.color` | string | `#808080` |
| `level6.linestyle` | number | `0` |
| `level6.linewidth` | number | `2` |
| `level6.visible` | boolean | `true` |
| `level7.coeff` | number | `1.618` |
| `level7.color` | string | `#2962FF` |
| `level7.linestyle` | number | `0` |
| `level7.linewidth` | number | `2` |
| `level7.visible` | boolean | `true` |
| `level8.coeff` | number | `2.618` |
| `level8.color` | string | `#e91e63` |
| `level8.linestyle` | number | `0` |
| `level8.linewidth` | number | `2` |
| `level8.visible` | boolean | `true` |
| `level9.coeff` | number | `3.618` |
| `level9.color` | string | `#2962FF` |
| `level9.linestyle` | number | `0` |
| `level9.linewidth` | number | `2` |
| `level9.visible` | boolean | `true` |
| `showCoeffs` | boolean | `true` |
| `transparency` | number | `80` |
| `trendline.color` | string | `#808080` |
| `trendline.linestyle` | number | `2` |
| `trendline.linewidth` | number | `2` |
| `trendline.visible` | boolean | `true` |

### FibspeedresistancefanLineToolOverrides  (`linetoolfibspeedresistancefan`)

| property | type | default |
|---|---|---|
| `fillBackground` | boolean | `true` |
| `grid.color` | string | `rgba(21, 56, 153, 0.8)` |
| `grid.linestyle` | number | `0` |
| `grid.linewidth` | number | `1` |
| `grid.visible` | boolean | `true` |
| `hlevel1.coeff` | number | `0` |
| `hlevel1.color` | string | `#808080` |
| `hlevel1.visible` | boolean | `true` |
| `hlevel2.coeff` | number | `0.25` |
| `hlevel2.color` | string | `#FF9800` |
| `hlevel2.visible` | boolean | `true` |
| `hlevel3.coeff` | number | `0.382` |
| `hlevel3.color` | string | `#00bcd4` |
| `hlevel3.visible` | boolean | `true` |
| `hlevel4.coeff` | number | `0.5` |
| `hlevel4.color` | string | `#4caf50` |
| `hlevel4.visible` | boolean | `true` |
| `hlevel5.coeff` | number | `0.618` |
| `hlevel5.color` | string | `#089981` |
| `hlevel5.visible` | boolean | `true` |
| `hlevel6.coeff` | number | `0.75` |
| `hlevel6.color` | string | `#2962FF` |
| `hlevel6.visible` | boolean | `true` |
| `hlevel7.coeff` | number | `1` |
| `hlevel7.color` | string | `#808080` |
| `hlevel7.visible` | boolean | `true` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `reverse` | boolean | `false` |
| `showBottomLabels` | boolean | `true` |
| `showLeftLabels` | boolean | `true` |
| `showRightLabels` | boolean | `true` |
| `showTopLabels` | boolean | `true` |
| `transparency` | number | `80` |
| `vlevel1.coeff` | number | `0` |
| `vlevel1.color` | string | `#808080` |
| `vlevel1.visible` | boolean | `true` |
| `vlevel2.coeff` | number | `0.25` |
| `vlevel2.color` | string | `#FF9800` |
| `vlevel2.visible` | boolean | `true` |
| `vlevel3.coeff` | number | `0.382` |
| `vlevel3.color` | string | `#00bcd4` |
| `vlevel3.visible` | boolean | `true` |
| `vlevel4.coeff` | number | `0.5` |
| `vlevel4.color` | string | `#4caf50` |
| `vlevel4.visible` | boolean | `true` |
| `vlevel5.coeff` | number | `0.618` |
| `vlevel5.color` | string | `#089981` |
| `vlevel5.visible` | boolean | `true` |
| `vlevel6.coeff` | number | `0.75` |
| `vlevel6.color` | string | `#2962FF` |
| `vlevel6.visible` | boolean | `true` |
| `vlevel7.coeff` | number | `1` |
| `vlevel7.color` | string | `#808080` |
| `vlevel7.visible` | boolean | `true` |

### FibspiralLineToolOverrides  (`linetoolfibspiral`)

| property | type | default |
|---|---|---|
| `counterclockwise` |  | `false` |
| `linecolor` |  | `#00bcd4` |
| `linestyle` |  | `0` |
| `linewidth` |  | `1` |

### FibtimezoneLineToolOverrides  (`linetoolfibtimezone`)

| property | type | default |
|---|---|---|
| `fillBackground` | boolean | `false` |
| `horzLabelsAlign` | string | `right` |
| `level1.coeff` | number | `0` |
| `level1.color` | string | `#808080` |
| `level1.linestyle` | number | `0` |
| `level1.linewidth` | number | `2` |
| `level1.visible` | boolean | `true` |
| `level10.coeff` | number | `55` |
| `level10.color` | string | `#2962FF` |
| `level10.linestyle` | number | `0` |
| `level10.linewidth` | number | `2` |
| `level10.visible` | boolean | `true` |
| `level11.coeff` | number | `89` |
| `level11.color` | string | `#2962FF` |
| `level11.linestyle` | number | `0` |
| `level11.linewidth` | number | `2` |
| `level11.visible` | boolean | `true` |
| `level2.coeff` | number | `1` |
| `level2.color` | string | `#2962FF` |
| `level2.linestyle` | number | `0` |
| `level2.linewidth` | number | `2` |
| `level2.visible` | boolean | `true` |
| `level3.coeff` | number | `2` |
| `level3.color` | string | `#2962FF` |
| `level3.linestyle` | number | `0` |
| `level3.linewidth` | number | `2` |
| `level3.visible` | boolean | `true` |
| `level4.coeff` | number | `3` |
| `level4.color` | string | `#2962FF` |
| `level4.linestyle` | number | `0` |
| `level4.linewidth` | number | `2` |
| `level4.visible` | boolean | `true` |
| `level5.coeff` | number | `5` |
| `level5.color` | string | `#2962FF` |
| `level5.linestyle` | number | `0` |
| `level5.linewidth` | number | `2` |
| `level5.visible` | boolean | `true` |
| `level6.coeff` | number | `8` |
| `level6.color` | string | `#2962FF` |
| `level6.linestyle` | number | `0` |
| `level6.linewidth` | number | `2` |
| `level6.visible` | boolean | `true` |
| `level7.coeff` | number | `13` |
| `level7.color` | string | `#2962FF` |
| `level7.linestyle` | number | `0` |
| `level7.linewidth` | number | `2` |
| `level7.visible` | boolean | `true` |
| `level8.coeff` | number | `21` |
| `level8.color` | string | `#2962FF` |
| `level8.linestyle` | number | `0` |
| `level8.linewidth` | number | `2` |
| `level8.visible` | boolean | `true` |
| `level9.coeff` | number | `34` |
| `level9.color` | string | `#2962FF` |
| `level9.linestyle` | number | `0` |
| `level9.linewidth` | number | `2` |
| `level9.visible` | boolean | `true` |
| `showLabels` | boolean | `true` |
| `transparency` | number | `80` |
| `trendline.color` | string | `#808080` |
| `trendline.linestyle` | number | `2` |
| `trendline.linewidth` | number | `1` |
| `trendline.visible` | boolean | `true` |
| `vertLabelsAlign` | string | `bottom` |

### FibwedgeLineToolOverrides  (`linetoolfibwedge`)

| property | type | default |
|---|---|---|
| `fillBackground` | boolean | `true` |
| `level1.coeff` | number | `0.236` |
| `level1.color` | string | `#F23645` |
| `level1.linestyle` | number | `0` |
| `level1.linewidth` | number | `2` |
| `level1.visible` | boolean | `true` |
| `level10.coeff` | number | `4.236` |
| `level10.color` | string | `#e91e63` |
| `level10.linestyle` | number | `0` |
| `level10.linewidth` | number | `2` |
| `level10.visible` | boolean | `false` |
| `level11.coeff` | number | `4.618` |
| `level11.color` | string | `#e91e63` |
| `level11.linestyle` | number | `0` |
| `level11.linewidth` | number | `2` |
| `level11.visible` | boolean | `false` |
| `level2.coeff` | number | `0.382` |
| `level2.color` | string | `#FF9800` |
| `level2.linestyle` | number | `0` |
| `level2.linewidth` | number | `2` |
| `level2.visible` | boolean | `true` |
| `level3.coeff` | number | `0.5` |
| `level3.color` | string | `#4caf50` |
| `level3.linestyle` | number | `0` |
| `level3.linewidth` | number | `2` |
| `level3.visible` | boolean | `true` |
| `level4.coeff` | number | `0.618` |
| `level4.color` | string | `#089981` |
| `level4.linestyle` | number | `0` |
| `level4.linewidth` | number | `2` |
| `level4.visible` | boolean | `true` |
| `level5.coeff` | number | `0.786` |
| `level5.color` | string | `#00bcd4` |
| `level5.linestyle` | number | `0` |
| `level5.linewidth` | number | `2` |
| `level5.visible` | boolean | `true` |
| `level6.coeff` | number | `1` |
| `level6.color` | string | `#808080` |
| `level6.linestyle` | number | `0` |
| `level6.linewidth` | number | `2` |
| `level6.visible` | boolean | `true` |
| `level7.coeff` | number | `1.618` |
| `level7.color` | string | `#2962FF` |
| `level7.linestyle` | number | `0` |
| `level7.linewidth` | number | `2` |
| `level7.visible` | boolean | `false` |
| `level8.coeff` | number | `2.618` |
| `level8.color` | string | `#F23645` |
| `level8.linestyle` | number | `0` |
| `level8.linewidth` | number | `2` |
| `level8.visible` | boolean | `false` |
| `level9.coeff` | number | `3.618` |
| `level9.color` | string | `#673ab7` |
| `level9.linestyle` | number | `0` |
| `level9.linewidth` | number | `2` |
| `level9.visible` | boolean | `false` |
| `showCoeffs` | boolean | `true` |
| `transparency` | number | `80` |
| `trendline.color` | string | `#808080` |
| `trendline.linestyle` | number | `0` |
| `trendline.linewidth` | number | `2` |
| `trendline.visible` | boolean | `true` |

### FivepointspatternLineToolOverrides  (`linetool5pointspattern`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `#2962FF` |
| `bold` | boolean | `false` |
| `color` | string | `#2962FF` |
| `fillBackground` | boolean | `true` |
| `fontsize` | number | `12` |
| `italic` | boolean | `false` |
| `linewidth` | number | `2` |
| `textcolor` | string | `#ffffff` |
| `transparency` | number | `85` |

### FixedRangeIndicatorOverrides  (`developing poc`)

| property | type | default |
|---|---|---|
| `color` | string | `undefined` |
| `display` | number | `0` |
| `linestyle` | number | `0` |
| `linewidth` | number | `1` |
| `plottype` | boolean | `step_line` |
| `trackprice` | boolean | `false` |
| `transparency` | number | `0` |
| `color` | string | `undefined` |
| `display` | number | `0` |
| `linestyle` | number | `0` |
| `linewidth` | number | `1` |
| `plottype` | boolean | `step_line` |
| `trackprice` | boolean | `false` |
| `transparency` | number | `0` |
| `color` | string | `undefined` |
| `display` | number | `0` |
| `linestyle` | number | `0` |
| `linewidth` | number | `1` |
| `plottype` | boolean | `step_line` |
| `trackprice` | boolean | `false` |
| `transparency` | number | `0` |

### FlagmarkLineToolOverrides  (`linetoolflagmark`)

| property | type | default |
|---|---|---|
| `flagColor` | string | `#2962FF` |

### FlatbottomLineToolOverrides  (`linetoolflatbottom`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(255, 152, 0, 0.2)` |
| `bold` | boolean | `false` |
| `extendLeft` | boolean | `false` |
| `extendRight` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `fontsize` | number | `12` |
| `italic` | boolean | `false` |
| `labelBold` | boolean | `false` |
| `labelFontSize` | number | `14` |
| `labelHorzAlign` | string | `left` |
| `labelItalic` | boolean | `false` |
| `labelTextColor` | string | `#FF9800` |
| `labelVertAlign` | string | `bottom` |
| `labelVisible` | boolean | `false` |
| `leftEnd` | number | `0` |
| `linecolor` | string | `#FF9800` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `rightEnd` | number | `0` |
| `showBarsRange` | boolean | `false` |
| `showDateTimeRange` | boolean | `false` |
| `showPriceRange` | boolean | `false` |
| `showPrices` | boolean | `false` |
| `textcolor` | string | `#FF9800` |
| `transparency` | number | `20` |

### GanncomplexLineToolOverrides  (`linetoolganncomplex`)

| property | type | default |
|---|---|---|
| `arcs.0.color` | string | `#FF9800` |
| `arcs.0.visible` | boolean | `true` |
| `arcs.0.width` | number | `2` |
| `arcs.0.x` | number | `1` |
| `arcs.0.y` | number | `0` |
| `arcs.1.color` | string | `#FF9800` |
| `arcs.1.visible` | boolean | `true` |
| `arcs.1.width` | number | `2` |
| `arcs.1.x` | number | `1` |
| `arcs.1.y` | number | `1` |
| `arcs.10.color` | string | `#2962FF` |
| `arcs.10.visible` | boolean | `true` |
| `arcs.10.width` | number | `2` |
| `arcs.10.x` | number | `5` |
| `arcs.10.y` | number | `1` |
| `arcs.2.color` | string | `#FF9800` |
| `arcs.2.visible` | boolean | `true` |
| `arcs.2.width` | number | `2` |
| `arcs.2.x` | number | `1.5` |
| `arcs.2.y` | number | `0` |
| `arcs.3.color` | string | `#00bcd4` |
| `arcs.3.visible` | boolean | `true` |
| `arcs.3.width` | number | `2` |
| `arcs.3.x` | number | `2` |
| `arcs.3.y` | number | `0` |
| `arcs.4.color` | string | `#00bcd4` |
| `arcs.4.visible` | boolean | `true` |
| `arcs.4.width` | number | `2` |
| `arcs.4.x` | number | `2` |
| `arcs.4.y` | number | `1` |
| `arcs.5.color` | string | `#4caf50` |
| `arcs.5.visible` | boolean | `true` |
| `arcs.5.width` | number | `2` |
| `arcs.5.x` | number | `3` |
| `arcs.5.y` | number | `0` |
| `arcs.6.color` | string | `#4caf50` |
| `arcs.6.visible` | boolean | `true` |
| `arcs.6.width` | number | `2` |
| `arcs.6.x` | number | `3` |
| `arcs.6.y` | number | `1` |
| `arcs.7.color` | string | `#089981` |
| `arcs.7.visible` | boolean | `true` |
| `arcs.7.width` | number | `2` |
| `arcs.7.x` | number | `4` |
| `arcs.7.y` | number | `0` |
| `arcs.8.color` | string | `#089981` |
| `arcs.8.visible` | boolean | `true` |
| `arcs.8.width` | number | `2` |
| `arcs.8.x` | number | `4` |
| `arcs.8.y` | number | `1` |
| `arcs.9.color` | string | `#2962FF` |
| `arcs.9.visible` | boolean | `true` |
| `arcs.9.width` | number | `2` |
| `arcs.9.x` | number | `5` |
| `arcs.9.y` | number | `0` |
| `arcsBackground.fillBackground` | boolean | `true` |
| `arcsBackground.transparency` | number | `80` |
| `fanlines.0.color` | string | `#B39DDB` |
| `fanlines.0.visible` | boolean | `false` |
| `fanlines.0.width` | number | `2` |
| `fanlines.0.x` | number | `8` |
| `fanlines.0.y` | number | `1` |
| `fanlines.1.color` | string | `#F23645` |
| `fanlines.1.visible` | boolean | `false` |
| `fanlines.1.width` | number | `2` |
| `fanlines.1.x` | number | `5` |
| `fanlines.1.y` | number | `1` |
| `fanlines.10.color` | string | `#B39DDB` |
| `fanlines.10.visible` | boolean | `false` |
| `fanlines.10.width` | number | `2` |
| `fanlines.10.x` | number | `1` |
| `fanlines.10.y` | number | `8` |
| `fanlines.2.color` | string | `#808080` |
| `fanlines.2.visible` | boolean | `false` |
| `fanlines.2.width` | number | `2` |
| `fanlines.2.x` | number | `4` |
| `fanlines.2.y` | number | `1` |
| `fanlines.3.color` | string | `#FF9800` |
| `fanlines.3.visible` | boolean | `false` |
| `fanlines.3.width` | number | `2` |
| `fanlines.3.x` | number | `3` |
| `fanlines.3.y` | number | `1` |
| `fanlines.4.color` | string | `#00bcd4` |
| `fanlines.4.visible` | boolean | `true` |
| `fanlines.4.width` | number | `2` |
| `fanlines.4.x` | number | `2` |
| `fanlines.4.y` | number | `1` |
| `fanlines.5.color` | string | `#4caf50` |
| `fanlines.5.visible` | boolean | `true` |
| `fanlines.5.width` | number | `2` |
| `fanlines.5.x` | number | `1` |
| `fanlines.5.y` | number | `1` |
| `fanlines.6.color` | string | `#089981` |
| `fanlines.6.visible` | boolean | `true` |
| `fanlines.6.width` | number | `2` |
| `fanlines.6.x` | number | `1` |
| `fanlines.6.y` | number | `2` |
| `fanlines.7.color` | string | `#089981` |
| `fanlines.7.visible` | boolean | `false` |
| `fanlines.7.width` | number | `2` |
| `fanlines.7.x` | number | `1` |
| `fanlines.7.y` | number | `3` |
| `fanlines.8.color` | string | `#2962FF` |
| `fanlines.8.visible` | boolean | `false` |
| `fanlines.8.width` | number | `2` |
| `fanlines.8.x` | number | `1` |
| `fanlines.8.y` | number | `4` |
| `fanlines.9.color` | string | `#9575cd` |
| `fanlines.9.visible` | boolean | `false` |
| `fanlines.9.width` | number | `2` |
| `fanlines.9.x` | number | `1` |
| `fanlines.9.y` | number | `5` |
| `fillBackground` | boolean | `false` |
| `labelsStyle.bold` | boolean | `false` |
| `labelsStyle.fontSize` | number | `12` |
| `labelsStyle.italic` | boolean | `false` |
| `levels.0.color` | string | `#808080` |
| `levels.0.visible` | boolean | `true` |
| `levels.0.width` | number | `2` |
| `levels.1.color` | string | `#FF9800` |
| `levels.1.visible` | boolean | `true` |
| `levels.1.width` | number | `2` |
| `levels.2.color` | string | `#00bcd4` |
| `levels.2.visible` | boolean | `true` |
| `levels.2.width` | number | `2` |
| `levels.3.color` | string | `#4caf50` |
| `levels.3.visible` | boolean | `true` |
| `levels.3.width` | number | `2` |
| `levels.4.color` | string | `#089981` |
| `levels.4.visible` | boolean | `true` |
| `levels.4.width` | number | `2` |
| `levels.5.color` | string | `#808080` |
| `levels.5.visible` | boolean | `true` |
| `levels.5.width` | number | `2` |
| `reverse` | boolean | `false` |
| `scaleRatio` | string | `undefined` |
| `showLabels` | boolean | `true` |

### GannfanLineToolOverrides  (`linetoolgannfan`)

| property | type | default |
|---|---|---|
| `fillBackground` | boolean | `true` |
| `level1.coeff1` | number | `1` |
| `level1.coeff2` | number | `8` |
| `level1.color` | string | `#FF9800` |
| `level1.linestyle` | number | `0` |
| `level1.linewidth` | number | `2` |
| `level1.visible` | boolean | `true` |
| `level2.coeff1` | number | `1` |
| `level2.coeff2` | number | `4` |
| `level2.color` | string | `#089981` |
| `level2.linestyle` | number | `0` |
| `level2.linewidth` | number | `2` |
| `level2.visible` | boolean | `true` |
| `level3.coeff1` | number | `1` |
| `level3.coeff2` | number | `3` |
| `level3.color` | string | `#4caf50` |
| `level3.linestyle` | number | `0` |
| `level3.linewidth` | number | `2` |
| `level3.visible` | boolean | `true` |
| `level4.coeff1` | number | `1` |
| `level4.coeff2` | number | `2` |
| `level4.color` | string | `#089981` |
| `level4.linestyle` | number | `0` |
| `level4.linewidth` | number | `2` |
| `level4.visible` | boolean | `true` |
| `level5.coeff1` | number | `1` |
| `level5.coeff2` | number | `1` |
| `level5.color` | string | `#00bcd4` |
| `level5.linestyle` | number | `0` |
| `level5.linewidth` | number | `2` |
| `level5.visible` | boolean | `true` |
| `level6.coeff1` | number | `2` |
| `level6.coeff2` | number | `1` |
| `level6.color` | string | `#2962FF` |
| `level6.linestyle` | number | `0` |
| `level6.linewidth` | number | `2` |
| `level6.visible` | boolean | `true` |
| `level7.coeff1` | number | `3` |
| `level7.coeff2` | number | `1` |
| `level7.color` | string | `#9c27b0` |
| `level7.linestyle` | number | `0` |
| `level7.linewidth` | number | `2` |
| `level7.visible` | boolean | `true` |
| `level8.coeff1` | number | `4` |
| `level8.coeff2` | number | `1` |
| `level8.color` | string | `#e91e63` |
| `level8.linestyle` | number | `0` |
| `level8.linewidth` | number | `2` |
| `level8.visible` | boolean | `true` |
| `level9.coeff1` | number | `8` |
| `level9.coeff2` | number | `1` |
| `level9.color` | string | `#F23645` |
| `level9.linestyle` | number | `0` |
| `level9.linewidth` | number | `2` |
| `level9.visible` | boolean | `true` |
| `linewidth` | number | `2` |
| `showLabels` | boolean | `true` |
| `transparency` | number | `80` |

### GannfixedLineToolOverrides  (`linetoolgannfixed`)

| property | type | default |
|---|---|---|
| `arcs.0.color` | string | `#FF9800` |
| `arcs.0.visible` | boolean | `true` |
| `arcs.0.width` | number | `2` |
| `arcs.0.x` | number | `1` |
| `arcs.0.y` | number | `0` |
| `arcs.1.color` | string | `#FF9800` |
| `arcs.1.visible` | boolean | `true` |
| `arcs.1.width` | number | `2` |
| `arcs.1.x` | number | `1` |
| `arcs.1.y` | number | `1` |
| `arcs.10.color` | string | `#2962FF` |
| `arcs.10.visible` | boolean | `true` |
| `arcs.10.width` | number | `2` |
| `arcs.10.x` | number | `5` |
| `arcs.10.y` | number | `1` |
| `arcs.2.color` | string | `#FF9800` |
| `arcs.2.visible` | boolean | `true` |
| `arcs.2.width` | number | `2` |
| `arcs.2.x` | number | `1.5` |
| `arcs.2.y` | number | `0` |
| `arcs.3.color` | string | `#00bcd4` |
| `arcs.3.visible` | boolean | `true` |
| `arcs.3.width` | number | `2` |
| `arcs.3.x` | number | `2` |
| `arcs.3.y` | number | `0` |
| `arcs.4.color` | string | `#00bcd4` |
| `arcs.4.visible` | boolean | `true` |
| `arcs.4.width` | number | `2` |
| `arcs.4.x` | number | `2` |
| `arcs.4.y` | number | `1` |
| `arcs.5.color` | string | `#4caf50` |
| `arcs.5.visible` | boolean | `true` |
| `arcs.5.width` | number | `2` |
| `arcs.5.x` | number | `3` |
| `arcs.5.y` | number | `0` |
| `arcs.6.color` | string | `#4caf50` |
| `arcs.6.visible` | boolean | `true` |
| `arcs.6.width` | number | `2` |
| `arcs.6.x` | number | `3` |
| `arcs.6.y` | number | `1` |
| `arcs.7.color` | string | `#089981` |
| `arcs.7.visible` | boolean | `true` |
| `arcs.7.width` | number | `2` |
| `arcs.7.x` | number | `4` |
| `arcs.7.y` | number | `0` |
| `arcs.8.color` | string | `#089981` |
| `arcs.8.visible` | boolean | `true` |
| `arcs.8.width` | number | `2` |
| `arcs.8.x` | number | `4` |
| `arcs.8.y` | number | `1` |
| `arcs.9.color` | string | `#2962FF` |
| `arcs.9.visible` | boolean | `true` |
| `arcs.9.width` | number | `2` |
| `arcs.9.x` | number | `5` |
| `arcs.9.y` | number | `0` |
| `arcsBackground.fillBackground` | boolean | `true` |
| `arcsBackground.transparency` | number | `80` |
| `fanlines.0.color` | string | `#B39DDB` |
| `fanlines.0.visible` | boolean | `false` |
| `fanlines.0.width` | number | `2` |
| `fanlines.0.x` | number | `8` |
| `fanlines.0.y` | number | `1` |
| `fanlines.1.color` | string | `#F23645` |
| `fanlines.1.visible` | boolean | `false` |
| `fanlines.1.width` | number | `2` |
| `fanlines.1.x` | number | `5` |
| `fanlines.1.y` | number | `1` |
| `fanlines.10.color` | string | `#B39DDB` |
| `fanlines.10.visible` | boolean | `false` |
| `fanlines.10.width` | number | `2` |
| `fanlines.10.x` | number | `1` |
| `fanlines.10.y` | number | `8` |
| `fanlines.2.color` | string | `#808080` |
| `fanlines.2.visible` | boolean | `false` |
| `fanlines.2.width` | number | `2` |
| `fanlines.2.x` | number | `4` |
| `fanlines.2.y` | number | `1` |
| `fanlines.3.color` | string | `#FF9800` |
| `fanlines.3.visible` | boolean | `false` |
| `fanlines.3.width` | number | `2` |
| `fanlines.3.x` | number | `3` |
| `fanlines.3.y` | number | `1` |
| `fanlines.4.color` | string | `#00bcd4` |
| `fanlines.4.visible` | boolean | `true` |
| `fanlines.4.width` | number | `2` |
| `fanlines.4.x` | number | `2` |
| `fanlines.4.y` | number | `1` |
| `fanlines.5.color` | string | `#4caf50` |
| `fanlines.5.visible` | boolean | `true` |
| `fanlines.5.width` | number | `2` |
| `fanlines.5.x` | number | `1` |
| `fanlines.5.y` | number | `1` |
| `fanlines.6.color` | string | `#089981` |
| `fanlines.6.visible` | boolean | `true` |
| `fanlines.6.width` | number | `2` |
| `fanlines.6.x` | number | `1` |
| `fanlines.6.y` | number | `2` |
| `fanlines.7.color` | string | `#089981` |
| `fanlines.7.visible` | boolean | `false` |
| `fanlines.7.width` | number | `2` |
| `fanlines.7.x` | number | `1` |
| `fanlines.7.y` | number | `3` |
| `fanlines.8.color` | string | `#2962FF` |
| `fanlines.8.visible` | boolean | `false` |
| `fanlines.8.width` | number | `2` |
| `fanlines.8.x` | number | `1` |
| `fanlines.8.y` | number | `4` |
| `fanlines.9.color` | string | `#9575cd` |
| `fanlines.9.visible` | boolean | `false` |
| `fanlines.9.width` | number | `2` |
| `fanlines.9.x` | number | `1` |
| `fanlines.9.y` | number | `5` |
| `fillBackground` | boolean | `false` |
| `levels.0.color` | string | `#808080` |
| `levels.0.visible` | boolean | `true` |
| `levels.0.width` | number | `2` |
| `levels.1.color` | string | `#FF9800` |
| `levels.1.visible` | boolean | `true` |
| `levels.1.width` | number | `2` |
| `levels.2.color` | string | `#00bcd4` |
| `levels.2.visible` | boolean | `true` |
| `levels.2.width` | number | `2` |
| `levels.3.color` | string | `#4caf50` |
| `levels.3.visible` | boolean | `true` |
| `levels.3.width` | number | `2` |
| `levels.4.color` | string | `#089981` |
| `levels.4.visible` | boolean | `true` |
| `levels.4.width` | number | `2` |
| `levels.5.color` | string | `#808080` |
| `levels.5.visible` | boolean | `true` |
| `levels.5.width` | number | `2` |
| `reverse` | boolean | `false` |

### GannsquareLineToolOverrides  (`linetoolgannsquare`)

| property | type | default |
|---|---|---|
| `color` | string | `rgba(21, 56, 153, 0.8)` |
| `fans.color` | string | `#9C9C9C` |
| `fans.visible` | boolean | `false` |
| `fillHorzBackground` | boolean | `true` |
| `fillVertBackground` | boolean | `true` |
| `hlevel1.coeff` | number | `0` |
| `hlevel1.color` | string | `#808080` |
| `hlevel1.visible` | boolean | `true` |
| `hlevel2.coeff` | number | `0.25` |
| `hlevel2.color` | string | `#FF9800` |
| `hlevel2.visible` | boolean | `true` |
| `hlevel3.coeff` | number | `0.382` |
| `hlevel3.color` | string | `#00bcd4` |
| `hlevel3.visible` | boolean | `true` |
| `hlevel4.coeff` | number | `0.5` |
| `hlevel4.color` | string | `#4caf50` |
| `hlevel4.visible` | boolean | `true` |
| `hlevel5.coeff` | number | `0.618` |
| `hlevel5.color` | string | `#089981` |
| `hlevel5.visible` | boolean | `true` |
| `hlevel6.coeff` | number | `0.75` |
| `hlevel6.color` | string | `#2962FF` |
| `hlevel6.visible` | boolean | `true` |
| `hlevel7.coeff` | number | `1` |
| `hlevel7.color` | string | `#808080` |
| `hlevel7.visible` | boolean | `true` |
| `horzTransparency` | number | `80` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `reverse` | boolean | `false` |
| `showBottomLabels` | boolean | `true` |
| `showLeftLabels` | boolean | `true` |
| `showRightLabels` | boolean | `true` |
| `showTopLabels` | boolean | `true` |
| `vertTransparency` | number | `80` |
| `vlevel1.coeff` | number | `0` |
| `vlevel1.color` | string | `#808080` |
| `vlevel1.visible` | boolean | `true` |
| `vlevel2.coeff` | number | `0.25` |
| `vlevel2.color` | string | `#FF9800` |
| `vlevel2.visible` | boolean | `true` |
| `vlevel3.coeff` | number | `0.382` |
| `vlevel3.color` | string | `#00bcd4` |
| `vlevel3.visible` | boolean | `true` |
| `vlevel4.coeff` | number | `0.5` |
| `vlevel4.color` | string | `#4caf50` |
| `vlevel4.visible` | boolean | `true` |
| `vlevel5.coeff` | number | `0.618` |
| `vlevel5.color` | string | `#089981` |
| `vlevel5.visible` | boolean | `true` |
| `vlevel6.coeff` | number | `0.75` |
| `vlevel6.color` | string | `#2962FF` |
| `vlevel6.visible` | boolean | `true` |
| `vlevel7.coeff` | number | `1` |
| `vlevel7.color` | string | `#808080` |
| `vlevel7.visible` | boolean | `true` |

### GhostfeedLineToolOverrides  (`linetoolghostfeed`)

| property | type | default |
|---|---|---|
| `averageHL` | number | `20` |
| `candleStyle.borderColor` | string | `#378658` |
| `candleStyle.borderDownColor` | string | `#F23645` |
| `candleStyle.borderUpColor` | string | `#089981` |
| `candleStyle.downColor` | string | `#FAA1A4` |
| `candleStyle.drawBorder` | boolean | `true` |
| `candleStyle.drawWick` | boolean | `true` |
| `candleStyle.upColor` | string | `#ACE5DC` |
| `candleStyle.wickColor` | string | `#808080` |
| `transparency` | number | `50` |
| `variance` | number | `50` |

### HeadandshouldersLineToolOverrides  (`linetoolheadandshoulders`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `#089981` |
| `bold` | boolean | `false` |
| `color` | string | `#089981` |
| `fillBackground` | boolean | `true` |
| `fontsize` | number | `12` |
| `italic` | boolean | `false` |
| `linewidth` | number | `2` |
| `textcolor` | string | `#ffffff` |
| `transparency` | number | `85` |

### HighlighterLineToolOverrides  (`linetoolhighlighter`)

| property | type | default |
|---|---|---|
| `linecolor` | string | `rgba(242, 54, 69, 0.2)` |
| `smooth` | number | `5` |
| `transparency` | number | `80` |
| `width` | number | `20` |

### HorzlineLineToolOverrides  (`linetoolhorzline`)

| property | type | default |
|---|---|---|
| `bold` | boolean | `false` |
| `fontsize` | number | `12` |
| `horzLabelsAlign` | string | `center` |
| `italic` | boolean | `false` |
| `linecolor` | string | `#2962FF` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `showPrice` | boolean | `true` |
| `textcolor` | string | `#2962FF` |
| `vertLabelsAlign` | string | `middle` |

### HorzrayLineToolOverrides  (`linetoolhorzray`)

| property | type | default |
|---|---|---|
| `bold` | boolean | `false` |
| `fontsize` | number | `12` |
| `horzLabelsAlign` | string | `center` |
| `italic` | boolean | `false` |
| `linecolor` | string | `#2962FF` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `showPrice` | boolean | `true` |
| `textcolor` | string | `#2962FF` |
| `vertLabelsAlign` | string | `top` |

### IconLineToolOverrides  (`linetoolicon`)

| property | type | default |
|---|---|---|
| `angle` | number | `1.5707963267948966` |
| `color` | string | `#2962FF` |
| `size` | number | `40` |

### ImageLineToolOverrides  (`linetoolimage`)

| property | type | default |
|---|---|---|
| `angle` | number | `0` |
| `cssHeight` | number | `0` |
| `cssWidth` | number | `0` |
| `transparency` | number | `0` |

### InfolineLineToolOverrides  (`linetoolinfoline`)

| property | type | default |
|---|---|---|
| `alwaysShowStats` | boolean | `true` |
| `bold` | boolean | `false` |
| `extendLeft` | boolean | `false` |
| `extendRight` | boolean | `false` |
| `fontsize` | number | `14` |
| `horzLabelsAlign` | string | `center` |
| `italic` | boolean | `false` |
| `leftEnd` | number | `0` |
| `linecolor` | string | `#2962FF` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `rightEnd` | number | `0` |
| `showAngle` | boolean | `true` |
| `showBarsRange` | boolean | `true` |
| `showDateTimeRange` | boolean | `true` |
| `showDistance` | boolean | `true` |
| `showMiddlePoint` | boolean | `false` |
| `showPercentPriceRange` | boolean | `true` |
| `showPipsPriceRange` | boolean | `true` |
| `showPriceLabels` | boolean | `false` |
| `showPriceRange` | boolean | `true` |
| `statsPosition` | number | `1` |
| `textcolor` | string | `#2962FF` |
| `vertLabelsAlign` | string | `bottom` |

### InsidepitchforkLineToolOverrides  (`linetoolinsidepitchfork`)

| property | type | default |
|---|---|---|
| `extendLines` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `level0.coeff` | number | `0.25` |
| `level0.color` | string | `#ffb74d` |
| `level0.linestyle` | number | `0` |
| `level0.linewidth` | number | `2` |
| `level0.visible` | boolean | `false` |
| `level1.coeff` | number | `0.382` |
| `level1.color` | string | `#81c784` |
| `level1.linestyle` | number | `0` |
| `level1.linewidth` | number | `2` |
| `level1.visible` | boolean | `false` |
| `level2.coeff` | number | `0.5` |
| `level2.color` | string | `#089981` |
| `level2.linestyle` | number | `0` |
| `level2.linewidth` | number | `2` |
| `level2.visible` | boolean | `true` |
| `level3.coeff` | number | `0.618` |
| `level3.color` | string | `#089981` |
| `level3.linestyle` | number | `0` |
| `level3.linewidth` | number | `2` |
| `level3.visible` | boolean | `false` |
| `level4.coeff` | number | `0.75` |
| `level4.color` | string | `#00bcd4` |
| `level4.linestyle` | number | `0` |
| `level4.linewidth` | number | `2` |
| `level4.visible` | boolean | `false` |
| `level5.coeff` | number | `1` |
| `level5.color` | string | `#2962FF` |
| `level5.linestyle` | number | `0` |
| `level5.linewidth` | number | `2` |
| `level5.visible` | boolean | `true` |
| `level6.coeff` | number | `1.5` |
| `level6.color` | string | `#9c27b0` |
| `level6.linestyle` | number | `0` |
| `level6.linewidth` | number | `2` |
| `level6.visible` | boolean | `false` |
| `level7.coeff` | number | `1.75` |
| `level7.color` | string | `#e91e63` |
| `level7.linestyle` | number | `0` |
| `level7.linewidth` | number | `2` |
| `level7.visible` | boolean | `false` |
| `level8.coeff` | number | `2` |
| `level8.color` | string | `#F77C80` |
| `level8.linestyle` | number | `0` |
| `level8.linewidth` | number | `2` |
| `level8.visible` | boolean | `false` |
| `median.color` | string | `#F23645` |
| `median.linestyle` | number | `0` |
| `median.linewidth` | number | `2` |
| `median.visible` | boolean | `true` |
| `style` | number | `2` |
| `transparency` | number | `80` |

### NoteLineToolOverrides  (`linetoolnote`)

| property | type | default |
|---|---|---|
| `backgroundColor` |  | `rgba(41, 98, 255, 0.7)` |
| `backgroundTransparency` |  | `0` |
| `bold` |  | `false` |
| `borderColor` |  | `#2962FF` |
| `fixedSize` |  | `true` |
| `fontSize` |  | `14` |
| `italic` |  | `false` |
| `markerColor` |  | `#2962FF` |
| `textColor` |  | `#ffffff` |

### NoteabsoluteLineToolOverrides  (`linetoolnoteabsolute`)

| property | type | default |
|---|---|---|
| `backgroundColor` |  | `rgba(41, 98, 255, 0.7)` |
| `backgroundTransparency` |  | `0` |
| `bold` |  | `false` |
| `borderColor` |  | `#2962FF` |
| `fixedSize` |  | `true` |
| `fontSize` |  | `14` |
| `italic` |  | `false` |
| `markerColor` |  | `#2962FF` |
| `textColor` |  | `#ffffff` |

### OrderLineToolOverrides  (`linetoolorder`)

| property | type | default |
|---|---|---|
| `bodyBackgroundColor` | string | `rgba(255, 255, 255, 0.25)` |
| `bodyBackgroundTransparency` | number | `25` |
| `bodyBorderActiveBuyColor` | string | `#4094e8` |
| `bodyBorderActiveSellColor` | string | `#e75656` |
| `bodyBorderInactiveBuyColor` | string | `rgba(64, 148, 232, 0.5)` |
| `bodyBorderInactiveSellColor` | string | `rgba(231, 86, 86, 0.5)` |
| `bodyFontBold` | boolean | `true` |
| `bodyFontFamily` | string | `Verdana` |
| `bodyFontItalic` | boolean | `false` |
| `bodyFontSize` | number | `9` |
| `bodyTextActiveBuyColor` | string | `#4094e8` |
| `bodyTextActiveLimitColor` | string | `#268c02` |
| `bodyTextActiveSellColor` | string | `#e75656` |
| `bodyTextActiveStopColor` | string | `#e75656` |
| `bodyTextInactiveBuyColor` | string | `rgba(64, 148, 232, 0.5)` |
| `bodyTextInactiveLimitColor` | string | `rgba(38, 140, 2, 0.5)` |
| `bodyTextInactiveSellColor` | string | `rgba(231, 86, 86, 0.5)` |
| `bodyTextInactiveStopColor` | string | `rgba(231, 86, 86, 0.5)` |
| `cancelButtonBackgroundColor` | string | `rgba(255, 255, 255, 0.25)` |
| `cancelButtonBackgroundTransparency` | number | `25` |
| `cancelButtonBorderActiveBuyColor` | string | `#4094e8` |
| `cancelButtonBorderActiveSellColor` | string | `#e75656` |
| `cancelButtonBorderInactiveBuyColor` | string | `rgba(64, 148, 232, 0.5)` |
| `cancelButtonBorderInactiveSellColor` | string | `rgba(231, 86, 86, 0.5)` |
| `cancelButtonIconActiveBuyColor` | string | `#4094e8` |
| `cancelButtonIconActiveSellColor` | string | `#e75656` |
| `cancelButtonIconInactiveBuyColor` | string | `rgba(64, 148, 232, 0.5)` |
| `cancelButtonIconInactiveSellColor` | string | `rgba(231, 86, 86, 0.5)` |
| `cancelTooltip` | string | `undefined` |
| `extendLeft` | string | `inherit` |
| `lineActiveBuyColor` | string | `#4094e8` |
| `lineActiveSellColor` | string | `#e75656` |
| `lineColor` | string | `#FF0000` |
| `lineInactiveBuyColor` | string | `rgba(64, 148, 232, 0.5)` |
| `lineInactiveSellColor` | string | `rgba(231, 86, 86, 0.5)` |
| `lineLength` | string | `inherit` |
| `lineLengthUnit` | string | `percentage` |
| `lineStyle` | string | `inherit` |
| `lineWidth` | string | `inherit` |
| `modifyTooltip` | string | `undefined` |
| `quantityBackgroundActiveBuyColor` | string | `#4094e8` |
| `quantityBackgroundActiveSellColor` | string | `#e75656` |
| `quantityBackgroundInactiveBuyColor` | string | `rgba(64, 148, 232, 0.5)` |
| `quantityBackgroundInactiveSellColor` | string | `rgba(231, 86, 86, 0.5)` |
| `quantityBorderActiveBuyColor` | string | `#4094e8` |
| `quantityBorderActiveSellColor` | string | `#e75656` |
| `quantityBorderInactiveBuyColor` | string | `rgba(64, 148, 232, 0.5)` |
| `quantityBorderInactiveSellColor` | string | `rgba(231, 86, 86, 0.5)` |
| `quantityFontBold` | boolean | `true` |
| `quantityFontFamily` | string | `Verdana` |
| `quantityFontItalic` | boolean | `false` |
| `quantityFontSize` | number | `9` |
| `quantityTextColor` | string | `#ffffff` |
| `quantityTextTransparency` | number | `0` |
| `tooltip` | string | `undefined` |

### ParallelchannelLineToolOverrides  (`linetoolparallelchannel`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(41, 98, 255, 0.2)` |
| `extendLeft` | boolean | `false` |
| `extendRight` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `labelBold` | boolean | `false` |
| `labelFontSize` | number | `14` |
| `labelHorzAlign` | string | `left` |
| `labelItalic` | boolean | `false` |
| `labelTextColor` | string | `#2962FF` |
| `labelVertAlign` | string | `bottom` |
| `labelVisible` | boolean | `false` |
| `linecolor` | string | `#2962FF` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `midlinecolor` | string | `#2962FF` |
| `midlinestyle` | number | `2` |
| `midlinewidth` | number | `1` |
| `showMidline` | boolean | `true` |
| `transparency` | number | `20` |

### PathLineToolOverrides  (`linetoolpath`)

| property | type | default |
|---|---|---|
| `leftEnd` | number | `0` |
| `lineColor` | string | `#2962FF` |
| `lineStyle` | number | `0` |
| `lineWidth` | number | `2` |
| `rightEnd` | number | `1` |

### PitchfanLineToolOverrides  (`linetoolpitchfan`)

| property | type | default |
|---|---|---|
| `fillBackground` | boolean | `true` |
| `level0.coeff` | number | `0.25` |
| `level0.color` | string | `#ffb74d` |
| `level0.linestyle` | number | `0` |
| `level0.linewidth` | number | `2` |
| `level0.visible` | boolean | `false` |
| `level1.coeff` | number | `0.382` |
| `level1.color` | string | `#81c784` |
| `level1.linestyle` | number | `0` |
| `level1.linewidth` | number | `2` |
| `level1.visible` | boolean | `false` |
| `level2.coeff` | number | `0.5` |
| `level2.color` | string | `#00bcd4` |
| `level2.linestyle` | number | `0` |
| `level2.linewidth` | number | `2` |
| `level2.visible` | boolean | `true` |
| `level3.coeff` | number | `0.618` |
| `level3.color` | string | `#089981` |
| `level3.linestyle` | number | `0` |
| `level3.linewidth` | number | `2` |
| `level3.visible` | boolean | `false` |
| `level4.coeff` | number | `0.75` |
| `level4.color` | string | `#00bcd4` |
| `level4.linestyle` | number | `0` |
| `level4.linewidth` | number | `2` |
| `level4.visible` | boolean | `false` |
| `level5.coeff` | number | `1` |
| `level5.color` | string | `#2962FF` |
| `level5.linestyle` | number | `0` |
| `level5.linewidth` | number | `2` |
| `level5.visible` | boolean | `true` |
| `level6.coeff` | number | `1.5` |
| `level6.color` | string | `#9c27b0` |
| `level6.linestyle` | number | `0` |
| `level6.linewidth` | number | `2` |
| `level6.visible` | boolean | `false` |
| `level7.coeff` | number | `1.75` |
| `level7.color` | string | `#e91e63` |
| `level7.linestyle` | number | `0` |
| `level7.linewidth` | number | `2` |
| `level7.visible` | boolean | `false` |
| `level8.coeff` | number | `2` |
| `level8.color` | string | `#F77C80` |
| `level8.linestyle` | number | `0` |
| `level8.linewidth` | number | `2` |
| `level8.visible` | boolean | `false` |
| `median.color` | string | `#F23645` |
| `median.linestyle` | number | `0` |
| `median.linewidth` | number | `2` |
| `median.visible` | boolean | `true` |
| `transparency` | number | `80` |

### PitchforkLineToolOverrides  (`linetoolpitchfork`)

| property | type | default |
|---|---|---|
| `extendLines` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `level0.coeff` | number | `0.25` |
| `level0.color` | string | `#ffb74d` |
| `level0.linestyle` | number | `0` |
| `level0.linewidth` | number | `2` |
| `level0.visible` | boolean | `false` |
| `level1.coeff` | number | `0.382` |
| `level1.color` | string | `#81c784` |
| `level1.linestyle` | number | `0` |
| `level1.linewidth` | number | `2` |
| `level1.visible` | boolean | `false` |
| `level2.coeff` | number | `0.5` |
| `level2.color` | string | `#089981` |
| `level2.linestyle` | number | `0` |
| `level2.linewidth` | number | `2` |
| `level2.visible` | boolean | `true` |
| `level3.coeff` | number | `0.618` |
| `level3.color` | string | `#089981` |
| `level3.linestyle` | number | `0` |
| `level3.linewidth` | number | `2` |
| `level3.visible` | boolean | `false` |
| `level4.coeff` | number | `0.75` |
| `level4.color` | string | `#00bcd4` |
| `level4.linestyle` | number | `0` |
| `level4.linewidth` | number | `2` |
| `level4.visible` | boolean | `false` |
| `level5.coeff` | number | `1` |
| `level5.color` | string | `#2962FF` |
| `level5.linestyle` | number | `0` |
| `level5.linewidth` | number | `2` |
| `level5.visible` | boolean | `true` |
| `level6.coeff` | number | `1.5` |
| `level6.color` | string | `#9c27b0` |
| `level6.linestyle` | number | `0` |
| `level6.linewidth` | number | `2` |
| `level6.visible` | boolean | `false` |
| `level7.coeff` | number | `1.75` |
| `level7.color` | string | `#e91e63` |
| `level7.linestyle` | number | `0` |
| `level7.linewidth` | number | `2` |
| `level7.visible` | boolean | `false` |
| `level8.coeff` | number | `2` |
| `level8.color` | string | `#F77C80` |
| `level8.linestyle` | number | `0` |
| `level8.linewidth` | number | `2` |
| `level8.visible` | boolean | `false` |
| `median.color` | string | `#F23645` |
| `median.linestyle` | number | `0` |
| `median.linewidth` | number | `2` |
| `median.visible` | boolean | `true` |
| `style` | number | `0` |
| `transparency` | number | `80` |

### PolylineLineToolOverrides  (`linetoolpolyline`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(0, 188, 212, 0.2)` |
| `fillBackground` | boolean | `true` |
| `filled` | boolean | `false` |
| `linecolor` | string | `#00bcd4` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `transparency` | number | `80` |

### PositionLineToolOverrides  (`linetoolposition`)

| property | type | default |
|---|---|---|
| `bodyBackgroundColor` | string | `rgba(255, 255, 255, 0.25)` |
| `bodyBackgroundTransparency` | number | `25` |
| `bodyBorderBuyColor` | string | `#4094e8` |
| `bodyBorderSellColor` | string | `#e75656` |
| `bodyFontBold` | boolean | `true` |
| `bodyFontFamily` | string | `Verdana` |
| `bodyFontItalic` | boolean | `false` |
| `bodyFontSize` | number | `9` |
| `bodyTextNegativeColor` | string | `#e75656` |
| `bodyTextNeutralColor` | string | `#646464` |
| `bodyTextPositiveColor` | string | `#268c02` |
| `closeButtonBackgroundColor` | string | `rgba(255, 255, 255, 0.25)` |
| `closeButtonBackgroundTransparency` | number | `25` |
| `closeButtonBorderBuyColor` | string | `#4094e8` |
| `closeButtonBorderSellColor` | string | `#e75656` |
| `closeButtonIconBuyColor` | string | `#4094e8` |
| `closeButtonIconSellColor` | string | `#e75656` |
| `closeTooltip` | string | `undefined` |
| `extendLeft` | string | `inherit` |
| `lineBuyColor` | string | `#4094e8` |
| `lineLength` | string | `inherit` |
| `lineLengthUnit` | string | `percentage` |
| `lineSellColor` | string | `#e75656` |
| `lineStyle` | string | `inherit` |
| `lineWidth` | string | `inherit` |
| `protectTooltip` | string | `undefined` |
| `quantityBackgroundBuyColor` | string | `#4094e8` |
| `quantityBackgroundSellColor` | string | `#e75656` |
| `quantityBorderBuyColor` | string | `#4094e8` |
| `quantityBorderSellColor` | string | `#e75656` |
| `quantityFontBold` | boolean | `true` |
| `quantityFontFamily` | string | `Verdana` |
| `quantityFontItalic` | boolean | `false` |
| `quantityFontSize` | number | `9` |
| `quantityTextColor` | string | `#ffffff` |
| `quantityTextTransparency` | number | `0` |
| `reverseButtonBackgroundColor` | string | `rgba(255, 255, 255, 0.25)` |
| `reverseButtonBackgroundTransparency` | number | `25` |
| `reverseButtonBorderBuyColor` | string | `#4094e8` |
| `reverseButtonBorderSellColor` | string | `#e75656` |
| `reverseButtonIconBuyColor` | string | `#4094e8` |
| `reverseButtonIconSellColor` | string | `#e75656` |
| `reverseTooltip` | string | `undefined` |
| `tooltip` | string | `undefined` |

### PredictionLineToolOverrides  (`linetoolprediction`)

| property | type | default |
|---|---|---|
| `centersColor` | string | `#202020` |
| `failureBackground` | string | `#F23645` |
| `failureTextColor` | string | `#ffffff` |
| `intermediateBackColor` | string | `#ead289` |
| `intermediateTextColor` | string | `#6d4d22` |
| `linecolor` | string | `#2962FF` |
| `linewidth` | number | `2` |
| `sourceBackColor` | string | `#2962FF` |
| `sourceStrokeColor` | string | `#2962FF` |
| `sourceTextColor` | string | `#ffffff` |
| `successBackground` | string | `#4caf50` |
| `successTextColor` | string | `#ffffff` |
| `targetBackColor` | string | `#2962FF` |
| `targetStrokeColor` | string | `#2962FF` |
| `targetTextColor` | string | `#ffffff` |
| `transparency` | number | `10` |

### PricelabelLineToolOverrides  (`linetoolpricelabel`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `#2962FF` |
| `borderColor` | string | `#2962FF` |
| `color` | string | `#ffffff` |
| `fontWeight` | string | `bold` |
| `fontsize` | number | `14` |
| `transparency` | number | `0` |

### ProjectionLineToolOverrides  (`linetoolprojection`)

| property | type | default |
|---|---|---|
| `color1` | string | `rgba(41, 98, 255, 0.2)` |
| `color2` | string | `rgba(156, 39, 176, 0.2)` |
| `fillBackground` | boolean | `true` |
| `level1.coeff` | number | `1` |
| `level1.color` | string | `#808080` |
| `level1.linestyle` | number | `0` |
| `level1.linewidth` | number | `2` |
| `level1.visible` | boolean | `true` |
| `linewidth` | number | `2` |
| `showCoeffs` | boolean | `true` |
| `transparency` | number | `80` |
| `trendline.color` | string | `#9C9C9C` |
| `trendline.linestyle` | number | `0` |
| `trendline.visible` | boolean | `true` |

### RayLineToolOverrides  (`linetoolray`)

| property | type | default |
|---|---|---|
| `alwaysShowStats` | boolean | `false` |
| `bold` | boolean | `false` |
| `extendLeft` | boolean | `false` |
| `extendRight` | boolean | `true` |
| `fontsize` | number | `14` |
| `horzLabelsAlign` | string | `center` |
| `italic` | boolean | `false` |
| `leftEnd` | number | `0` |
| `linecolor` | string | `#2962FF` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `rightEnd` | number | `0` |
| `showAngle` | boolean | `false` |
| `showBarsRange` | boolean | `false` |
| `showDateTimeRange` | boolean | `false` |
| `showDistance` | boolean | `false` |
| `showMiddlePoint` | boolean | `false` |
| `showPercentPriceRange` | boolean | `false` |
| `showPipsPriceRange` | boolean | `false` |
| `showPriceLabels` | boolean | `false` |
| `showPriceRange` | boolean | `false` |
| `statsPosition` | number | `2` |
| `textcolor` | string | `#2962FF` |
| `vertLabelsAlign` | string | `bottom` |

### RectangleLineToolOverrides  (`linetoolrectangle`)

| property | type | default |
|---|---|---|
| `backgroundColor` |  | `rgba(156, 39, 176, 0.2)` |
| `bold` |  | `false` |
| `color` |  | `#9c27b0` |
| `extendLeft` |  | `false` |
| `extendRight` |  | `false` |
| `fillBackground` |  | `true` |
| `fontSize` |  | `14` |
| `horzLabelsAlign` |  | `center` |
| `italic` |  | `false` |
| `linewidth` |  | `2` |
| `middleLine.lineColor` |  | `#9c27b0` |
| `middleLine.lineStyle` |  | `2` |
| `middleLine.lineWidth` |  | `1` |
| `middleLine.showLine` |  | `false` |
| `showLabel` |  | `false` |
| `textColor` |  | `#9c27b0` |
| `transparency` |  | `50` |
| `vertLabelsAlign` |  | `middle` |

### RegressiontrendLineToolOverrides  (`linetoolregressiontrend`)

| property | type | default |
|---|---|---|
| `inputs.first bar time` | number | `0` |
| `inputs.last bar time` | number | `0` |
| `inputs.lower diviation` | number | `-2` |
| `inputs.source` | string | `close` |
| `inputs.upper diviation` | number | `2` |
| `inputs.use lower diviation` | boolean | `true` |
| `inputs.use upper diviation` | boolean | `true` |
| `linestyle` | number | `0` |
| `linewidth` | number | `1` |
| `precision` | string | `default` |
| `styles.baseLine.color` | string | `rgba(242, 54, 69, 0.3)` |
| `styles.baseLine.display` | number | `15` |
| `styles.baseLine.linestyle` | number | `2` |
| `styles.baseLine.linewidth` | number | `1` |
| `styles.downLine.color` | string | `rgba(41, 98, 255, 0.3)` |
| `styles.downLine.display` | number | `15` |
| `styles.downLine.linestyle` | number | `0` |
| `styles.downLine.linewidth` | number | `2` |
| `styles.extendLines` | boolean | `false` |
| `styles.showPearsons` | boolean | `true` |
| `styles.transparency` | number | `70` |
| `styles.upLine.color` | string | `rgba(41, 98, 255, 0.3)` |
| `styles.upLine.display` | number | `15` |
| `styles.upLine.linestyle` | number | `0` |
| `styles.upLine.linewidth` | number | `2` |

### RiskrewardlongLineToolOverrides  (`linetoolriskrewardlong`)

| property | type | default |
|---|---|---|
| `accountSize` | number | `1000` |
| `alwaysShowStats` | boolean | `false` |
| `borderColor` | string | `#667b8b` |
| `compact` | boolean | `false` |
| `currency` | string | `NONE` |
| `drawBorder` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `fillLabelBackground` | boolean | `true` |
| `fontsize` | number | `12` |
| `labelBackgroundColor` | string | `#585858` |
| `linecolor` | string | `#808080` |
| `linewidth` | number | `1` |
| `lotSize` | number | `1` |
| `profitBackground` | string | `rgba(8, 153, 129, 0.2)` |
| `profitBackgroundTransparency` | number | `80` |
| `risk` | number | `25` |
| `riskDisplayMode` | string | `percents` |
| `showPriceLabels` | boolean | `true` |
| `stopBackground` | string | `rgba(242, 54, 69, 0.2)` |
| `stopBackgroundTransparency` | number | `80` |
| `textcolor` | string | `#ffffff` |

### RiskrewardshortLineToolOverrides  (`linetoolriskrewardshort`)

| property | type | default |
|---|---|---|
| `accountSize` | number | `1000` |
| `alwaysShowStats` | boolean | `false` |
| `borderColor` | string | `#667b8b` |
| `compact` | boolean | `false` |
| `currency` | string | `NONE` |
| `drawBorder` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `fillLabelBackground` | boolean | `true` |
| `fontsize` | number | `12` |
| `labelBackgroundColor` | string | `#585858` |
| `linecolor` | string | `#808080` |
| `linewidth` | number | `1` |
| `lotSize` | number | `1` |
| `profitBackground` | string | `rgba(8, 153, 129, 0.2)` |
| `profitBackgroundTransparency` | number | `80` |
| `risk` | number | `25` |
| `riskDisplayMode` | string | `percents` |
| `showPriceLabels` | boolean | `true` |
| `stopBackground` | string | `rgba(242, 54, 69, 0.2)` |
| `stopBackgroundTransparency` | number | `80` |
| `textcolor` | string | `#ffffff` |

### RotatedrectangleLineToolOverrides  (`linetoolrotatedrectangle`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(76, 175, 80, 0.2)` |
| `color` | string | `#4caf50` |
| `fillBackground` | boolean | `true` |
| `linewidth` | number | `2` |
| `transparency` | number | `50` |

### Schiffpitchfork2LineToolOverrides  (`linetoolschiffpitchfork2`)

| property | type | default |
|---|---|---|
| `extendLines` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `level0.coeff` | number | `0.25` |
| `level0.color` | string | `#ffb74d` |
| `level0.linestyle` | number | `0` |
| `level0.linewidth` | number | `2` |
| `level0.visible` | boolean | `false` |
| `level1.coeff` | number | `0.382` |
| `level1.color` | string | `#81c784` |
| `level1.linestyle` | number | `0` |
| `level1.linewidth` | number | `2` |
| `level1.visible` | boolean | `false` |
| `level2.coeff` | number | `0.5` |
| `level2.color` | string | `#089981` |
| `level2.linestyle` | number | `0` |
| `level2.linewidth` | number | `2` |
| `level2.visible` | boolean | `true` |
| `level3.coeff` | number | `0.618` |
| `level3.color` | string | `#089981` |
| `level3.linestyle` | number | `0` |
| `level3.linewidth` | number | `2` |
| `level3.visible` | boolean | `false` |
| `level4.coeff` | number | `0.75` |
| `level4.color` | string | `#00bcd4` |
| `level4.linestyle` | number | `0` |
| `level4.linewidth` | number | `2` |
| `level4.visible` | boolean | `false` |
| `level5.coeff` | number | `1` |
| `level5.color` | string | `#2962FF` |
| `level5.linestyle` | number | `0` |
| `level5.linewidth` | number | `2` |
| `level5.visible` | boolean | `true` |
| `level6.coeff` | number | `1.5` |
| `level6.color` | string | `#9c27b0` |
| `level6.linestyle` | number | `0` |
| `level6.linewidth` | number | `2` |
| `level6.visible` | boolean | `false` |
| `level7.coeff` | number | `1.75` |
| `level7.color` | string | `#e91e63` |
| `level7.linestyle` | number | `0` |
| `level7.linewidth` | number | `2` |
| `level7.visible` | boolean | `false` |
| `level8.coeff` | number | `2` |
| `level8.color` | string | `#F77C80` |
| `level8.linestyle` | number | `0` |
| `level8.linewidth` | number | `2` |
| `level8.visible` | boolean | `false` |
| `median.color` | string | `#F23645` |
| `median.linestyle` | number | `0` |
| `median.linewidth` | number | `2` |
| `median.visible` | boolean | `true` |
| `style` | number | `3` |
| `transparency` | number | `80` |

### SchiffpitchforkLineToolOverrides  (`linetoolschiffpitchfork`)

| property | type | default |
|---|---|---|
| `extendLines` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `level0.coeff` | number | `0.25` |
| `level0.color` | string | `#ffb74d` |
| `level0.linestyle` | number | `0` |
| `level0.linewidth` | number | `2` |
| `level0.visible` | boolean | `false` |
| `level1.coeff` | number | `0.382` |
| `level1.color` | string | `#81c784` |
| `level1.linestyle` | number | `0` |
| `level1.linewidth` | number | `2` |
| `level1.visible` | boolean | `false` |
| `level2.coeff` | number | `0.5` |
| `level2.color` | string | `#089981` |
| `level2.linestyle` | number | `0` |
| `level2.linewidth` | number | `2` |
| `level2.visible` | boolean | `true` |
| `level3.coeff` | number | `0.618` |
| `level3.color` | string | `#089981` |
| `level3.linestyle` | number | `0` |
| `level3.linewidth` | number | `2` |
| `level3.visible` | boolean | `false` |
| `level4.coeff` | number | `0.75` |
| `level4.color` | string | `#00bcd4` |
| `level4.linestyle` | number | `0` |
| `level4.linewidth` | number | `2` |
| `level4.visible` | boolean | `false` |
| `level5.coeff` | number | `1` |
| `level5.color` | string | `#2962FF` |
| `level5.linestyle` | number | `0` |
| `level5.linewidth` | number | `2` |
| `level5.visible` | boolean | `true` |
| `level6.coeff` | number | `1.5` |
| `level6.color` | string | `#9c27b0` |
| `level6.linestyle` | number | `0` |
| `level6.linewidth` | number | `2` |
| `level6.visible` | boolean | `false` |
| `level7.coeff` | number | `1.75` |
| `level7.color` | string | `#e91e63` |
| `level7.linestyle` | number | `0` |
| `level7.linewidth` | number | `2` |
| `level7.visible` | boolean | `false` |
| `level8.coeff` | number | `2` |
| `level8.color` | string | `#F77C80` |
| `level8.linestyle` | number | `0` |
| `level8.linewidth` | number | `2` |
| `level8.visible` | boolean | `false` |
| `median.color` | string | `#F23645` |
| `median.linestyle` | number | `0` |
| `median.linewidth` | number | `2` |
| `median.visible` | boolean | `true` |
| `style` | number | `1` |
| `transparency` | number | `80` |

### SignpostLineToolOverrides  (`linetoolsignpost`)

| property | type | default |
|---|---|---|
| `bold` | boolean | `false` |
| `emoji` | string | `🙂` |
| `fontSize` | number | `12` |
| `italic` | boolean | `false` |
| `plateColor` | string | `#2962FF` |
| `showImage` | boolean | `false` |

### SinelineLineToolOverrides  (`linetoolsineline`)

| property | type | default |
|---|---|---|
| `linecolor` | string | `#159980` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |

### StickerLineToolOverrides  (`linetoolsticker`)

| property | type | default |
|---|---|---|
| `angle` | number | `1.5707963267948966` |
| `size` | number | `110` |

### TextLineToolOverrides  (`linetooltext`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(41, 98, 255, 0.25)` |
| `backgroundTransparency` | number | `70` |
| `bold` | boolean | `false` |
| `borderColor` | string | `#707070` |
| `color` | string | `#2962FF` |
| `drawBorder` | boolean | `false` |
| `fillBackground` | boolean | `false` |
| `fixedSize` | boolean | `true` |
| `fontsize` | number | `14` |
| `italic` | boolean | `false` |
| `wordWrap` | boolean | `false` |
| `wordWrapWidth` | number | `200` |

### TextabsoluteLineToolOverrides  (`linetooltextabsolute`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(41, 98, 255, 0.25)` |
| `backgroundTransparency` | number | `70` |
| `bold` | boolean | `false` |
| `borderColor` | string | `#707070` |
| `color` | string | `#2962FF` |
| `drawBorder` | boolean | `false` |
| `fillBackground` | boolean | `false` |
| `fixedSize` | boolean | `false` |
| `fontsize` | number | `14` |
| `italic` | boolean | `false` |
| `wordWrap` | boolean | `false` |
| `wordWrapWidth` | number | `200` |

### ThreedriversLineToolOverrides  (`linetoolthreedrivers`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(149, 40, 204, 0.5)` |
| `bold` | boolean | `false` |
| `color` | string | `#673ab7` |
| `fillBackground` | boolean | `true` |
| `fontsize` | number | `12` |
| `italic` | boolean | `false` |
| `linewidth` | number | `2` |
| `textcolor` | string | `#ffffff` |
| `transparency` | number | `50` |

### TimecyclesLineToolOverrides  (`linetooltimecycles`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(106, 168, 79, 0.5)` |
| `fillBackground` | boolean | `true` |
| `linecolor` | string | `#159980` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `transparency` | number | `50` |

### TrendangleLineToolOverrides  (`linetooltrendangle`)

| property | type | default |
|---|---|---|
| `alwaysShowStats` | boolean | `false` |
| `bold` | boolean | `false` |
| `extendLeft` | boolean | `false` |
| `extendRight` | boolean | `false` |
| `fontsize` | number | `12` |
| `italic` | boolean | `false` |
| `linecolor` | string | `#2962FF` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `showBarsRange` | boolean | `false` |
| `showMiddlePoint` | boolean | `false` |
| `showPercentPriceRange` | boolean | `false` |
| `showPipsPriceRange` | boolean | `false` |
| `showPriceLabels` | boolean | `false` |
| `showPriceRange` | boolean | `false` |
| `statsPosition` | number | `2` |

### TrendbasedfibextensionLineToolOverrides  (`linetooltrendbasedfibextension`)

| property | type | default |
|---|---|---|
| `coeffsAsPercents` | boolean | `false` |
| `extendLines` | boolean | `false` |
| `extendLinesLeft` | boolean | `false` |
| `fibLevelsBasedOnLogScale` | boolean | `false` |
| `fillBackground` | boolean | `true` |
| `horzLabelsAlign` | string | `left` |
| `horzTextAlign` | string | `center` |
| `labelFontSize` | number | `12` |
| `level1.coeff` | number | `0` |
| `level1.color` | string | `#808080` |
| `level1.text` | string | `undefined` |
| `level1.visible` | boolean | `true` |
| `level10.coeff` | number | `3.618` |
| `level10.color` | string | `#9c27b0` |
| `level10.text` | string | `undefined` |
| `level10.visible` | boolean | `true` |
| `level11.coeff` | number | `4.236` |
| `level11.color` | string | `#e91e63` |
| `level11.text` | string | `undefined` |
| `level11.visible` | boolean | `true` |
| `level12.coeff` | number | `1.272` |
| `level12.color` | string | `#FF9800` |
| `level12.text` | string | `undefined` |
| `level12.visible` | boolean | `false` |
| `level13.coeff` | number | `1.414` |
| `level13.color` | string | `#F23645` |
| `level13.text` | string | `undefined` |
| `level13.visible` | boolean | `false` |
| `level14.coeff` | number | `2.272` |
| `level14.color` | string | `#FF9800` |
| `level14.text` | string | `undefined` |
| `level14.visible` | boolean | `false` |
| `level15.coeff` | number | `2.414` |
| `level15.color` | string | `#4caf50` |
| `level15.text` | string | `undefined` |
| `level15.visible` | boolean | `false` |
| `level16.coeff` | number | `2` |
| `level16.color` | string | `#089981` |
| `level16.text` | string | `undefined` |
| `level16.visible` | boolean | `false` |
| `level17.coeff` | number | `3` |
| `level17.color` | string | `#00bcd4` |
| `level17.text` | string | `undefined` |
| `level17.visible` | boolean | `false` |
| `level18.coeff` | number | `3.272` |
| `level18.color` | string | `#808080` |
| `level18.text` | string | `undefined` |
| `level18.visible` | boolean | `false` |
| `level19.coeff` | number | `3.414` |
| `level19.color` | string | `#2962FF` |
| `level19.text` | string | `undefined` |
| `level19.visible` | boolean | `false` |
| `level2.coeff` | number | `0.236` |
| `level2.color` | string | `#F23645` |
| `level2.text` | string | `undefined` |
| `level2.visible` | boolean | `true` |
| `level20.coeff` | number | `4` |
| `level20.color` | string | `#F23645` |
| `level20.text` | string | `undefined` |
| `level20.visible` | boolean | `false` |
| `level21.coeff` | number | `4.272` |
| `level21.color` | string | `#9c27b0` |
| `level21.text` | string | `undefined` |
| `level21.visible` | boolean | `false` |
| `level22.coeff` | number | `4.414` |
| `level22.color` | string | `#e91e63` |
| `level22.text` | string | `undefined` |
| `level22.visible` | boolean | `false` |
| `level23.coeff` | number | `4.618` |
| `level23.color` | string | `#FF9800` |
| `level23.text` | string | `undefined` |
| `level23.visible` | boolean | `false` |
| `level24.coeff` | number | `4.764` |
| `level24.color` | string | `#089981` |
| `level24.text` | string | `undefined` |
| `level24.visible` | boolean | `false` |
| `level3.coeff` | number | `0.382` |
| `level3.color` | string | `#FF9800` |
| `level3.text` | string | `undefined` |
| `level3.visible` | boolean | `true` |
| `level4.coeff` | number | `0.5` |
| `level4.color` | string | `#4caf50` |
| `level4.text` | string | `undefined` |
| `level4.visible` | boolean | `true` |
| `level5.coeff` | number | `0.618` |
| `level5.color` | string | `#089981` |
| `level5.text` | string | `undefined` |
| `level5.visible` | boolean | `true` |
| `level6.coeff` | number | `0.786` |
| `level6.color` | string | `#00bcd4` |
| `level6.text` | string | `undefined` |
| `level6.visible` | boolean | `true` |
| `level7.coeff` | number | `1` |
| `level7.color` | string | `#808080` |
| `level7.text` | string | `undefined` |
| `level7.visible` | boolean | `true` |
| `level8.coeff` | number | `1.618` |
| `level8.color` | string | `#2962FF` |
| `level8.text` | string | `undefined` |
| `level8.visible` | boolean | `true` |
| `level9.coeff` | number | `2.618` |
| `level9.color` | string | `#F23645` |
| `level9.text` | string | `undefined` |
| `level9.visible` | boolean | `true` |
| `levelsStyle.linestyle` | number | `0` |
| `levelsStyle.linewidth` | number | `2` |
| `reverse` | boolean | `false` |
| `showCoeffs` | boolean | `true` |
| `showPrices` | boolean | `true` |
| `showText` | boolean | `true` |
| `transparency` | number | `80` |
| `trendline.color` | string | `#808080` |
| `trendline.linestyle` | number | `2` |
| `trendline.linewidth` | number | `2` |
| `trendline.visible` | boolean | `true` |
| `vertLabelsAlign` | string | `middle` |
| `vertTextAlign` | string | `middle` |

### TrendbasedfibtimeLineToolOverrides  (`linetooltrendbasedfibtime`)

| property | type | default |
|---|---|---|
| `fillBackground` | boolean | `true` |
| `horzLabelsAlign` | string | `right` |
| `level1.coeff` | number | `0` |
| `level1.color` | string | `#808080` |
| `level1.linestyle` | number | `0` |
| `level1.linewidth` | number | `2` |
| `level1.visible` | boolean | `true` |
| `level10.coeff` | number | `2.618` |
| `level10.color` | string | `#9c27b0` |
| `level10.linestyle` | number | `0` |
| `level10.linewidth` | number | `2` |
| `level10.visible` | boolean | `true` |
| `level11.coeff` | number | `3` |
| `level11.color` | string | `#673ab7` |
| `level11.linestyle` | number | `0` |
| `level11.linewidth` | number | `2` |
| `level11.visible` | boolean | `true` |
| `level2.coeff` | number | `0.382` |
| `level2.color` | string | `#F23645` |
| `level2.linestyle` | number | `0` |
| `level2.linewidth` | number | `2` |
| `level2.visible` | boolean | `true` |
| `level3.coeff` | number | `0.5` |
| `level3.color` | string | `#81c784` |
| `level3.linestyle` | number | `0` |
| `level3.linewidth` | number | `2` |
| `level3.visible` | boolean | `false` |
| `level4.coeff` | number | `0.618` |
| `level4.color` | string | `#4caf50` |
| `level4.linestyle` | number | `0` |
| `level4.linewidth` | number | `2` |
| `level4.visible` | boolean | `true` |
| `level5.coeff` | number | `1` |
| `level5.color` | string | `#089981` |
| `level5.linestyle` | number | `0` |
| `level5.linewidth` | number | `2` |
| `level5.visible` | boolean | `true` |
| `level6.coeff` | number | `1.382` |
| `level6.color` | string | `#00bcd4` |
| `level6.linestyle` | number | `0` |
| `level6.linewidth` | number | `2` |
| `level6.visible` | boolean | `true` |
| `level7.coeff` | number | `1.618` |
| `level7.color` | string | `#808080` |
| `level7.linestyle` | number | `0` |
| `level7.linewidth` | number | `2` |
| `level7.visible` | boolean | `true` |
| `level8.coeff` | number | `2` |
| `level8.color` | string | `#2962FF` |
| `level8.linestyle` | number | `0` |
| `level8.linewidth` | number | `2` |
| `level8.visible` | boolean | `true` |
| `level9.coeff` | number | `2.382` |
| `level9.color` | string | `#e91e63` |
| `level9.linestyle` | number | `0` |
| `level9.linewidth` | number | `2` |
| `level9.visible` | boolean | `true` |
| `showCoeffs` | boolean | `true` |
| `transparency` | number | `80` |
| `trendline.color` | string | `#808080` |
| `trendline.linestyle` | number | `2` |
| `trendline.linewidth` | number | `2` |
| `trendline.visible` | boolean | `true` |
| `vertLabelsAlign` | string | `bottom` |

### TrendlineLineToolOverrides  (`linetooltrendline`)

| property | type | default |
|---|---|---|
| `alwaysShowStats` | boolean | `false` |
| `bold` | boolean | `false` |
| `extendLeft` | boolean | `false` |
| `extendRight` | boolean | `false` |
| `fontsize` | number | `14` |
| `horzLabelsAlign` | string | `center` |
| `italic` | boolean | `false` |
| `leftEnd` | number | `0` |
| `linecolor` | string | `#2962FF` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `rightEnd` | number | `0` |
| `showAngle` | boolean | `false` |
| `showBarsRange` | boolean | `false` |
| `showDateTimeRange` | boolean | `false` |
| `showDistance` | boolean | `false` |
| `showMiddlePoint` | boolean | `false` |
| `showPercentPriceRange` | boolean | `false` |
| `showPipsPriceRange` | boolean | `false` |
| `showPriceLabels` | boolean | `false` |
| `showPriceRange` | boolean | `false` |
| `statsPosition` | number | `2` |
| `textcolor` | string | `#2962FF` |
| `vertLabelsAlign` | string | `bottom` |

### TriangleLineToolOverrides  (`linetooltriangle`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `rgba(8, 153, 129, 0.2)` |
| `color` | string | `#089981` |
| `fillBackground` | boolean | `true` |
| `linewidth` | number | `2` |
| `transparency` | number | `80` |

### TrianglepatternLineToolOverrides  (`linetooltrianglepattern`)

| property | type | default |
|---|---|---|
| `backgroundColor` | string | `#673ab7` |
| `bold` | boolean | `false` |
| `color` | string | `#673ab7` |
| `fillBackground` | boolean | `true` |
| `fontsize` | number | `12` |
| `italic` | boolean | `false` |
| `linewidth` | number | `2` |
| `textcolor` | string | `#ffffff` |
| `transparency` | number | `85` |

### VertlineLineToolOverrides  (`linetoolvertline`)

| property | type | default |
|---|---|---|
| `bold` | boolean | `false` |
| `extendLine` | boolean | `true` |
| `fontsize` | number | `14` |
| `horzLabelsAlign` | string | `center` |
| `italic` | boolean | `false` |
| `linecolor` | string | `#2962FF` |
| `linestyle` | number | `0` |
| `linewidth` | number | `2` |
| `showTime` | boolean | `true` |
| `textOrientation` | string | `vertical` |
| `textcolor` | string | `#2962FF` |
| `vertLabelsAlign` | string | `middle` |
