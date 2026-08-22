<!--
name: "Data: Self-hosted runner command help"
description: "Documents self-hosted runner connection, runtime, lifecycle, watchdog, security, health, and debug command-line options"
ccVersion: "2.1.235"
variables:
  - "DEFAULT_SELF_HOSTED_RUNNER_API_URL"
  - "DEFAULT_RUNNER_CAPACITY"
  - "DEFAULT_RUNNER_BASE_DIR"
  - "SESSION_STOP_GRACE_MS"
  - "POST_SESSION_HOOK_TIMEOUT_MS"
  - "BACKGROUND_RESULT_GRACE_MS"
  - "DEFAULT_TRUST_WORKSPACE"
  - "DEFAULT_HEALTH_PORT"
  - "MAX_TIMEOUT_MINUTES"
  - "MAX_DRAIN_GRACE_SECONDS"
-->
Usage: claude self-hosted-runner [options]

Connection:
  --api-url <url>             API base URL (default: ${DEFAULT_SELF_HOSTED_RUNNER_API_URL})
  --environment-secret-file <path>
                              Path to environment secret file (or set SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET)
                              (--pool-secret-file / SELF_HOSTED_RUNNER_POOL_SECRET are deprecated aliases.)
  --lock-to-account <id>      Lock runner to a single account at registration (webhook-driven on-demand
                              spawn). Only that account's sessions are assigned.
                              [env: SELF_HOSTED_RUNNER_LOCK_TO_ACCOUNT]

