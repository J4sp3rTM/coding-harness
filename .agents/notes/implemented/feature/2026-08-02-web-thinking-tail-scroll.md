# Agent Note: Web thinking tail scroll — collapsed reasoning follows live output

Status: implemented

English | [中文](2026-08-02-web-thinking-tail-scroll.zh.md)

## Problem

The Web Think row rendered the first reasoning line as its collapsed summary for both settled and streaming blocks. Once that first line existed, every later reasoning delta changed hidden body text only. A fast model therefore looked stationary while it was thinking, and the user had to expand the full chain of thought to verify that output was still moving. The product backlog already called for “thinking: scrolling chain-of-thought updates, expandable”; the current row satisfied only the second half.

## Decision

A Think row converts each run of model-authored whitespace to one visible space. The collapsed summary therefore contains the complete normalized reasoning text, while the expanded body soft-wraps that text at the available width instead of preserving provider line breaks. The raw reasoning block remains unchanged in the session and model history. This normalization does not guess whether a provider split one word across reasoning fragments; it prevents those fragments from creating hard line breaks or blank regions.

Only a collapsed Think row whose reasoning block is the active streaming tail follows live output. Its single-line summary is a programmatic horizontal scrollport pinned to `scrollWidth - clientWidth` after each text update. Direct `scrollLeft` assignment follows real deltas without inventing an independent marquee speed: fast tokens move fast, a paused model stops, and short text stays still because the scroll range is zero. Settlement resets the summary to the left edge; other tool summaries retain their existing ellipsis behavior.

## Alternatives considered

**Animate a CSS marquee independent of streaming.** Rejected: it would keep moving through provider stalls and make a slow model look fast, which breaks the throughput signal the interaction exists to expose.

**Always show a fixed suffix of the complete reasoning string.** Rejected: character slicing can cut a word or grapheme, discards the current line’s beginning before overflow actually requires it, and jumps rather than moving with each delta.

**Auto-scroll the expanded reasoning body or the conversation page.** Rejected: expanded content is a reading surface. Forcing it to follow would fight a user who scrolls back; the follower belongs only to the collapsed one-line summary.

## Consequences

The collapsed row communicates provider cadence through content motion as well as the existing sweep, and reasoning from providers that emit frequent or repeated newlines occupies ordinary wrapped prose instead of tall blank regions. The scroll update runs only on React renders the streaming accumulator already causes; it adds no timer, animation loop, subscription, durable state, or transport traffic. A long reasoning block retains its complete normalized DOM text and programmatically clips only the collapsed summary's overflowing prefix, so expansion and assistive technology expose the same visible wording.

## Testing

`packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx` pins whitespace normalization, the calculated right-edge scroll position, and the settlement reset to `scrollLeft = 0`. The keyless assembled Chromium scenario in `apps/web/tests/lifecycle-chrome.e2e.ts` replays real recorded reasoning chunks at observable pacing, narrows the viewport until the summary overflows, and asserts that the live collapsed Think row reaches its actual browser scroll extent.
