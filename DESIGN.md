---
name: Playlist Sorter
description: An enamelled charcoal departure board that rewrites a playlist row by row in front of you.
colors:
  board: "#17191b"
  board-lit: "#1e2225"
  board-deep: "#101214"
  seam: "#0d0f10"
  rule: "#32383c"
  rule-soft: "#23282b"
  unlit-flap: "#15181a"
  unlit-flap-lit: "#1a1d20"
  flap: "#f0e7d4"
  flap-dim: "#b4ada0"
  flap-faint: "#918b80"
  amber: "#f2a71b"
  amber-lit: "#ffc84d"
  amber-deep: "#4a3a12"
  amber-edge: "#8a6310"
  amber-riser: "#74530d"
  green: "#4faa6e"
  green-deep: "#16321f"
  green-seat: "#1b2a20"
  green-seat-lit: "#223327"
  red: "#e2705a"
  red-deep: "#3d1c16"
typography:
  display:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "clamp(2rem, 5.5vw, 4.25rem)"
    fontWeight: 600
    lineHeight: 0.94
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "clamp(1.4rem, 2.6vw, 2rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
  body:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  row:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "normal"
  label:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "0.7rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.18em"
  numeral:
    fontFamily: "Azeret Mono Variable, ui-monospace, monospace"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "'tnum' 1"
rounded:
  none: "0"
spacing:
  step: "4px"
  cell-x: "clamp(10px, 1.4vw, 18px)"
  gutter: "clamp(16px, 3vw, 40px)"
  head-y: "clamp(28px, 5vh, 56px)"
  section-y: "clamp(22px, 4vh, 40px)"
  row-desktop: "46px"
  row-mobile: "58px"
components:
  lever:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.board-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "13px 26px"
  lever-disabled:
    backgroundColor: "{colors.board-lit}"
    textColor: "{colors.flap-faint}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "13px 26px"
  lever-quiet:
    backgroundColor: "{colors.board-lit}"
    textColor: "{colors.flap}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "11px 20px"
  chip-amber:
    backgroundColor: "{colors.amber-deep}"
    textColor: "{colors.amber}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  chip-green:
    backgroundColor: "{colors.green-deep}"
    textColor: "{colors.green}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  chip-red:
    backgroundColor: "{colors.red-deep}"
    textColor: "{colors.red}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  field:
    backgroundColor: "{colors.board-deep}"
    textColor: "{colors.flap}"
    typography: "{typography.numeral}"
    rounded: "{rounded.none}"
    padding: "12px 14px"
    width: "100%"
  option:
    backgroundColor: "{colors.board}"
    textColor: "{colors.flap-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "9px 15px"
  option-selected:
    backgroundColor: "{colors.amber-deep}"
    textColor: "{colors.amber}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "9px 15px"
  board-row:
    backgroundColor: "{colors.board-lit}"
    textColor: "{colors.flap}"
    typography: "{typography.row}"
    rounded: "{rounded.none}"
    height: "{spacing.row-desktop}"
  board-row-written:
    backgroundColor: "{colors.green-seat-lit}"
    textColor: "{colors.flap}"
    typography: "{typography.row}"
    rounded: "{rounded.none}"
    height: "{spacing.row-desktop}"
  strategy:
    backgroundColor: "{colors.board-lit}"
    textColor: "{colors.flap}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "12px 14px"
    width: "100%"
  notice:
    backgroundColor: "{colors.board-lit}"
    textColor: "{colors.flap-dim}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "14px 16px"
---

# Design System: Playlist Sorter

## Overview

**Creative North Star: "The Departure Board"**

One physical object fills the viewport: an enamelled charcoal station board with hinged flap cards seated in it. Nothing here is a table floating on a dark page. The frame runs edge to edge, the head rule is composed at display scale as a board legend rather than a toolbar, and wherever seated rows stop, unlit flaps carry the rest of the frame down to the lever row. The board is the page.

