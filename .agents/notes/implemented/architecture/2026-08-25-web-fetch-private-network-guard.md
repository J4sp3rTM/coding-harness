# Agent Note: Private-network guard scope for the local web fetch provider

Status: implemented

English | [中文](2026-08-25-web-fetch-private-network-guard.zh.md)

## Problem

`dsh-web-fetch-http` shipped as an acknowledged SSRF primitive: it validated URL hygiene but nothing stopped the model from pointing it at loopback services, private ranges, or cloud metadata endpoints. That deficiency was the recorded reason the shipped compositions kept `web_fetch` disabled and the provider unmounted ([tool-roster Agent Note](../feature/2026-07-31-even-out-shipped-tool-rosters.md), [web-default-search Agent Note](../feature/2026-07-31-web-default-search.md)). Enabling model-chosen retrieval therefore required deciding how much private-network protection ships by default — without it, enabling fetch would hand every deployment an unconfined internal-target probe.

## Decision

The provider enforces a minimal private-network guard before connecting ([`src/ssrf.ts`](../../../../packages/web/web-fetch-http/src/ssrf.ts)):

- **Hostname rules** (no DNS cost when they hit): `localhost`, `*.localhost`, and `.local` names are refused.
- **Address ranges**: IPv4 loopback (127.0.0.0/8), this-network (0.0.0.0/8), private 10/8, 172.16/12, 192.168/16, link-local 169.254/16 including cloud metadata `169.254.169.254`; IPv6 loopback (::1), unspecified (::), unique-local (fc00::/7), link-local (fe80::/10), and IPv4-mapped addresses whose embedded IPv4 part is blocked.
- **Resolve-before-connect on every hop**: hostnames resolve through `node:dns` (`all: true`) immediately before each connection — the direct target and every redirect destination alike — and a name resolving to ANY blocked address is refused, so a mixed public/private answer cannot slip through on its public member. Blocked targets fail with `WEB_BLOCKED_URL`.
- **One waiver, narrow by construction**: `allowLoopback` (default `false` — enforcing) lifts ONLY the loopback class, for loopback fixture servers and local development. No config path disables the rest of the guard.

With the guard in place the base composition enables `web_fetch` against this provider; the ordered search fallback that landed in the same change is owned by [the preference-list Agent Note](2026-08-25-web-provider-preference-list.md).

### Known limitation, stated rather than hidden

The check cannot pin the address the transport finally connects to: Node resolves again at connect time, so a DNS server answering differently between check and connect (DNS rebinding) defeats this guard. The README records that TOCTOU explicitly instead of claiming full protection; a deployment that must contain outbound traffic still needs a network-level control. Multicast, reserved blocks, and deprecated IPv6 site-local space are likewise out of scope.

## Alternatives considered

**A rebinding-safe transport (custom dispatcher connecting to the checked IP).** Rejected for this change: it means owning connection-level transport surgery (certificate/SNI semantics, redirect re-resolution) whose blast radius reaches every fetch; the documented TOCTOU keeps the honest boundary while the default gets real coverage.

**Permission prompts or a per-domain allowlist.** Rejected here: approval flow belongs to the interaction seam and would make every fetch interactive; suffix allowlists are unmaintainable and give no protection against never-seen hosts.

**Rely on sandbox network confinement instead of a guard.** Rejected: the harness has no shipped network confinement layer yet, and `bash` already reaches the same targets — waiting for confinement would leave the argument-shaped primitive unguarded indefinitely.

**No waiver field at all.** Rejected: the test suites exercise real HTTP over loopback fixtures, and local development legitimately targets localhost; a boolean waiving exactly one named class (defaulting to enforcing) keeps that honest, where a global disable switch would not have been acceptable.

## Consequences

Every shipped surface gains model-driven page retrieval behind the guard, and the rosters/composition tests that asserted `web_fetch`'s absence move with it. Loopback snapshot and integration overlays set `allowLoopback: true` so fixture servers still fetch; the rest of the guard stays enforced. The guard raises the bar from "unconfined SSRF primitive" to "public-web fetcher with documented gaps": loopback fixtures keep working through the explicit waiver, internal-network exposure shrinks to DNS-rebinding-class attacks, and the residual risk is written down where deployers read it rather than implied away.
