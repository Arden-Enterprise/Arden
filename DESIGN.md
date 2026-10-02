---
name: Arden
description: A calm, calibrated interface for navigating connected organizational knowledge.
colors:
  charcoal: "#242628"
  warm: "#f4f3ef"
  mist: "#d4d5d5"
  stone: "#929698"
  line: "#dedfdd"
  white: "#ffffff"
  sidebar: "#f8f8f6"
  graph-field: "#fafaf8"
  control-border: "#d0d2d1"
typography:
  headline:
    fontFamily: "Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "27px"
    fontWeight: 660
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 670
    lineHeight: 1.18
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    lineHeight: 1.7
  label:
    fontFamily: "Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 650
  graph-label:
    fontFamily: "Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 680
rounded:
  small: "4px"
  medium: "6px"
  large: "8px"
spacing:
  compact: "8px"
  small: "12px"
  medium: "16px"
  section: "24px"
  page: "32px"
components:
  navigation-active:
    backgroundColor: "{colors.charcoal}"
    textColor: "{colors.white}"
    rounded: "{rounded.medium}"
    padding: "0 11px"
    height: "39px"
  navigation-idle:
    backgroundColor: "transparent"
    textColor: "#515759"
    rounded: "{rounded.medium}"
    padding: "0 11px"
    height: "39px"
  search-field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.medium}"
    padding: "0 10px"
    height: "37px"
  scope-selected:
    backgroundColor: "{colors.white}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.small}"
    padding: "0 10px"
    height: "28px"
  graph-surface:
    backgroundColor: "{colors.graph-field}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.large}"
  sample-badge:
    backgroundColor: "transparent"
    textColor: "#4c5253"
    rounded: "{rounded.small}"
    padding: "8px 9px"
---

# Design System: Arden

## Overview

**Creative North Star: "The Calibrated Workspace"**

Arden's shared web and Windows desktop shell is a quiet operating surface for inspecting a connected knowledge graph. The network carries the visual complexity; navigation, controls, and the Knowledge Pane stay precise and restrained. Warm paper surrounds near-white working surfaces, and charcoal marks the current selection.

The geometry is mostly square with small softened corners. Hairline divisions separate ownership, context, and action without suggesting that sample content is live organizational data. The current interface is a preview: its graph interactions work against illustrative nodes, while other destinations and AI are visibly marked as planned.

**Key Characteristics:**

- Warm monochrome palette with no chromatic accent.
- A graph-dominant desktop workspace and a stacked mobile reading order.
- Ownership and selection conveyed by node shape, fill, outline, and text.
- Compact labels and measured rules instead of decorative panels.

## Colors

Charcoal is the only strong emphasis color; warm, white, and closely spaced greys establish surfaces and hierarchy.

### Primary

- **Charcoal** (`colors.charcoal`): Primary text, active navigation, selected graph nodes, and keyboard focus.

### Neutral

- **Warm Paper** (`colors.warm`): App background and selected mobile list item.
- **White** (`colors.white`): Knowledge Pane, controls, search, and many node centers.
- **Sidebar Paper** (`colors.sidebar`): Quiet left rail and planned-feature panel.
- **Graph Field** (`colors.graph-field`): The network canvas behind its faint dot grid.
- **Mist** (`colors.mist`): Personal and external node fills.
- **Stone** (`colors.stone`): Reserved secondary grey in the shared shell palette.
- **Line** (`colors.line`): Structural separators between the rail, top bar, pane, and content sections.
- **Control Border** (`colors.control-border`): Search, filter, and graph-control outlines.

**The Single Emphasis Rule.** Use charcoal for current or selected state. Keep other interface chrome within the warm neutral family.

## Typography

**Display and body font:** Segoe UI, then the UI sans-serif and system sans-serif fallbacks. The shell uses one family; weight, size, spacing, and case create hierarchy.

### Hierarchy

- **Headline** (`typography.headline`): Graph page title; it reduces to 25px at mobile widths.
- **Title** (`typography.title`): Selected item's name in the Knowledge Pane.
- **Body** (`typography.body`): Item summary and supporting explanation. Body line heights vary by context; the pane summary uses 1.7.
- **Label** (`typography.label`): Navigation, pane sections, controls, and metadata. Many compact labels use 9–11px, with uppercased tracked labels for section or status markers.
- **Graph label** (`typography.graph-label`): Node title; it grows to 18px below the mobile breakpoint. The node type is a smaller subordinate line.

