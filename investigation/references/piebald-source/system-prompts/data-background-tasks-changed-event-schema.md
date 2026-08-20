<!--
name: "Data: Background tasks changed event schema"
description: "Schema description for the background_tasks_changed system event and its replace-set semantics"
ccVersion: "2.1.203"
-->
The full set of live background tasks, emitted whenever membership changes (start, completion, kill, a foreground agent being backgrounded). A level signal, unlike the task_started/task_notification edge bookends: consumers that only need 'is background work running' should replace their set with each payload rather than pairing edges, so a missed bookend cannot wedge a stale running indicator. Ordering relative to the bookends for the same transition is unspecified (in practice the level precedes them) and the payload carries ids only, so do not correlate it with the edge stream. The level is per-process: nothing is emitted at startup, so consumers must reset to the empty set whenever the session's CLI process (re)starts and let the next membership change repopulate it.