The personality is mechanical, dense, and unsentimental. Colour is quarantined to state the way a real board only inks DELAYED: the resting board is charcoal and flap-cream, and amber, green, or red appear only when a row has something true to say about itself. Type is condensed uppercase for the board's own voice, Barlow for prose a person actually reads, and Azeret Mono for every numeral in the product so any column reads straight down. Corners are square everywhere; depth comes from the flap seat, not from rounding or blur.

The build serves an Operate visitor — one person completing a deliberate task. That shows up as density over comfort, hard rules over whitespace separation, and motion that is real progress rather than decoration: the flap cascade is staged off write-completion order from the execute loop, so what you are watching is the API actually returning.

**Key Characteristics:**
- One board object owning the full viewport, never a card on a page
- Flap cards: lit top half, shadowed bottom half, hairline seam across the fold
- Colour quarantined to state — amber pending/moving, green committed, red cannot-be-carried
- Zero radius, hard 1px vertical column rules, tabular mono numerals
- Stepped mechanical motion (`steps()`), never eased-smooth

## Colors

A charcoal-and-cream material palette with three state inks and nothing else; every hue in the product means something.

### Primary
- **Signal Amber** (`{colors.amber}`): The board's only voluntary colour. It marks pending and moving — the scheduled position in a row's gutter, the moving tally, the selected strategy and option, the meter fill, the caret, the selection highlight, the focus ring, and the primary lever face. **Amber Lit** (`{colors.amber-lit}`) is the lever's top half only; **Amber Deep** (`{colors.amber-deep}`) is the seated background behind amber text in chips and selected options; **Amber Edge** and **Amber Riser** are the lever's border and its key riser.

### Secondary
- **Committed Green** (`{colors.green}`): A row that has actually been written. **Green Seat** and **Green Seat Lit** re-tint the flap card's two halves so a committed row changes material, not just text colour; **Green Deep** backs green chips.
- **Blocked Red** (`{colors.red}`): Reserved for what cannot be carried — local files and unavailable tracks. It inks the track title outright, because dimming a blocked row read as de-emphasis instead of as a warning. **Red Deep** backs red chips and the alert notice's top edge.

### Neutral
- **Enamelled Charcoal** (`{colors.board}`): The board body, and the base of every flap card's lower half.
- **Lit Charcoal** (`{colors.board-lit}`): The top half of every seated flap card, the notice ground, and the quiet lever face. This is the colour text has to survive against.
- **Deep Charcoal** (`{colors.board-deep}`): Recessed surfaces — page ground behind the frame, input wells, scrollbar track, meter ground — and the text colour on the amber lever.
- **Seam Black** (`{colors.seam}`): Hairlines only. The fold across a flap, the bottom edge of a row, the band edges in the unlit field.
- **Hard Rule** (`{colors.rule}`) and **Soft Rule** (`{colors.rule-soft}`): Structural borders and column rules respectively. Hard rule frames objects; soft rule divides columns inside one.
- **Unlit Flap** / **Unlit Flap Lit** (`{colors.unlit-flap}` / `{colors.unlit-flap-lit}`): The two bands of a blank flap in the unlit field.
- **Flap Cream** (`{colors.flap}`): Primary character colour — the colour of a printed flap under light. Headings, row titles, body emphasis, links.
- **Flap Dim** (`{colors.flap-dim}`) and **Flap Faint** (`{colors.flap-faint}`): Secondary and tertiary characters — artist, added date, duration, column labels, held positions, placeholders.

### Named Rules

**The Quarantined Colour Rule.** Amber, green, and red state a fact about a row or a control: pending/moving, committed, cannot-be-carried. There is no decorative, brand, or emphasis use of colour anywhere in this system. If a new element wants colour and cannot name the state it reports, it stays charcoal and cream.