**The Clear Annotation Rule.** Keep graph item names readable even when their nodes are out of focus; de-emphasize the mark and edges before fading label text.

## Layout

The desktop shell uses three columns: a 218px navigation rail, a flexible graph workspace, and a 330px Knowledge Pane. The top bar is 66px high. The graph page has 32px horizontal padding, and the graph canvas expands to occupy the dominant remaining space.

At 1220px and below, the side columns contract to 194px and 290px. At 980px and below, navigation becomes a 70px icon rail beside a 280px pane. At 760px and below, the layout stacks: a sticky 52px navigation strip, the main graph and controls, a selected-item summary and direct item list, then the Knowledge Pane. At 480px and below, the graph height is 390px and page gutters narrow to 12px. The collapsed pane uses a 53px rail on desktop and remains a full-width section on mobile.

Recurring internal distances include compact 8px gaps, 12px row and edge padding, 16px control separation, 24px pane section padding, and 32px desktop page gutters. They describe the shipped rhythm, not a requirement that every future element use one of these measurements.

## Elevation & Depth

The workspace is flat by default. White against warm paper and fine grey borders establish layers. Limited shadows appear on the selected filter segment, the graph controls, and the search focus treatment; they indicate an interactive surface rather than a floating visual theme.

### Shadow Vocabulary

- **Selected segment** (`0 1px 3px rgba(36, 38, 40, 0.09)`): Separates the active scope button from its grey track.
- **Graph controls** (`0 5px 15px rgba(36, 38, 40, 0.08)`): Keeps the zoom and Fit controls legible over the network canvas.
- **Search focus** (`0 0 0 2px rgba(36, 38, 40, 0.08)`): Supplements the search field's darker focused border.

**The Flat Workspace Rule.** Default pane and navigation surfaces use color and hairline borders for separation; reserve shadows for these interactive controls.

## Shapes

Corners are modest: 4px for small badges and selected filter buttons, 6px for navigation and fields, and 8px for the main graph canvas. The workspace switch uses a 7px corner. One-pixel grey borders define cards and divisions.

Graph geometry encodes source kind. Shared items are white circles with a solid outline; personal items are mist-filled circles with a dashed outline; external items are mist-filled squares. The selected item becomes a filled charcoal mark with a visible halo. These shapes are accompanied by text labels and a legend.

## Components

### Navigation

The active Graph destination is a charcoal filled 39px row with white text and icon (`components.navigation-active`). Idle destinations are transparent and grey (`components.navigation-idle`); unavailable destinations remain visibly labeled “Soon” and disabled. The rail collapses to icons at 980px and becomes a compact top strip at 760px.

### Search and scope controls

The search field (`components.search-field`) is white with a fine border, search icon, and a darker border plus low-contrast ring on focus. Scope buttons sit on a grey segmented track; the selected option (`components.scope-selected`) is white with a small shadow. Search and scope wrap into full-width rows on mobile.

### Graph surface and nodes

The bordered graph canvas (`components.graph-surface`) has a faint 24px dot grid. Nodes carry title and type labels, the selected item's connections receive stronger strokes, and non-neighbor marks recede. Graph emphasis transitions take 180ms with ease. The global reduced-motion rule reduces transitions to 0.01ms. Zoom and Fit controls sit at the lower right of the canvas.

### Knowledge Pane

The white pane has a 66px header, a selected-item identity block, Context definition list, Connections list, and a bordered planned AI callout. One-pixel section rules and restrained text weights carry the hierarchy. It becomes the section below the graph on mobile.

### Sample and mobile selection markers

The sample badge (`components.sample-badge`) is outlined, compact, uppercase, and visible beside the page title. On mobile, a bordered selected-item summary and a direct list of sample items provide access alongside the pannable graph.

## Do's and Don'ts

### Do:

- **Do** keep the graph dominant on desktop while retaining visible status, source, and relationships in the Knowledge Pane.
- **Do** use the same neutral shape grammar and text labels for shared, personal, and external items.
- **Do** preserve clear sample-data and planned-feature labeling wherever preview content or unavailable actions appear.
- **Do** use charcoal focus and selection states, with reduced-motion behavior for graph transitions.

### Don't:

- **Don't** introduce a bright accent, decorative gradient, or decorative metric into this calibrated workspace.
- **Don't** rely on faded text alone to express graph focus or ownership.
- **Don't** present illustrative nodes or planned destinations as live organizational data or working features.
