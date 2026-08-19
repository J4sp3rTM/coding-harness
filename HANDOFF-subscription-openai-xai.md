# Handoff: OpenAI (ChatGPT) and Grok (xAI) subscription sign-in

## Start here

The plumbing for all subscription providers is already built and shared. `anthropic` is verified end to end against a real Claude Pro/Max account. **`openai-codex` and `xai` are already offered, already adopt, and already register their models** — what is missing is one UI affordance, and verification against real accounts.

Do not build a per-provider login. There is one seam and one flow source; a provider is offered because the installed pi-ai catalog ships an OAuth method for it.

Read [`packages/llm/llm-oauth/README.md`](packages/llm/llm-oauth/README.md) first, then the Agent Note at `.agents/notes/implemented/architecture/2026-08-19-provider-subscription-sign-in.md`.

## What already works (verified)

Seeding a token document and booting `--profile web` registers both routes with their catalog models:

```
llm-pi-ai: subscription sign-ins: openai-codex, xai
llm-pi-ai: route openai-codex — auth subscription, 7 model(s)
llm-pi-ai: route xai — auth subscription, 3 model(s)
```

- Both flows produce real authorization URLs. Codex: `auth.openai.com/oauth/authorize`, loopback on `:1455`, after a `select` between browser and device-code login. xAI: device-code only.
- Sign-in from the terminal works today for both: `node --import tsx/esm dsh-login.mts openai-codex` (or `xai`). The script prints device codes immediately, so **Grok is already usable this way**.
- Codex needs nothing from the stored `extra` fields — it extracts `chatgpt_account_id` from the JWT access token itself.

## Task 1 — device-code flows are invisible in `/login` (the real blocker)

`packages/llm/command-login/src/index.ts`, `commandInteraction()`. Flow events are accumulated into `pending[]` and flushed only as the `detail` of the **next** prompt. That works for Anthropic and for Codex's browser branch, which both prompt right after handing out the URL.

The xAI flow — and Codex's device-code branch — **never call `prompt`**. They notify once with a `device-code` event and then poll. So the user sees nothing at all, and the sign-in silently times out.

The fix needs a way to show a message and keep waiting. `ctx.userQuestions` is question-shaped, so there is no plain "notify" channel. Options, roughly in order of preference:

1. Ask a real question that carries the code and stays open — a single "I've entered the code / Cancel" prompt raced against the flow's own polling, cancelled when the flow resolves. Mirrors how the manual-code fallback already races the loopback callback, so it fits the existing pattern.
2. Surface `LlmOAuthEvent` on the session log or a client slot, so the UI can render progress without a question.

Whichever way, `notify` must stop swallowing events that no later prompt will carry. Add a test with a flow that only notifies — `packages/llm/command-login/tests/command-login.spec.ts` already has a `SelectingOAuth` subclass to copy.

## Task 2 — verify against real accounts

Nobody has completed a Codex or xAI sign-in, or sent a request on either route. For each:

1. `node --import tsx/esm dsh-login.mts <route>`, complete it, confirm the entry lands in `~/.dsh/.oauth.json` (mode 0600, `access`/`refresh`/`expires`).
2. Restart `pnpm dsh web`, confirm the startup line reports the route and a model count.
3. Pick one of its models in the composer and send a prompt. **This is the step that has never run for these two.**
4. Let an access token expire (or edit `expires` to the past) and send another request — the refresh happens inside pi-ai under the store's lock. Confirm the rotated token is written back and the request succeeds.

## Task 3 — decide the attribution question for these two

`packages/llm/llm-pi-ai/src/adapter.ts`, `requestHeaders()`: subscription requests send no harness `user-agent`. This is **required** for Anthropic (its OAuth path sets a CLI user agent that our header would otherwise replace, and the endpoint refuses anything else).

For the other two it is not required and may not be wanted:
- Codex sets `User-Agent`, `originator: "pi"`, and `chatgpt-account-id` **after** our headers, so ours could never have overridden it. Withholding is harmless but pointless there.
- xAI has no such identity of its own, so withholding just means those requests carry no attribution at all.

Consider narrowing the rule to "withhold only where the provider's OAuth path sets its own identity", instead of all subscription routes. That is a one-line predicate plus a test; the current blanket rule is documented in the Agent Note under *App attribution is withheld on a subscription request*, and that section needs updating with whatever you decide.

Note that pi-ai identifies itself to OpenAI as `originator: "pi"`, not as Codex. Whether that is accepted long-term is outside our control and worth watching.

## Task 4 — the `/login` client mystery (may already be fixed)

`/login` did nothing in the web UI. The host side is proven: the plugin applies, `ctx.llmOAuth` resolves with all 7 routes, and boot fails loud on any pending plugin. The break is client-side and was never diagnosed — check whether `/login` reaches the slash popup (`packages/client/ui-commands`), and whether any other slash command works. This may have been the missing log exporter all along.

## Do not

- Do not add a provider-specific login package. If a provider should be offered and is not, the question is whether the installed pi-ai catalog ships an OAuth method for it (`catalogProviderTakesOAuth` in `packages/llm/llm-pi-ai/src/catalog.ts`).
- Do not open a browser for the user. That was tried, it spawned tabs during a test run, and it was removed deliberately. Any host integration that launches an external program must be injected and stubbed in tests.
- Do not require a `settings.yaml` profile for a signed-in route. Adoption is deliberate — see `adoptedRoutes()` in `packages/llm/llm-pi-ai/src/index.ts`.

## Repo hygiene that was skipped

This work was done with the documentation gates deliberately deferred, at the user's instruction. Before this can merge, `pnpm run doc-sync` needs: the generated catalogs regenerated (`gen-cordis-catalog`, `gen-config-catalog`, `gen-doc-graphs`), a `doc-typecheck` failure investigated, and Chinese counterparts recorded for the three new package READMEs and the Agent Note (`verify-translation-pairing --write`). `pnpm typecheck`, `run-oxlint`, and the `packages/llm` + `packages/bundle` suites are green as of this handoff.
