# Reusable harness engineering for DeepSeek Harness

## Recommendation

Build a versioned **Harness Pack** system on top of the capabilities the app already has. A harness pack should be app-owned, provider-neutral, selected per agent preset, pinned into each session, and loaded from the installed application or `$DSH_HOME` rather than copied into every repository.

Do not replace the current plugin architecture with another agent framework. The existing system-prompt registry, skill registry, agent presets, workflow engine, hooks, compaction, goals, guards, sandbox, and snapshot infrastructure are already the correct primitives. The missing product layer is a coherent package that combines those primitives into reusable operating instructions, named workflows, validation profiles, evidence capture, and model-behavior evaluations.

The permanent system prompt should remain small. It should explain the execution contract, authority boundaries, and how to discover harness resources. Detailed workflows and domain instructions should be loaded on demand from the selected harness pack.

## What the references contain

### Piebald prompt collection

The Piebald repository is not one system prompt. The pulled revision contains 685 independently extracted fragments split across five roles:

| Role | Purpose | Examples |
|---|---|---|
| System prompt and reminder fragments | Stable behavior plus event-specific context | harness identity, tool policy, plan mode, hook feedback, diagnostics, compaction notices |
| Tool descriptions and parameters | Operational contracts located beside the tool | Bash, Edit, Read, Grep, Agent, Workflow, TodoWrite |
| Agent prompts | Specialized workers with constrained responsibilities and tools | Explore, Plan, review finders/verifiers, workflow workers, summarizers |
| Skills | On-demand procedures rather than permanent prompt text | runtime verification, hook construction, security review, plugin evaluation |
| Data/reference fragments | Structured reference material injected only into relevant flows | event schemas, API references, evaluation formats, managed-agent metadata |

The fragments contain variable placeholders and conditional sections. The runtime assembles only the fragments relevant to the current product mode, available tools, platform, permissions, or event. Tool-specific instructions live in tool descriptions. Specialized agents receive narrower prompts and often have mutation tools removed. Runtime reminders are emitted after events such as a hook block, a truncated file read, a diagnostic update, a plan transition, or a workflow worktree allocation.

The collection's strongest harness ideas are architectural rather than textual:

- Keep the permanent identity short and compose conditional sections at runtime.
- Put exact operational rules in the tool that owns the behavior.
- Give exploration, planning, review, and workflow workers explicit scopes and restricted tool sets.
- Use structured output at orchestration boundaries so scripts receive validated data rather than parsing prose.
- Treat tests, runtime verification, and code review as different evidence lanes.
- Emit event-specific reminders only when the event occurs.
- Make multi-agent workflows explicit, bounded, observable, and opt-in when they can spend substantial resources.
- Separate workflow pipelines from synchronization barriers; synchronize only when a later stage needs the complete prior result set.
- Verify candidate review findings independently and classify them as confirmed, plausible, or refuted.
- Preserve resumable context through structured summaries, exact paths, errors, decisions, and pending work rather than a generic narrative.

Some Piebald fragments should not be copied directly. The TodoWrite and Workflow descriptions are extremely large, the compaction prompt preserves more material than most continuations need, and several instructions repeat the same policy at multiple levels. The useful part is the runtime composition model and the explicit execution protocols, not the total prompt volume.

### Codex gist

The Codex prompt is mostly monolithic. It combines identity, personality, repository-instruction discovery, progress messages, planning, autonomy, editing rules, sandbox/approval semantics, validation philosophy, final-answer formatting, shell guidance, tool schemas, and tool-call syntax in one document.

Its useful ideas are:

- Continue until the user-visible outcome is actually complete.
- Match the action to the request type: explanation and diagnosis are read-only unless implementation is requested; fix/build requests authorize scoped edits and validation.
- Give progress updates before tool-heavy work.
- Prefer root-cause fixes, preserve unrelated work, and avoid destructive Git operations.
- Start validation narrowly and expand only as confidence or risk requires.
- Distinguish unit tests from built-artifact and real-entry-path behavior.
- State sandbox and approval behavior explicitly so the model knows when to proceed and when to ask.