**The Two Data Greys Rule.** `flap-dim` and `flap-faint` both carry real data, so both clear 4.5:1 against the lit half of a flap card (`{colors.board-lit}`) — 7.2:1 and 4.7:1 respectively. A new dim tone must be measured against the lit half, not against the board body, and must not go below 4.5:1 in order to look quieter.

**The Material Tint Rule.** A row that changes state changes its material, not just its ink: `data-written` retints both halves of the card to the green seat pair, `data-moves` warms both halves. Never signal row state with text colour alone.

## Typography

**Display Font:** Barlow Condensed (600) — the board's voice
**Body Font:** Barlow (400/500) — anything a person reads as a sentence
**Numeral Font:** Azeret Mono Variable, tabular

**Character:** Condensed uppercase caps behave like painted board legends; Barlow underneath is plain and legible without personality of its own; the mono numerals are the working instrument. The pairing is signage over utility, with no third voice.

### Hierarchy
- **Display** (600, `clamp(2rem, 5.5vw, 4.25rem)`, 0.94): The destination — the playlist name in the head rule. One per screen, balanced wrap, uppercase.
- **Headline** (600, `clamp(1.4rem, 2.6vw, 2rem)`, 1.05): Section and empty-state headings inside the board. Uppercase.
- **Title** (600, 1.05rem, +0.06em): Strategy names and notice titles. Uppercase, lightly tracked.
- **Body** (400, 1rem, 1.45): Prose, capped at 68ch and set in `flap-dim`; `<strong>` lifts to full flap cream at weight 500 rather than bolding.
- **Row** (500, `--fs-row` 0.95rem): Track and playlist titles inside board rows; single-line with ellipsis on desktop, 1.25 line-height when the artist folds beneath it on phone.
- **Label** (600, `--fs-label` 0.72rem, +0.1em to +0.18em, uppercase): Column headers, field labels, chips, options, the back control. The tracking is what makes these read as stencilled board legends rather than small body text.
- **Sub** (400, `--fs-sub` 0.82rem): Secondary row text — artists, dates, durations, strategy notes, small prose beneath a control.
- **Control** (600, `--fs-control` 0.85rem, uppercase): The quiet lever, one step above a label because it is a target rather than a legend.
- **Numeral** (mono, tabular, −0.02em): Every number in the product.

### Named Rules

**The Tabular Numeral Rule.** Positions, counts, durations, dates, and tallies are all Azeret Mono with `font-variant-numeric: tabular-nums` and `'tnum'` on, via a single `.num` class. A column of numbers must read straight down with no digit drift. There is no numeral anywhere in this product set in Barlow.

**The Board Voice Rule.** Condensed uppercase is reserved for board furniture — labels, controls, headings, chips. Prose is never condensed and never uppercase; a sentence longer than a few words is Barlow sentence case.

## Layout

The frame is a full-viewport flex column (`min-height: 100dvh`) with a 3px top rule and an inset hairline, holding a centred inner track capped at 1440px with a `clamp(16px, 3vw, 40px)` gutter. Screens that own an internal scroller (the boards) bind the frame to `100dvh` and hide overflow, so the lever row seats at the bottom edge of the board; screens that flow instead use a sticky lever row with a gradient dissolve above it. Vertical rhythm is a 4px step; cell padding is `clamp(10px, 1.4vw, 18px)`.

The board is a grid of five modules on the track screens (`104px | 1fr | 20ch | 13ch | 8ch`, 46px rows) and four on the playlist screen (`64px | 1fr | 14ch | 11ch`, 58px rows). The column header, every seated row, and the unlit field all read the same `--cols` and `--row-h`. Rows are windowed with 10 rows of overscan against a measured row height, so the board scales past the ~400-track playlists it holds today.

There are two breakpoints. At 900px the two-column `split` (a 320px rail beside a 1fr body) collapses to one column. At 680px the board sheds the artist and added columns, the track cell stacks the artist under the title, the head rule stacks to a column, and the lever row wraps with the primary lever pulled to its own full-width line.

### Named Rules