Runtime:
  --capacity <n>              Max concurrent sessions (default: ${DEFAULT_RUNNER_CAPACITY})
  --base-dir <path>           Base directory for repo checkouts (default: ${DEFAULT_RUNNER_BASE_DIR};
                              required on Windows, which has no default)
                              [env: SELF_HOSTED_RUNNER_BASE_DIR]
  --exec-path <path>          Binary to spawn for child sessions. Default: this process's own binary.
                              [env: SELF_HOSTED_RUNNER_EXEC_PATH]
  --hooks-dir <path>          Directory of lifecycle hook scripts (checkout, command, post-session).
                              Absent hooks fall through to built-in behavior.
                              [env: SELF_HOSTED_RUNNER_HOOKS_DIR]
  --session-stop-grace-sec <n>
                              How long to wait for the Claude process to exit cleanly after a
                              session ends, before force-killing it. The post-session hook runs
                              after this. Default: ${SESSION_STOP_GRACE_MS/1000}.
                              [env: SELF_HOSTED_RUNNER_SESSION_STOP_GRACE_MS, in ms]
  --post-session-hook-timeout-sec <n>
                              SIGTERM budget for the post-session lifecycle hook, on every session
                              end including runner shutdown. Default: ${POST_SESSION_HOOK_TIMEOUT_MS/1000}.
                              [env: SELF_HOSTED_RUNNER_POST_SESSION_HOOK_TIMEOUT_MS, in ms]
  --drain-wait-sec <n>        On SIGTERM/SIGINT, wait up to N seconds for each session's in-flight
                              turn (a foreground tool call) and running background tasks to finish
                              before sending the session process its SIGTERM. Adds N to the
                              advertised shutdown budget.
                              A background task that has JUST finished also counts as
                              in-flight until the follow-up turn that reads its result starts
                              (bounded by SELF_HOSTED_RUNNER_BG_RESULT_GRACE_MS, in ms;
                              default: ${BACKGROUND_RESULT_GRACE_MS/1000}s; 0 or an unusable value falls back
                              to the default — the hold cannot be disabled).
                              Default: 0 (send SIGTERM immediately). Max: 86400.
                              [env: SELF_HOSTED_RUNNER_DRAIN_WAIT_MS, in ms]
                              (--drain-wait-bg-tasks-sec is a deprecated alias for this flag.)
  --git-ssh-rewrite <host>    Rewrite https://<host>/... source URLs to git@<host>:... (repeatable).
                              For SSH-only git hosts.
  --git-host-rewrite <f>=<t>  Rewrite https://<f>/... source URLs to https://<t>/... (repeatable).
                              For split-horizon DNS where the runner reaches GHE via a different
                              hostname than the control plane. Applied before --git-ssh-rewrite.
  --use-anthropic-git-proxy   Clone via Anthropic's git proxy (uses the session creator's stored
                              GitHub OAuth token, or the org's GitHub App installation token for
                              bot/agent sessions; you don't manage git auth on the runner). Supersedes
                              --git-host-rewrite and --git-ssh-rewrite.
                              [env: CLAUDE_RUNNER_USE_GIT_PROXY=1]
  --configure-git             Set global git identity to Claude <noreply@anthropic.com> and enable
                              commit signing via Anthropic's signing service, matching 1P sessions.
                              Writes ~/.gitconfig at runner startup. Without this flag, your image
                              must provide its own git identity.
                              [env: SELF_HOSTED_RUNNER_CONFIGURE_GIT=1]
  --push-outcome-on-release   On a runner-initiated non-completed session end (SIGTERM drain,
                              idle-release, failed), push every tracked outcome branch to origin
                              before deleting it, so in-flight commits survive a runner restart.
                              Skipped on server-initiated deassign. On a resumed session (worker
                              epoch > 1), the prep path fetches any previously pushed outcome
                              branch from origin and continues from it, so histories stay
                              linear. CAVEAT: the resume-fetch trusts refs/heads/<outcome-branch>
                              on the source remote — anyone with push access to that ref can
                              place content into the resumed workspace; if your source revision
                              is protected but claude/* refs are not, that collaborator write
                              surface widens on resume. Repos checked out via the checkout
                              lifecycle hook are NOT pushed — use the post-session hook to
                              snapshot those. Adds 30s
                              (total, shared across all pushes) to the advertised
                              shutdown budget.
                              [env: SELF_HOSTED_RUNNER_PUSH_OUTCOME_ON_RELEASE=1]
  --trust-workspace [bool]    Seed persisted trust for each session's repo paths so repo-level
                              .claude/settings.json permissions.allow and additionalDirectories
                              are honored by the child. Default: ${DEFAULT_TRUST_WORKSPACE}.
                              Set to false for cli#44151's stricter gate: repo-committed grants
                              are dropped with an "Ignoring N permissions.allow" stderr
                              diagnostic; configure host-level grants via the host-config dir's
                              settings.json permissions.allow (userSettings source) instead.
                              [env: SELF_HOSTED_RUNNER_TRUST_WORKSPACE=0 to disable]
  --confine-repo-settings <mode>
                              Repo-committed-settings confine guard mode: warn (default) logs
                              a would-refuse diagnostic per violation and still spawns;
                              enforce refuses to spawn the session; off disables the scan.
                              Invalid values fail closed at startup.
                              [env: SELF_HOSTED_RUNNER_CONFINE_REPO_SETTINGS]
  [env: SELF_HOSTED_RUNNER_HOST_CONFIG_DIR]
                              Directory seeded into each session's CLAUDE_CONFIG_DIR (settings,
                              agents/, skills/, …; runtime state excluded). Default: ~/.claude.
                              Point at an empty dir to disable.
  --health-port <port>        Port for /healthz HTTP listener (default: ${DEFAULT_HEALTH_PORT}). 0 disables.
                              [env: SELF_HOSTED_RUNNER_HEALTH_PORT]
  --log-level <level>         Log level: info or debug (default: info)
  --log-file <path>           Tee runner logs to a file in append mode. Stdout is unchanged.
                              [env: SELF_HOSTED_RUNNER_LOG_FILE]

Runner lifecycle:
  --exit-if-unused-min <n>    Exit the runner if never assigned work for N min (autoscaler scale-down).
                              Default: never. Max: ${MAX_TIMEOUT_MINUTES}.
                              [env: SELF_HOSTED_RUNNER_IDLE_SHUTDOWN_MS, in ms]
  --drain-grace-sec <n>       Default: 0 — exit immediately after active sessions finish, WITHOUT
                              polling for more (one-shot when --capacity=1).
                              Set a positive value (e.g. 30) to keep the runner warm and re-poll the
                              locked account's queue for that many seconds before exiting.
                              Max: ${MAX_DRAIN_GRACE_SECONDS}. [env: SELF_HOSTED_RUNNER_DRAIN_GRACE_MS, in ms]
  --retire-at <epoch-seconds> Retire the runner at the given wall-clock time (absolute Unix timestamp, in
                              seconds): release every active session through the ReleaseSession path that
                              --release-idle-session-min uses (the session parks server-side and a fresh
                              runner picks it up on the user's next message), stop taking new work, and
                              exit 0 once the slots are empty. A session still mid-turn at that time is
                              released as soon as its turn ends; background work a finished turn left
                              running gets up to 60s of grace, then the session parks anyway (perpetual
                              monitor tasks don't hold it at all). Use this when the host hard-kills the
                              runner at a known time (e.g. a sandbox lifetime cap): set it far enough
                              before the kill to cover typical turns PLUS the per-session shutdown
                              budget (--session-stop-grace-sec, the push-outcome window, the full
                              --post-session-hook-timeout-sec, the 60s background-work grace, one poll)
                              so sessions park cleanly and the post-session hook isn't truncated by
                              the kill. Default: never. [env: SELF_HOSTED_RUNNER_RETIRE_AT, in seconds]

Per-session watchdogs:
  --release-idle-session-min <n>  Release a session slot after N min of no user input (turn finished,
                                  or parked at a permission prompt, user idle). Runner exits if this
                                  drops it to zero active sessions.
                                  Default: never. Max: ${MAX_TIMEOUT_MINUTES}.
                                  [env: SELF_HOSTED_RUNNER_SESSION_IDLE_MS, in ms]
  --startup-timeout-min <n>       Release a session slot if the child has not completed initialization
                                  N min after spawn — covers a child hung during --resume hydration or
                                  MCP connect, and a session assigned with no pending input. Cleared
                                  once the child emits system:init, after which --release-idle-session-min
                                  takes over. Default: 15. 0 disables. Max: ${MAX_TIMEOUT_MINUTES}.
                                  [env: SELF_HOSTED_RUNNER_STARTUP_TIMEOUT_MS, in ms]
  --kill-session-after-min <n>    SIGTERM a session child after N min wall-clock (runaway backstop).
                                  If a turn is in flight at the deadline, the kill is deferred until
                                  the turn finishes, with a hard cap of 15 min past the deadline
                                  (override: SELF_HOSTED_RUNNER_MAX_LIFETIME_GRACE_MS, in ms).
                                  Default: never. Max: ${MAX_TIMEOUT_MINUTES}.
                                  [env: SELF_HOSTED_RUNNER_MAX_LIFETIME_MS, in ms]

Debug:
  --debug-token-dir <path>    DEBUG ONLY — writes live tokens to disk. Do not use in production.
                              [env: SELF_HOSTED_RUNNER_DEBUG_TOKEN_DIR]

  --help, -h                  Show this help message