Its weak point for this application is exactly the problem this investigation addresses: too much product behavior is encoded as static prompt prose, and repository-specific behavior still depends on `AGENTS.md`. The tool schemas and formatting rules also dominate the prompt even when a task does not need them.

### Official OpenAI guidance

Current official model guidance reinforces the lean approach: state instructions once, expose only relevant tools, keep tool descriptions precise, track context growth, and compare prompt variants on representative tasks. More prompt text is not automatically a stronger harness. The system needs evals that can prove a fragment, workflow, or tool improves task success enough to justify its token and latency cost.

## Harness-engineering concepts worth keeping

### 1. Stable core, conditional policy, on-demand procedures

Use three prompt layers with different lifetimes:

1. **Stable core** — short identity, authority rules, persistence, evidence expectations, and the mechanism for discovering harness resources.
2. **Conditional runtime policy** — platform, permission mode, plan mode, selected harness pack, available tool class, current goal, and event-driven reminders.
3. **On-demand procedures** — investigation, implementation, verification, review, debugging, migration, and framework-specific instructions loaded through skills or named workflows.

This makes the common request prefix cacheable and prevents every task from paying for every procedure.

### 2. Tool contracts are part of the harness

A tool description should define:

- When to use the tool and when not to use it.
- Input and output fields, validation behavior, and stable error codes.
- Side effects, permission implications, cancellation, timeout, and cleanup behavior.
- What evidence the tool returns and what information is truncated or spilled.
- The exact distinction between direct calls, background jobs, and workflow calls.

Do not duplicate the same contract in the global persona. The tool package should own its schema and its short cross-call guidance section, matching the current `dsh-system-prompt` convention.

### 3. Validation is not one command

Keep four separate validation lanes:

| Lane | Question answered | Typical evidence |
|---|---|---|
| Static gates | Is the source internally consistent? | lint, typecheck, schema checks |
| Automated tests | Do known cases still pass? | focused unit/integration tests, then broader affected suites |
| Built entry path | Does the shipped artifact boot and execute? | built binary, packaged worker, real loader composition |
| Runtime verification | Does a user-visible flow behave correctly? | CLI output and exit code, API response, browser interaction, screenshot, persisted state |

The Piebald `verify` skill is valuable because it insists on driving the real surface, but its instruction to avoid tests entirely is too absolute for this harness. Runtime verification should complement the targeted test lane, not replace it.

### 4. Structured workflow boundaries

Workflow workers should return schema-validated objects. A parent script must not infer correctness from free-form prose. Useful built-in patterns are:

- Parallel discovery by independent search angles.
- Per-item pipelines where each item advances without waiting for unrelated items.
- Barrier stages only for deduplication, global ranking, or cross-item comparison.
- Independent verification of candidate findings.
- A completeness critic that identifies missing coverage before the run ends.
- Bounded retries, agent counts, concurrency, tokens, elapsed time, and output size.
- Explicit user opt-in for expensive orchestration modes.

### 5. Context is durable state, not prompt decoration

Anything the model relies on should be reconstructable from the session log. Harness selection, validation plans, validation results, workflow lifecycle, evidence references, and compaction checkpoints should therefore be durable events or durable model-visible messages. In-memory state may accelerate lookups but must not be the only authority.

### 6. Evaluation closes the loop

Prompt and workflow changes should be evaluated with and without the harness against the same task set. The primary graders should inspect the resulting workspace and executed application, not the agent's final claim. Optional model judges can grade explanation quality, but they should not decide whether code compiles, tests pass, or a runtime response is correct.

## Mapping to the current application