**The Single Grid Declaration Rule.** `grid-template-columns` and `--row-h` are declared once per screen per breakpoint, on `.board` / `.board-playlists`. The header, the seated rows, and the unlit field inherit them. Declaring the grid per element is what let the unlit field draw four column modules against three seated rows at phone width; `UnlitField` measures its module count off the resolved grid for the same reason, never a literal.

**The Row Direction Rule.** The shared cell rule makes every board cell a column flex box. Any cell that lays out horizontally must state `flex-direction: row` explicitly, or `justify-content` and `align-items` silently swap meaning — this pushed the Playlists track cell to the bottom of its row and flushed the position gutter's numerals to the top. `.cell-end` states it; `.slots` deliberately stays a column and puts its horizontal run one level in, on `.slots-inner`.

**The Gutter-Last Rule.** The two-numeral position gutter is what makes a reorder legible, so it is the last thing to collapse. At ≤680px the artist folds under the track title and the added column goes; the gutter survives at 88px. (This resolves the responsive question the surface brief left open.)

## Elevation & Depth

There is no ambient shadow language. Depth is material: a flap card is a two-stop linear gradient with the lit half on top and the board-coloured half below, a `::after` hairline seam across the fold at 50%, a 1px seam at the bottom edge, and a seat shadow that is one hairline highlight plus a short dark spread. That stack reads as a card seated in a frame under overhead light. The board body itself carries a 220px top-down light wash and an inset hairline, which is the only lighting cue at the object level.

The one raised element is the primary lever, which sits on a hard 3px riser in its own darker amber and depresses 3px on `:active` — the riser is the key's side face, native to a physical panel, not a decorative offset shadow.

### Shadow Vocabulary
- **Seat** (`0 1px 0 rgb(255 255 255 / 3%), 0 2px 6px -2px rgb(0 0 0 / 55%)`): Every seated flap row. Also the lever's resting shadow once depressed.
- **Lift** (`0 6px 18px -6px rgb(0 0 0 / 70%)`): The primary lever at rest, under its riser. Nothing else uses it.
- **Inset hairline** (`inset 0 0 0 1px`): The frame edge, and the disabled lever's seated well.

### Named Rules

**The Seated Card Rule.** Depth in this system is the flap seat — lit half, fold seam, seat shadow. A new surface earns depth by being a seated card, not by gaining a blur radius. Do not add ambient drop shadows to flat board furniture.

**The Fold Is Physical Rule.** The fold survives the flap being blank. The unlit field draws a mid-band seam and a band-edge seam at exactly the seated row's half-height rhythm, so an empty board reads as unlit flaps rather than as a dimmer flat panel. The seam is a property of the hinge, not of the lighting.

## Shapes

Radius is zero everywhere, including on inputs, buttons, chips, the meter, and the playlist artwork — the `border-radius: 0` on `.lever`, `.field`, and the scrollbar thumb is an explicit override of the user-agent default, not an omission. Form language is rectangular modules divided by hairlines: 1px soft rules between column modules, 1px seam hairlines across folds and beneath rows, 1px hard rules framing objects, 2px hard rules where a structural band closes (head rule bottom, lever row top, peek and notice top edges), and 3px at the frame's top edge and the notice's tone edge. Adjacent members of a stack overlap their borders by −1px rather than doubling them (`.strategy + .strategy`). The only non-rectangular geometry in the build is the `clip-path` inset that drives the flap cycle.

### Named Rules

**The Zero Radius Rule.** Nothing in this system is rounded. A radius anywhere reads as a web widget dropped onto a steel panel.

**The Continuous Rule Rule.** The board's hard vertical column rules run the full height of the board, through seated rows and through unlit flaps alike. That is why the unlit field is a real grid of empty cells rather than a painted repeating background — a gradient cannot know where the grid tracks fall.

## Components

Every control is board furniture. Nothing in this system is a stock widget wearing the palette.

