const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { attributeHarnesses } = require('../harness-history.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliproxy-harness-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n');
}

test('saved requests are matched to Claude Code and Codex session logs', (t) => {
  const root = fixture(t);
  const claude = path.join(root, 'claude');
  const codex = path.join(root, 'codex');
  const usage = path.join(root, 'copilot-usage.jsonl');
  const tagged = { at: '2026-10-12T09:00:00Z', provider: 'github-copilot', harness: 'opencode', model: 'gpt-6-luna', input_tokens: 5, output_tokens: 1, total_tokens: 6, failed: false };
  write(usage, [
    { at: '2026-10-12T09:00:00Z', model: 'claude-opus-5-5', input_tokens: 2, output_tokens: 300, total_tokens: 50302, failed: false },
    { at: '2026-10-12T09:01:00Z', model: 'gpt-6.1-sol', input_tokens: 9000, output_tokens: 120, total_tokens: 9120, failed: false },
    { at: '2026-10-12T09:02:00Z', model: 'claude-haiku-5-5', input_tokens: 4, output_tokens: 7, total_tokens: 11, failed: false },
    { at: '2026-10-12T09:03:00Z', model: 'claude-opus-5-5', input_tokens: 0, output_tokens: 0, total_tokens: 0, failed: true },
    { at: '2026-10-12T09:10:00Z', model: 'claude-opus-5-5', input_tokens: 416359, output_tokens: 11708, total_tokens: 506362, failed: false },
    tagged,
  ]);
  const message = { model: 'claude-opus-5-5', id: 'msg-1', usage: { input_tokens: 2, cache_read_input_tokens: 40000, cache_creation_input_tokens: 10000, output_tokens: 300 } };
  // Streaming first writes a partial snapshot, and a resumed session repeats the final one.
  const partial = { ...message, usage: { ...message.usage, output_tokens: 8 } };
  write(path.join(claude, 'projects', 'project', 'session.jsonl'), [
    { timestamp: '2026-10-12T09:00:05Z', message: partial },
    { timestamp: '2026-10-12T09:00:12Z', message },
    { timestamp: '2026-10-12T09:00:12Z', message },
    // A compaction call appears only as a boundary marker written when it finishes.
    { timestamp: '2026-10-12T09:11:38.600Z', type: 'system', subtype: 'compact_boundary', uuid: 'compact-1', compactMetadata: { trigger: 'manual', preTokens: 497369, durationMs: 98600 } },
  ]);
  write(path.join(codex, 'sessions', '2026', '10', '12', 'rollout-2026-10-12T09-00-00-thread.jsonl'), [
    { timestamp: '2026-10-12T09:00:50Z', type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
    { timestamp: '2026-10-12T09:01:20Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 9000, output_tokens: 120, total_tokens: 9120 } } } },
  ]);

  assert.deepEqual(attributeHarnesses(usage, { claude: [claude], codex: [codex] }), { checked: 5, matched: 3 });
  const events = fs.readFileSync(usage, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.harness), ['claude-code', 'codex', 'unknown', 'unknown', 'claude-code', 'opencode']);
  assert.deepEqual(events[5], tagged, 'Requests that already name a harness are unchanged');
  assert.equal(events[0].total_tokens, 50302, 'Usage values are kept');
  assert.ok(fs.existsSync(`${usage}.before-harness.bak`), 'The original history is backed up');

  const before = fs.readFileSync(usage, 'utf8');
  assert.deepEqual(attributeHarnesses(usage, { claude: [claude], codex: [codex] }), { checked: 0, matched: 0 }, 'Later starts have nothing to match');
  assert.equal(fs.readFileSync(usage, 'utf8'), before);
});

test('a missing history or harness log folder is not an error', (t) => {
  const root = fixture(t);
  assert.deepEqual(attributeHarnesses(path.join(root, 'missing.jsonl'), { claude: [root], codex: [root] }), { checked: 0, matched: 0 });
  const usage = path.join(root, 'copilot-usage.jsonl');
  write(usage, [{ at: '2026-10-12T09:00:00Z', model: 'gpt-6-luna', input_tokens: 5, output_tokens: 1, total_tokens: 6, failed: false }]);
  assert.deepEqual(attributeHarnesses(usage, { claude: [path.join(root, 'none')], codex: [path.join(root, 'none')] }), { checked: 1, matched: 0 });
});
