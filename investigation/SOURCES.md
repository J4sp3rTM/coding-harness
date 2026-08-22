# Investigation sources

## Piebald Claude Code prompt extraction

- Source: <https://github.com/Piebald-AI/claude-code-system-prompts/tree/main/system-prompts>
- Local path: `references/piebald-source/system-prompts/`
- Pinned revision: `cd32cca47201494537e23ca3218ce4be46d2f432`
- Revision date: `2026-08-20T09:36:12-06:00`
- Snapshot description: Claude Code v2.1.237 prompt extraction.
- Files pulled: 685 prompt fragments: 68 agent prompts, 123 data/reference fragments, 88 skills, 229 system prompts/reminders, and 177 tool descriptions/parameters.

## Codex CLI prompt snapshot

- Source: <https://gist.github.com/chigkim/ffed11a3e017d98698707dd24e78af51#file-codex-txt>
- Local path: `references/codex-gist/codex.txt`
- Pinned revision: `8335a8d8cd440c54f9271666c91cb96a3262cde8`
- Revision date: `2026-01-15T06:10:34Z`

## Supplementary official guidance

- OpenAI model guidance: <https://developers.openai.com/api/docs/guides/latest-model>
- Relevant point: keep system prompts and tool descriptions lean, expose only relevant tools, state instructions once, and evaluate prompt changes on representative tasks rather than assuming more prompt text improves quality.

## Use of the snapshots

These are research snapshots, not production dependencies. Do not package, republish, or copy their prompt text into the application without a separate license and provenance review. The design proposal extracts architectural concepts and points to the local files for inspection; it does not treat third-party wording as implementation source.

## Refreshing the local snapshots

The nested repositories use `.source-git` instead of `.git` so the parent repository treats their working files as ordinary investigation artifacts. Refresh explicitly with `--git-dir` and `--work-tree`, then record the new revision in this file before comparing prompt changes.
