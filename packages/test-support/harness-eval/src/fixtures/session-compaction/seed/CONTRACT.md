# Public contract

Export `compactTranscript(messages, budget)` from `src/compact.js`. `budget` is the maximum sum of each message's numeric `tokens`. Return cloned messages in chronological order without mutating the input.

Preserve the contiguous system prefix and the latest user message. An assistant message with `toolCalls: [callId, ...]` and its immediately following `{ role: 'tool', callId }` results form one indivisible group. Reject orphaned, missing, reordered, or mismatched tool results.

After required groups, retain the newest complete groups that fit. If the required groups exceed the budget, throw an error mentioning the budget.