### Buttons
- **Shape:** Square (0 radius), uppercase condensed caps at +0.14em.
- **Primary — the Lever:** Amber two-stop face (lit top half over `{colors.amber}`), deep charcoal characters, 1px `{colors.amber-edge}` border, 3px `{colors.amber-riser}` riser plus the lift shadow, `13px 26px`.
- **Hover / Active:** Hover brightens the face 6%; active translates 3px down and collapses the riser to the seat shadow, transitioned in `80ms steps(2, end)` so the key snaps rather than glides.
- **Disabled:** Becomes an unlit flap — the seated card gradient, the fold seam via `::after`, `{colors.rule}` border, inset seam well — but the label stays in `{colors.flap-faint}`, legible. See the Dimmed Flap Rule.
- **Quiet Lever:** Seated flap-card face, flap-cream characters, hard rule border, `11px 20px`. Hover lifts the border to `{colors.flap-faint}` in stepped time. Used for secondary and destructive-adjacent actions (Dry Run, Clone and Sort, Cancel).
- **Back control:** A real button in the head rule, condensed caps at +0.18em in `flap-dim`, amber on hover. It is navigation, not a label above the heading.

### Chips
- **Style:** Square, 1px border, condensed caps at 0.68rem/+0.14em, `2px 8px`. The untoned default is `{colors.rule}` border on `{colors.flap-dim}` text with no fill.
- **State:** `data-tone` swaps all three of text, border, and fill to the matching state triple (amber/green/red over their `-deep` seats). Chips never carry a tone that is not one of the three states.

### Cards / Containers
- **Corner Style:** Square.
- **Background:** Board body for frames and sticky bars; the flap-card gradient for anything seated (rows, strategies, peek rows, suggestions).
- **Shadow Strategy:** Seat only; see Elevation & Depth.
- **Border:** 1px hard rule to frame, upgraded to 2px or 3px on the edge that carries meaning (notice tone edge, peek top).
- **Internal Padding:** `14px 16px` for notices, `{spacing.cell-x}` horizontally inside board cells, `clamp(22px, 4vh, 40px)` for sections.

### Inputs / Fields
- **Style:** Full-width well — deep charcoal ground, 1px hard rule, square, mono at 0.95rem, `12px 14px`. Mono because the values typed here are identifiers, not prose.
- **Focus:** Border goes amber and the default outline is suppressed; elsewhere in the app `:focus-visible` is a 2px amber outline at 2px offset.
- **Label:** Condensed caps at +0.18em in `flap-dim`, 7px above the well.
- **Placeholder:** `{colors.flap-faint}`.
- **Copy strip:** A field-width well split by a 1px rule into a mono amber value and a condensed-caps copy key; the key's label swaps to "Copied" for 1.6s rather than firing a toast.

### Navigation
There is no persistent nav. Movement between the five screens is the head rule's back control plus the lever row at the foot of the board, so the board object is never interrupted by chrome that belongs to a site rather than to a machine.

### The Board Row (signature)
A grid row at a fixed `--row-h` whose background is the flap-card gradient, with a fold seam at 50%, a seam hairline beneath, and the seat shadow. Cells are separated by soft 1px rules from the second child onward. The left gutter carries the diff: a moving row shows the current position in `flap-faint`, a leader, and the scheduled position in amber 600; a holding row shows one position in `flap-dim` and a dimmed dash. `data-moves`, `data-written`, and `data-blocked` retint the card or the title. On the Playlists screen the same row becomes a full-width button with a hover retint.

### The Unlit Field (signature)
Whatever board frame the seated rows do not fill is carried by blank flaps: a grid of empty cells sharing the board's resolved columns, banded by a repeating gradient at exactly the row's half-height rhythm, with seam hairlines at the fold and the band edge. It sits above the last seated row's shadow on a clean seam so the shadow does not bleed into the first band. Its module count is measured from the resolved grid at runtime.

