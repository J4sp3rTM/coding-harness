# Agent Note: Empty pi-ai startup is debug, not stderr

Status: implemented

English | [中文](2026-08-25-pi-ai-empty-startup-is-debug.zh.md)

## Problem

The shipped `dsh` binary wrote routine first-run facts to stderr at info level: `llm-pi-ai: subscription sign-ins: (none)` and `llm-pi-ai: no provider routes registered — sign in with /login, or add a provider on the Models settings page`. Consumers that treat stderr as the error channel — including the keyless badge snapshot's `expect(disabled.stderr).toBe('')` — then failed on a successful boot with no credentials.

## Decision

[`reportRoutes()`](../../../../packages/llm/llm-pi-ai/src/index.ts) logs the ordinary empty state at `debug`. Configured routes still log at `info`, and a signed-in subscription that serves no models still logs at `warn`, because those are the user-visible symptoms. The empty first-run default is not an error and is not the question a stderr consumer is asking.

## Alternatives considered

**Keep info and relax the badge snapshot.** Rejected: the empty-stderr assertion is the contract that caught the leak. Treating first-run emptiness as a user-facing error channel would keep breaking every other stderr consumer.

**Silence the empty state entirely.** Rejected: operators who raise the log level still need a way to confirm the adapter mounted with no routes.

**A dedicated user-facing surface.** Deferred: `/login` and the Models page already own that question; duplicating it on boot is noise.

## Consequences

Keyless boots stay silent on stderr. Debug logging still shows the empty report. Route presence and a signed-in-but-empty catalog remain visible at info/warn.