| Reference concept | Existing DeepSeek Harness capability | Assessment and action |
|---|---|---|
| Conditional prompt fragments | `dsh-system-prompt` ordered/scoped sections, variables, contexts, assembly waterfall | Strong foundation. Use it for a small stable core and short active-pack notice. |
| Tool-owned instructions | Tool schemas plus `tool:*` prompt sections | Keep. Shorten verbose schemas where measured; do not move tool rules into the persona. |
| Specialized agents | Agent presets, scoped registrations, spawn/fork providers | Strong foundation. Add harness-defined roles and capability restrictions through presets/workflows. |
| On-demand skills | `dsh-skill`, `dsh-skill-filesystem`, `dsh-tool-skill` | Strong foundation. Make app-owned harness skills a first-class provider root instead of requiring repository files. |
| Repository instruction files | `dsh-agent-instructions` loads `AGENTS.md`/`CLAUDE.md` | Keep as optional compatibility input, not the primary harness. A repository should work well with no instruction file. |
| Dynamic workflows | `dsh-workflow`, worker-thread engine, `dsh-tool-workflow`, Ralph | Good execution core. Missing named saved workflows, journaling/resume, background collection, and aggregate token/time budgets. |
| Plan state | `dsh-plan-mode` | Keep. The current logged state and stable tool catalog are better than a prompt-only mode. |
| Todo/task tracking | `dsh-tool-todo` | Keep concise and use for nontrivial implementation only. Do not force it for trivial work. |
| Hooks | hook protocol plus Claude Code/Codex bridges | Good compatibility layer. Add native harness validation policies rather than encoding every gate as an external hook command. |
| Loop guards | repeat-tool reminder and timeout policy | Keep and extend through measured policies, not generic nag text. |
| Context management | session log, token meter, compaction, tool-result pruner, spill | Strong foundation. The current structured checkpoint is leaner than the referenced Claude compaction prompt. |
| Long-running automation | goals, jobs, schedule, ACP, Ralph | Strong primitives. Harness workflows should compose them rather than introduce another scheduler. |
| Product testing | unit, coverage, real-API, snapshot, browser snapshot, replay, loader smokes | Excellent for testing DeepSeek Harness itself. Add a separate cross-model task-evaluation layer for measuring agent output. |
| Runtime invariants | `dsh-invariants` companions | Keep for harness integrity. These do not replace project validation or user-visible verification. |

## Main gaps

1. **No app-owned resource unit.** Skills, preset compositions, workflow scripts, validation knowledge, and eval cases have no single versioned manifest or lifecycle.
2. **No session-pinned harness identity.** A session records its agent preset but not an explicit harness pack id, version, digest, or resource inventory.
3. **No saved workflow registry.** The current workflow tool accepts model-written scripts but cannot select a shipped, reviewed workflow by name.
4. **No first-class project validation service.** Agents can run commands, but the app cannot produce a structured, change-aware validation plan and evidence report for an arbitrary opened repository.
5. **No cross-model harness eval suite.** Existing snapshots validate the application protocol and presentation, not whether different models solve representative coding tasks better with one harness revision.
6. **Compatibility instructions are too central.** `dsh-agent-instructions` makes repository files useful, but the baseline experience still needs to be excellent without them.
7. **No trust model for executable harness resources.** A pack can contain workflows and validation commands, so system, user, and project sources need explicit precedence, visibility, and authorization rules.

## Proposed Harness Pack format

Use two default roots:

- Installed, read-only packs: `<app-install>/config/harness-packs/`
- User-authored packs: `$DSH_HOME/harness-packs/`

Repository-local additions may be supported later through an explicit project setting, but they are optional. The app must never create `AGENTS.md`, `CLAUDE.md`, `.agents`, or a harness directory inside a user's repository just to provide baseline behavior.

Suggested pack layout:

```text
harness-packs/
  coding/
    harness.yml
    instructions/
      core.md
      validation.md
    skills/
      investigate/SKILL.md
      implement/SKILL.md
      debug/SKILL.md
      verify/SKILL.md
      review/SKILL.md
    workflows/
      investigate.workflow.js
      change.workflow.js
      verify.workflow.js
      review.workflow.js
    validation/
      profiles.yml
      detectors/
        node.yml
        python.yml
        rust.yml
        go.yml
    evals/
      manifest.yml
      tasks/
    resources/
      schemas/
      report-templates/
```

Minimal manifest shape:

