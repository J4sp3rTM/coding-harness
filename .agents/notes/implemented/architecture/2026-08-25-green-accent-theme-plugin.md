# Agent Note: Green accent theme plugin

Status: implemented

English | [中文](2026-08-25-green-accent-theme-plugin.zh.md)

## Problem

The Web GUI ships one blue brand palette. A second logo-green accent must live as its own client plugin, compose with the existing light/dark/system preference, and retract on dispose. An in-memory toggle that leaked `overrideTokens` after HMR would strand later theme work.

## Decision

`@deepseek-ai/dsh-client-ui-theme-green` owns a Host settings namespace `ui-theme-green.accent` (`default` | `green`) and a General settings row. `green` stacks alias-token overrides through `ThemeRuntime.overrideTokens`; `default` retracts them. The live disposer is a plugin-fiber effect, so disable and HMR remove the layer. Token values are theme-owned CSS variables (`--dsw-static-green-300` is logo `#35e888`); the plugin does not copy RGB literals. Light/dark/system stay on `ui-theme`. Feature sheets that still read `--dsw-static-deepseek-*` stay blue.

## Consequences

The accent persists with other Host-backed preferences on loopback and stays process-local on a remote browser. Third-party themes remain an override layer, not a fourth Appearance cube. Later accents can reuse this namespace-plus-override pattern without widening `ThemePreference`.

## Testing

Host specs register and reject invalid accents. Client apply specs stack and retract the layer, adopt Host updates, keep remote browsers process-local, and recover after the General item declaration collapses. The row and store specs cover selection and the revision guard.

## Alternatives considered

Registering `green` / `green-dark` as ThemeRuntime themes was rejected because `ThemePreference` is the durable built-in set and Appearance would then fork light/dark. Widening `ui-theme.preference` was rejected because a missing plugin must not leave an unresolvable durable id. Copying RGB literals into the feature plugin was rejected because `ui-theme` owns the static scale.