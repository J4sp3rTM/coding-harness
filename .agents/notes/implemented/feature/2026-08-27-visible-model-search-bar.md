# Agent Note: Visible model search bar

Status: implemented

English | [中文](2026-08-27-visible-model-search-bar.zh.md)

## Problem

The composer's model pane can contain models from several providers, but its implicit keyboard filter appears only after typing as a small status line. Users cannot discover the filter before using it, and the feedback competes with the model list inside the compact popup.

## Decision

The model pane displays a full-width search field above the provider groups and focuses it when the pane opens. The field filters provider and model names and IDs through the existing directory projection; a provider match retains all of that provider's models. Arrow keys move focus into the filtered model rows, Escape follows the existing pane and popup dismissal behavior, and closing the popup clears the query. The popup is wide enough for the field and keeps the field inside its visible bounds.

This presentation partially supersedes the implicit-filter decision in the [session model selector note](2026-07-24-web-session-model-selector.md); that note remains active because it owns session selection, directory, ordering, and persistence decisions.

## Alternatives considered

**Keep implicit pane-wide typing and enlarge only its feedback.** A larger status line would improve query visibility only after typing and would still leave search undiscoverable.

**Add a search button that reveals the field.** The extra activation preserves a few rows of height but hides the primary navigation aid behind another control.

## Consequences

Search is visible and directly editable, including spaces and native text-selection commands. The fixed field consumes 50 pixels of popup height, leaving less room for model rows before scrolling. The popup uses dialog semantics around a search field and a nested ARIA menu rather than placing a textbox inside an ARIA menu.

## Testing

The component test pins focused search, provider and model filtering, spaces, no-result feedback, row navigation, and query reset. The built-browser test pins the field's visible bounds and width, focus, filtering, keyboard selection, and reset through the production model plugin.
