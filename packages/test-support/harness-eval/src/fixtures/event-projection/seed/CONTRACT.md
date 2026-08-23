# Public contract

Export `projectSession(events)` from `src/project.js`. Events use consecutive one-based `sequence` values and a `type` field.

Supported events are `{ type: 'created', id, title }`, `{ type: 'renamed', title }`, `{ type: 'message', role, text }`, and `{ type: 'deleted' }`. Creation must be first. An unknown event is accepted only when `ignorable === true`, but still advances `sequence`.

Return `{ id, title, messages, deleted, sequence }`. Messages contain only `{ role, text }`. Do not mutate events or retain mutable nested references from them. Reject gaps, unknown non-ignorable events, pre-creation events, and transitions after deletion.
