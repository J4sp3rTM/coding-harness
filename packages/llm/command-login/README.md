# dsh-command-login

English | [中文](README.zh.md)

Human-facing `/login` and `/logout` over the [subscription sign-in seam](../llm-oauth/README.md).

Sign-in is a conversation, not a form: the flow hands out an authorization URL or device code, waits for the provider, and takes any redirect URL or choice it needs from the human. The command opens HTTPS authorization and device-verification pages in the local default browser when the host has a desktop route. Every interaction also travels through [`ctx.userQuestions`](../../interaction/user-questions/README.md), so the visible URL remains the fallback for headless and remote hosts and no surface needs a sign-in screen of its own.

## Commands

- `/login` — sign in to the only offered route, or ask which one when several are offered. The chooser lists each route with its subscription label and current state.
- `/login <provider>` — go straight to that route.
- `/logout <provider>` — remove this machine's stored token set for that route.

Flow events are carried into the question that needs them. An authorization URL appears as the supporting text of the provider's next prompt. A device code appears immediately in an acknowledgement question while the provider keeps polling; completing the flow dismisses the question, and choosing Cancel aborts the flow. Browser-launch failures do not fail sign-in because the same URL and code remain visible.

A successful `/login` says which route is now on the subscription and how to reverse it. `/logout` says the stored token is gone from this machine and that the authorization itself is revoked on the provider's own account page.

Expected failures are reported as command errors rather than raised: a route the deployment does not offer (naming the ones it does), a cancelled sign-in, and a flow that did not complete. A deployment composing no sign-in service says so instead of offering an empty chooser.

## Composition

```yaml
- id: command-login
  name: '@deepseek-ai/dsh-command-login'
```

Requires `commands`, `llmOAuth`, and `userQuestions`. Both registrations are effects, so disposing the fiber withdraws both commands; already-started sign-ins are drained before teardown completes.

`/login` advertises optional command input: a bare invocation executes immediately and opens the route chooser, while space or an explicit provider enters the argument path. `/logout` requires its advertised provider input.

## Model Experience

None, as both commands execute against the receiving agent without sending anything to the model, and their outcome text is human-only.

#### KV Cache effect

None directly; neither command touches the request prefix. A route switched onto a subscription may present a different system prompt on its next request, which the [adapter](../llm-pi-ai/README.md) owns.

## Known Limitations and Deferred Work

- **No account status command** — `accounts()` is on the seam, and a status line belongs to whichever UI renders one; a `/login` with several routes offered shows it in passing.