### The Flap Character Cell (signature)
A numeral that cycles through random digits at 55ms for 4 ticks before landing on its value, clipped by a `steps(2, end)` inset animation and inked amber while cycling. Used on scheduled positions and on live tallies. Under `prefers-reduced-motion: reduce` it swaps straight to the new value with no cycle.

### Motion
Motion is mechanical and stepped: `steps(5, end)` over 300ms for the row turn (a scaleY squash with a brightness flicker), `steps(2, end)` for the flap clip and control transitions, `steps(4, end)` for the meter. The meter is scaled on `transform`, never resized on `width`. The cascade down the board is staged by the order the execute loop's writes complete — one row turns as its own API call returns — not by `animation-delay` on row index. A global reduced-motion block collapses every animation and transition to 0.01ms.

### Named Rules

**The Dimmed Flap Rule.** Disabled is a blank flap: the seat, the fold seam, and the material are all preserved, but the characters are dimmed to `{colors.flap-faint}` rather than removed. A control with no legible label is a puzzle. Never blank a label to signal disabled.

**The Real Progress Rule.** The flap cascade is driven by actual write completion, so the animation is progress rather than decoration. Do not stagger board motion with `animation-delay`; if a new surface animates a sequence, the sequence must be a real one.

**The Board Furniture Rule.** New controls are built from the board's own materials — seated flap face, hard rule, condensed caps, square corners. A stock widget restyled with the palette does not belong on this object.

## Do's and Don'ts

### Do:
- **Do** set every numeral in Azeret Mono with `.num` (tabular figures), including dates, durations, counts, and positions.
- **Do** declare the board grid once per screen per breakpoint on `.board` / `.board-playlists` and let the header, rows, and unlit field inherit it.
- **Do** state `flex-direction: row` on any board cell that lays out horizontally.
- **Do** fill unused board frame with unlit flaps banded at the seated row's half-height rhythm, so the board never runs out into dark page.
- **Do** keep the two-numeral position gutter at every width; fold the artist under the title at ≤680px instead.
- **Do** give a disabled control the unlit-flap treatment while keeping its label legible at `{colors.flap-faint}`.
- **Do** use `steps()` timing for every transition and keyframe, and provide a hard-swap path under `prefers-reduced-motion`.
- **Do** claim the browser's own surfaces — selection, caret, accent, scrollbar, focus ring — in the board's palette.
- **Do** measure new dim tones at 4.5:1 or better against `{colors.board-lit}`, not against the board body.

### Don't:
- **Don't** use amber, green, or red for anything that is not pending/moving, committed, or cannot-be-carried.
- **Don't** round a corner. Radius is zero on every element, and `border-radius: 0` is stated explicitly where the user agent would otherwise supply one.
- **Don't** add ambient or blurred drop shadows to flat board furniture; depth is the flap seat.
- **Don't** ease a transition. Mechanical stepping is the world's motion grammar; `cubic-bezier` smoothing reads as a web app, not a machine.
- **Don't** stagger a cascade with `animation-delay` when a real completion order exists.
- **Don't** set prose in Barlow Condensed or in uppercase; condensed caps are for board furniture only.
- **Don't** signal row state with text colour alone when the row can change material.
- **Don't** float the board as a card on a dark page — the frame owns the viewport as one object.
- **Don't** paint the unlit field as a background image behind the grid; it must occupy real column modules so the vertical rules continue through it.

### Known gaps in the shipped build (record, do not inherit)
- Character-cell flapping runs on position numerals and tallies only; track titles swap without flapping.
- "Enamelled" is delivered as flat charcoal with a top light wash; there is no grain or texture on the board body.
- Connect's empty area is plain board ground rather than unlit flaps, because it has no scroller and banding behind centred copy would read as a backdrop.
- The head-rule back control uses a `&lsaquo;` text glyph as its chevron. This is a carried defect, not a pattern: new affordances should use an inline SVG mark or no mark at all.