```yaml
schemaVersion: 1
id: coding
version: 0.1.0
description: Provider-neutral coding harness

instructions:
  core: instructions/core.md

skills:
  root: skills

workflows:
  root: workflows
  exposed: [investigate, change, verify, review]

validation:
  profiles: validation/profiles.yml

evals:
  manifest: evals/manifest.yml
```

The loaded representation should be immutable and carry a content digest. Unknown manifest fields, duplicate ids, path escape, symlink escape, invalid resource names, unreadable files, and executable resources from an untrusted source should fail before a session starts.

## Runtime architecture

### Harness pack registry

Add a capability seam rather than hard-coding directory reads in the loop:

- `packages/harness/harness` — Service Definition for `ctx.harnessPacks`; list, resolve, and load immutable pack metadata and resources.
- `packages/harness/harness-filesystem` — Service Provider for installed and `$DSH_HOME` roots with explicit `system` and `user` trust.
- `packages/harness/harness-session` — Consumer that selects a pack through the agent preset, records `{ id, version, digest }`, and registers its prompt, skills, workflows, and validation profiles into the agent scope before the first request.
- `packages/harness/command-harness` — Human diagnostics such as `/harness status`, `/harness list`, and `/harness validate-pack`.

Do not add a broad model-facing file browser for the pack. Bridge pack skills into `ctx.skills`, named workflows into a workflow registry, and validation profiles into the validation service. The model should use the existing specialized tools and see only summaries relevant to the active session.

Pack selection belongs beside the agent preset because both define the session's model-facing capability set. A new session pins one pack generation; edits affect later sessions. Mid-session switching should be rejected after any model-visible output for the same reason agent-preset switching is currently locked.

### Named workflow registry

Add a registry beside the current execution engine:

- `ctx.workflows.register(definition)` with name, description, input schema, output schema, script, trust, and resource limits.
- `ctx.workflows.list(scope)` and `ctx.workflows.get(name, scope)`.
- Extend `dsh-tool-workflow` with a mutually exclusive `name` or `script` request. Named workflows use reviewed pack code; inline scripts retain the existing explicit-user-opt-in policy.
- Record workflow definition id, version/digest, arguments, limits, child lifecycle, and final structured result.

Start with foreground execution and the current worker-thread engine. Journaling, resume, nested workflows, and background collection are useful later, but they should not block a reliable named-workflow MVP.

### Validation capability

Add a real Service Definition / Provider / Consumer seam:

- `packages/validation/validation` — owns `ValidationPlan`, `ValidationCheck`, `ValidationEvidence`, and `ValidationReport` types plus the provider registry.
- `packages/validation/validation-project` — reads project manifests, lockfiles, changed files, and pack profiles to propose checks.
- `packages/validation/tool-validate` — model-facing `validate` tool that previews or executes a plan through the existing shell/subprocess/sandbox/approval stack.
- `packages/validation/validation-policy` — optional post-edit or pre-finish policy that can inject missing-check reminders without silently running expensive commands.

A check should include at least:

```ts
interface ValidationCheck {
  id: string
  kind: 'static' | 'test' | 'build' | 'entry' | 'runtime'
  command: readonly string[]
  cwd: string
  timeoutMs: number
  reason: string
  affectedBy: readonly string[]
  sideEffects: 'read-only' | 'workspace-write' | 'external'
}
```

The result should retain command, working directory, start/end times, exit code, bounded output, spill/evidence references, and pass/fail/skipped/blocked status. The session log must record the plan and results so a resumed agent can distinguish checks already run from claims made only in prose.

Project adapters should discover existing commands from files such as `package.json`, lockfiles, workspace manifests, `pyproject.toml`, `Cargo.toml`, `go.mod`, Makefiles, and CI configuration. They should not invent commands, install dependencies, or run an entire repository suite merely because it exists. Pack profiles can express trigger rules such as “TypeScript source changed,” “public package export changed,” “Electron main process changed,” or “UI component changed.”

### Evidence capture

Use the existing spill service for large outputs and add stable evidence types:

