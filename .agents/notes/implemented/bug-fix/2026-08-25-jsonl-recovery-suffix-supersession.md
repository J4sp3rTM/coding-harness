# Agent Note: JSONL recovery-suffix supersession

Status: implemented

English | [中文](2026-08-25-jsonl-recovery-suffix-supersession.zh.md)

## Problem

The JSONL backend coordinates one writer only inside one process. If another process loads an open turn while its original writer is still alive, the loader can persist deterministic interrupted-turn closers and a constructor seed boundary before the original writer flushes its next batch. The original batch then starts at the first synthetic closer's sequence. The artifact contains two branches at the same sequence even though one branch consists only of recovery records.

## Decision

The scanner recognizes one narrow supersession pattern. A conflicting row must start exactly at the beginning of the current event suffix, and that entire suffix must contain only synthetic interrupted-tool results, an optional matching `step/end`, one `turn/end` whose reason is `interrupted`, and an optional trailing `session/end-seed`. The scanner removes that logical suffix and accepts the contiguous continuation from the original writer. The rule runs before packed-row overlap handling, so a packed continuation keeps every event from the branch point.

The conflicting row's first sequence is validated as a non-negative safe integer before it indexes the event prefix, so a malformed sequence reports corruption instead of throwing `RangeError`. All other conflicting ordinary events, mismatched recovery records, events after the seed boundary, and forward sequence gaps remain corruption. The physical append-only artifact is not rewritten; every scan derives the same contiguous logical history.

## Consequences

A session remains loadable when a late original-writer flush supersedes only deterministic recovery output. The rule does not make concurrent writers supported: two processes can still produce irreconcilable branches, and the one-live-writer deployment requirement remains. Operators retain the full physical artifact for diagnosis while the model and UI receive one contiguous event history.

## Testing

Scanner specs cover both synthetic tool-result codes, recovery with and without an open step or seed boundary, an overlapping packed continuation, rejection of mismatched or unrelated committed events, and negative or non-integer sequence numbers reaching the supersession test. The captured session artifact that motivated the rule scans to a contiguous `0..346659` logical history.

## Alternatives considered

Treating every backward sequence as a duplicate was rejected because different committed events would be discarded silently. Truncating at the first conflict was rejected because valid later turns would be lost. Rewriting the middle of compressed append-only storage was rejected because logical supersession is deterministic and preserves the original evidence.
