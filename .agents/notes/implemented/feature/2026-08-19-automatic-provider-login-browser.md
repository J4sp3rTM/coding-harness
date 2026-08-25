# Agent Note: Automatic provider login browser

Status: implemented

English | [中文](2026-08-19-automatic-provider-login-browser.zh.md)

## Problem

`/login` displayed an authorization URL or device-verification URL but required the human to click it. That extra action added friction on a local desktop, while opening every URL unconditionally would be wrong for a remote or headless Host whose browser is not in front of the user.

## Decision

[`dsh-command-login`](../../../../packages/llm/command-login/README.md) hands each reported HTTPS authorization or device-verification URL to the command Host's default browser. macOS uses `open`, Windows and WSL use the registered URL handler, and a Linux desktop uses `xdg-open`. Every launcher runs as argv through the shell-free native-command runner.

The command launches only absolute `https:` targets. Linux launches only when a display server or WSL desktop route is present. A headless host, an unsupported platform, or a launcher failure leaves sign-in running and keeps the URL and device code visible through `ctx.userQuestions`; automatic opening is an optimization, never the only path.

The browser hand-off is operation-local. Duplicate notifications for one URL launch once, cancellation reaches an in-flight launcher, and command teardown waits for started launchers to settle.

This presentation decision partially supersedes the manual-only alternative in the [subscription sign-in architecture](../architecture/2026-08-19-provider-subscription-sign-in.md); that note remains active because it owns the capability split, token storage, provider flows, and request authentication posture.

## Alternatives considered

**Always launch on the command Host.** Rejected because a remote or headless Host may have no user-visible desktop. Display and WSL detection preserve the visible-link path there.

**Let pi-ai open the browser.** Rejected because pi-ai reports URLs through its interaction API and does not own Harness host policy or the remote-host fallback.

**Accept any URL scheme reported by a flow.** Rejected because operating-system URL handlers can dispatch local files or other privileged schemes. Provider authorization and verification targets must be HTTPS.

## Consequences

Local desktop sign-in normally opens without a click, including xAI's device-code page. Users still see the exact URL and code, so launcher failures and remote deployments retain the same recoverable flow. The command package gains one native subprocess dependency and platform-specific tests pin every launch choice and the HTTPS refusal.