- Terminal capture: command, exit code, stdout/stderr reference.
- HTTP capture: method, URL class, status, selected headers, body reference.
- Browser capture: route, action sequence, screenshot, console/page errors.
- Filesystem capture: path, digest before/after, expected untouched paths.
- Built-artifact capture: artifact path/digest and invocation result.

Evidence is an artifact of the validation run, not text the model is trusted to summarize correctly. Final messages can cite evidence, while automated graders inspect the structured record.

## Built-in workflows

### Investigate

1. Identify the relevant capability and entry path.
2. Search independent code areas in parallel when they do not depend on each other.
3. Trace the request, state, or event through its real runtime path.
4. Return a structured map of findings, files, assumptions, and unresolved facts.

This workflow is read-only by capability restriction, not merely by prompt instruction.

### Change

1. Inspect the current implementation and applicable pack skills.
2. Form a small implementation plan when the task is nontrivial.
3. Apply scoped edits while preserving unrelated work.
4. Generate a change-aware validation plan.
5. Run targeted static/tests, then the built or runtime surface when applicable.
6. Re-read the diff and report outcome, evidence, and any unverified path.

### Verify

1. Classify the user-visible surface reached by the changed files.
2. Build or launch the real entry path.
3. Exercise the changed behavior through that surface.
4. Probe at least one adjacent error or edge case chosen from the change.
5. Capture evidence and return `PASS`, `FAIL`, `BLOCKED`, or `SKIP` with exact reasons.

Unlike the referenced verify skill, this workflow does not forbid tests. It consumes existing test results as one lane and separately requires runtime evidence when a runtime surface exists.

### Review

1. Establish the exact diff and surrounding code.
2. Run independent finder angles for correctness, lifecycle/concurrency, security/permissions, and compatibility/data migration only when relevant.
3. Deduplicate candidates by mechanism and affected line.
4. Independently classify each candidate as confirmed, plausible, or refuted.
5. Report only concrete, actionable findings with a trigger and wrong outcome; retain plausible items separately when the user asked for a broad audit.

## System prompt role

The eventual system prompt should describe the harness, not contain the harness.

Keep always-on text limited to:

- Role and current workspace.
- Request-to-authority mapping.
- Persistence and completion expectations.
- Safety, destructive action, and external-write boundaries.
- Requirement to use app-provided harness resources when their catalog matches the task.
- Evidence rule: never claim validation that did not run; report blocked or unverified paths explicitly.
- Progress-update behavior for tool-heavy work.

Everything else should be conditional or on demand:

- Plan policy only while plan mode is active.
- Platform-specific shell guidance only for the active shell tool.
- Workflow authoring details only when the workflow tool is selected.
- Validation procedure through the `verify` skill or named workflow.
- Frontend browser requirements only when the change classifier identifies a UI surface.
- Model/provider-specific compatibility only in the relevant adapter or preset.

The system prompt must stay model-neutral so DeepSeek, OpenAI, Anthropic, and other subscription-backed routes receive the same behavioral contract. Provider adapters may add the minimum protocol-specific framing required by their API, but they should not fork the product's engineering behavior.

## Harness evaluation suite

Add a task-quality layer separate from the current protocol snapshots.

Suggested location:

```text
examples/harness-evals/
  tasks/
    fix-local-bug/
    add-tested-feature/
    diagnose-without-editing/
    ui-runtime-verification/
    cross-package-refactor/
    context-resume/
    permission-boundary/
  harness-evals.ts
```

Each case should own:

- A clean workspace fixture and setup script.
- A user request.
- Allowed capabilities and resource budget.
- Deterministic graders over resulting files, commands, application behavior, and session events.
- Untouched-file assertions.
- Optional qualitative rubric for the final explanation.
- With-harness and without-harness arms using the same model and reasoning level.

Track at least:

- Task success and regression count.
- Correct validation lane selected.
- Required runtime evidence produced.
- Unnecessary edits and scope expansion.
- Repeated or failed tool calls.
- User interventions and approval prompts.
- Input/output tokens, cache reuse, latency, child-agent count, and cost.
- Correct continuation after compaction or resume.

