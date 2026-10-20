# Codex and Claude Code routing audit

Date: 2026-10-20. Scope: desktop client configuration, Go Copilot executor, delegated protocol executors, streaming, token accounting, credentials, transport reuse, retries, and sanitized local runtime evidence.

## Root causes and fixes (follow-up)

- **Codex compaction.** Codex puts every ChatGPT app connector into the `exec` tool description. The description is 704 KB on every request: Higgsfield 323 KB, Spaces 128 KB, GitHub 69 KB, Sites 65 KB, Drive 63 KB. A single request is 786 KB with apps enabled and 87 KB with `--disable apps`. The measurement is in `test-results/codex-capture-server.cjs` and `codex-exec-breakdown.cjs`. Fix: the harness now writes `features.apps = false` and records `appsManaged`. Undo removes the setting only if the harness added it.
- **Fast 503s after timeouts.** The upstream returns 408 on multi-MB Claude bodies. That put the only Copilot credential into the default 60 s transient cooldown, so the requests that followed failed immediately with 503. Fix: `prepareConfig` defaults `transient-error-cooldown-seconds` to `-1` (legacy and `routing.cooldown` in v8). An explicit value is kept. 429 and quota cooldowns are unchanged. `request-retry` defaults to 0, so there are no retry storms.
- **Debug logging** is turned off in the live desktop config.

## Findings

### 1. Frequent Codex compaction is confirmed; the context rapidly fills again

Priority: high. Evidence: client transcript metadata, not an inferred consequence of slow requests.

One sampled Codex session using `cliproxy_copilot` and `gpt-6.1-sol` contains 11 compaction records between 05:35:59 and 06:14:11 UTC. Compactions often occur only 2-4 assistant messages apart. This is consistent with the supplied screenshot, but the screenshot was not conclusively matched to that session.

The configured model catalog advertises 272,000 context tokens. The client reports an effective window of 258,400. Before the last compaction, one request reported 243,355 input tokens, including 241,849 cached tokens. After compaction the client recorded a local estimate of 15,102 total tokens, but the next request reported 214,028 input tokens. Later requests reached 238,316 input tokens.

Cache hits do not free context space. These measurements establish repeated compaction and near-limit input, not the exact source of the large post-compaction input. The discrepancy between local and upstream token counts needs a request-correlated explanation. It could involve retained instructions/history, provider accounting, or client estimation. Do not disable compaction or raise the context window without checking actual provider limits.

Source checkpoints: `buildFiles`, `Model.ModelInfo`, `applyCodexClientModelMetadata`, `CopilotExecutor.delegate`, and Responses usage translation. The new native executor regression checks preserve caller input and cache fields across requests; they do not reproduce a full Codex compaction cycle.

### 2. Very large conversation histories and actual request failures are present

Priority: high. Evidence: current installed-app logs and saved failing requests.

Two saved Claude request bodies measure 3,388,665 and 5,444,337 bytes. They contain 246 and 265 messages. The message arrays account for 3,325,433 and 5,381,105 bytes; system text is about 15 KB and tools about 48 KB. Conversation history dominates these samples, not tool schemas or system text.

The first large request returned HTTP 408 with `timeout_error`. A subsequent request of the same size returned HTTP 503 with an unavailable/cooldown-related response. Other saved requests returned HTTP 500. HTTP 499 cancellations also occur in the current log. These events are concrete latency/retry pressure, but do not establish whether the original timeout happened in the internet connection, upstream service, or another execution layer.

The active installation has one enabled Copilot credential. A credential/model cooldown can therefore leave no alternative account. The Copilot executor itself only refreshes and retries once on HTTP 401, before stream output is exposed. There is no evidence here of an unbounded token-refresh loop.

Recommended next change: correlate upstream attempt timing, first-token timing, status, request size, and context usage by request/session before changing retry budgets. Investigate the large retained history in the affected session and reduce oversized tool results or repeated transcript content where confirmed. Do not silently drop history inside the proxy.

### 3. Native Responses compaction is unsupported on the Copilot route

Priority: medium. Confirmed compatibility limit, not a demonstrated cause of these compactions.

`CopilotExecutor.Execute` and `ExecuteStream` explicitly return HTTP 501 for `responses/compact`. `OpenAIResponsesAPIHandler.Compact` propagates that error; it does not implement a server-side summary fallback. A new regression check proves rejection happens before credential acquisition.

No HTTP POST to `/v1/responses/compact` was found in the sampled active log. The observed Codex session therefore cannot be attributed to repeated failures of this endpoint from the available evidence. Client-side summary generation is a separate path.

Recommended next change: make this limitation explicit in client setup and verify compaction behavior against the installed Codex version. Do not fabricate an encrypted compaction response or forward to an unsupported upstream endpoint.

### 4. Claude token counting is approximate, not Anthropic-authoritative

Priority: medium. Confirmed implementation limitation; causation unproven.

`CopilotExecutor.CountTokens` delegates to `OpenAICompatExecutor.CountTokens`. That converts input to OpenAI chat form and uses a local tokenizer. Claude names use the O200k fallback. The count is not an Anthropic tokenizer result, and multimodal content and tool overhead are approximated.