Use the current replay/snapshot infrastructure to validate deterministic product plumbing. Use live model runs for task-quality measurement and store normalized result summaries rather than treating one provider transcript as the universal expected answer.

## Implementation sequence

### Phase 0 — Baseline evaluation cases

- Add 6–10 representative coding tasks and deterministic world-state graders.
- Record current standard-preset results across the main supported model routes.
- Establish token, latency, tool-loop, and intervention metrics.

Acceptance: a prompt or harness change can be compared against a stable baseline without manually reading every transcript.

### Phase 1 — Harness Pack vertical slice

- Implement pack registry, filesystem provider, manifest validation, trust, and content digest.
- Ship one read-only `coding` pack.
- Select it from the standard agent preset and record the selection in the session.
- Bridge pack skills into the existing skill registry.
- Add `/harness status` and loader/snapshot coverage.

Acceptance: a repository with no `AGENTS.md`, `CLAUDE.md`, `.agents`, or `.dsh` folder still exposes the same app-owned investigation, implementation, verification, and review resources to every supported model route.

### Phase 2 — Validation capability

- Add validation service, Node/TypeScript project provider, structured plan/result events, and `validate` tool.
- Implement static, focused-test, build-entry, and runtime-evidence check kinds.
- Integrate output spilling, timeouts, sandbox, approvals, and cancellation.

Acceptance: after a TypeScript change, the agent can preview and run an evidence-backed validation plan derived from the actual project and diff, with no invented command and no false success claim.

### Phase 3 — Named workflows

- Add workflow definition registry and pack bridge.
- Ship `investigate`, `change`, `verify`, and `review` workflows.
- Require schema-validated worker results and enforce resource caps.

Acceptance: the same reviewed workflow runs unchanged across model providers, produces durable lifecycle/evidence records, and cannot silently exceed configured agent or time limits.

### Phase 4 — Prompt redesign

- Replace the current minimal persona plus scattered compatibility text with the lean stable-core contract.
- Keep tool and mode policies in their owning plugins.
- Measure each prompt section with the Phase 0 evals and remove sections that do not improve outcomes.

Acceptance: task quality improves without a material regression in tokens, latency, permission friction, or cache reuse.

### Phase 5 — Durable workflow execution

- Add workflow journaling, background collection, resume from an unchanged call prefix, and aggregate token/time budgets.
- Add worktree isolation only for workflows that genuinely mutate in parallel.

Acceptance: interrupted long workflows resume without repeating completed child work, and the parent can inspect exactly which results were reused.

## What not to build

- Do not copy hundreds of extracted Claude fragments into the default prompt.
- Do not use one giant Codex-style prompt as the product architecture.
- Do not create `AGENTS.md`, `CLAUDE.md`, `.agents`, or similar scaffolding in every opened repository.
- Do not make arbitrary Markdown files executable without a manifest, trust level, schema validation, sandbox policy, and version digest.
- Do not treat unit tests, runtime verification, and model self-report as interchangeable evidence.
- Do not let workflow workers declare completion without structured output and, for high-value workflows, an independent verification stage.
- Do not expose every tool and skill on every request. Visibility should follow the active preset, harness pack, mode, and task.
- Do not assume a worker thread or `node:vm` is a security sandbox for model-written workflow code.
- Do not add persistent memory that silently promotes old model conclusions to instructions. Durable state needs provenance, typed events, and explicit retrieval rules.

## Recommended first implementation PR

Start with Phase 0 plus the smallest Phase 1 vertical slice:

1. Define the Harness Pack manifest and registry contracts.
2. Add installed and `$DSH_HOME` filesystem roots with trust and digest handling.
3. Ship a `coding` pack containing four concise skills: investigate, implement, verify, and review.
4. Select and log the pack from the standard preset.
5. Add `/harness status` showing id, version, digest, trust, and registered resources.
6. Prove it through unit tests, HMR disposal, a real Loader composition, a pinned system-prompt/skill-catalog snapshot, and one live cross-model evaluation case.

This establishes the durable resource boundary first. Validation and named workflows can then attach to a stable pack format without redesigning how resources are discovered, trusted, selected, or reproduced.