Native Claude stream usage still comes from upstream. Only one `/v1/messages/count_tokens` call appears in today's sampled log, so this endpoint does not explain all observed compactions or slow requests.

Recommended next change: document estimated counts, add representative long-context/multimodal count tests, and use an authoritative compatible count endpoint only if Copilot actually supports it. Do not label an arbitrary estimate as exact.

### 5. Saved telemetry cannot fully attribute latency or cache misses

Priority: medium.

The SDK usage record contains `Latency`, `TTFT`, execution request IDs, and session IDs, but the desktop's persistent `copilotusage.Event` does not retain those timing/correlation fields. Older saved events also lack token breakdowns or harness identity. Missing cache data is not evidence of a cache miss.

For example, saved modern Claude records contain tens of millions of cache-read tokens. The sampled Codex transcript also shows high cache-read counts. This disproves a universal cache bypass, but not thread-specific misses.

Recommended next change: persist non-secret timing, attempt, session-correlation, request-size, and usage-quality fields. Keep cache read/write/uncached input separate. Preserve unknown values instead of treating them as measured zeroes. Existing uncommitted usage-reporting work was preserved.

### 6. Debug logging increases diagnostic work and retains large histories

Priority: low for proven latency impact; important operational caveat.

The active configuration enables debug and file logging. The current main-log sample contains roughly 32,000 debug lines. Individual saved error logs are about 3.4-10.9 MB because they include full requests and sometimes upstream copies. This creates additional allocation and disk work, but its contribution to live latency was not isolated.

Recommended next change: use bounded metadata-only diagnostics for ongoing measurements and disable debug after collecting the needed evidence. Error logs contain private conversation content even when authentication headers are masked. No logs were deleted and no live logging configuration was changed.

## Checks that passed

- Both clients point to the installed proxy on loopback port 8337. Codex uses the Responses API; Claude Code uses the Messages API. A separate development proxy on port 8317 uses a temporary profile and is not their configured destination.
- Provider endpoint selection uses the selected account's model metadata. Existing tests cover all three upstream protocols, public aliases, canonical Claude model names, and credential isolation.
- New tests exercise the actual Copilot executor and preserve native instructions, tools, message/input arrays, caller cache markers, Claude user identity, and a supplied Responses cache key across two requests. Each request produces one upstream call.
- Existing tests cover tool round trips, terminal-event validation, bounded inference-token refresh, upstream error propagation, and text delivered exactly once. Passing these tests does not prove that a model never repeats itself after compaction.
- Copilot OpenAI and Claude traffic use the standard pooled HTTP transport. The generic per-request Chrome/uTLS path does not apply to the Copilot host in the audited configuration.
- Copilot access-token exchange is cached and singleflight-coalesced. It is not performed over the network for every inference request.
- Usage persistence runs on the asynchronous usage worker. Its file-scan lock is not directly held across inference.
- No active payload overrides or extra configured outbound proxy were found. No explicit context-length error was found by the diagnostic's fixed-pattern scan.

## Timing interpretation

Warm local `/v1/models` requests completed in approximately 2-6 ms in the initial probe. An unauthenticated Copilot-host connectivity probe initially took about 2.54 s, then 182-194 ms. GitHub API probes were also successful. These are low-volume connectivity checks, not bandwidth measurements or inference comparisons.

Today's initial current-log snapshot showed successful Responses requests with a median total duration around 19 s and a 95th percentile around 63 s. These durations include the complete generated stream. They cannot be interpreted as proxy overhead or time to first token.

No paid inference request, replay of user prompts, service restart, deployment, binary replacement, or live client/configuration mutation was performed. A definitive internet-versus-upstream-versus-proxy latency split remains unverified without a request-correlated trace or controlled inference comparison.

## Reproduction and artifacts

Run from the desktop directory:

```powershell
node test-results/routing-audit.cjs --network > test-results/routing-audit.json
node --test test/harness-config.test.cjs
```

The diagnostic is read-only. `--network` makes authenticated local discovery calls and unauthenticated HTTPS connectivity checks, never generation calls. Its output excludes prompts, credential values, account identifiers, and raw error messages. It samples at most eight recent main client transcript files; it is not an exhaustive inventory of every session or subagent.

- [test-results/routing-audit.json](test-results/routing-audit.json)
- [test-results/routing-audit.cjs](test-results/routing-audit.cjs)
- [test-results/copilot-audit-tests.json](test-results/copilot-audit-tests.json)
- [test-results/copilot-audit-full-tests.json](test-results/copilot-audit-full-tests.json)
- [test-results/routing-audit-build.json](test-results/routing-audit-build.json)

The 13 desktop configuration tests passed. The complete `TestCopilot` executor group passed after a Windows temporary-executable lock was avoided with a distinct test output path. The server compile check passed with exit code 0, using `-o NUL` so no running binary was replaced. Production routing code was not changed; the durable code addition is two executor regression tests. The entire repository suite and a direct-versus-proxy inference benchmark were not run.