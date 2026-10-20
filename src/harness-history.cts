import fs = require('node:fs');
import path = require('node:path');
import os = require('node:os');

// Usage saved before the proxy recorded harnesses is matched to the harnesses'
// own session logs. A request and its log entry share the model, output tokens,
// and total tokens, and the entry is written shortly after the request starts.
const MATCH_BEFORE_MS = 2 * 60_000;
const MATCH_AFTER_MS = 30 * 60_000;
const COMPACTION_START_MS = 5_000;

interface LogEntry { harness: string; at: number; key: string; used?: boolean }
interface Compaction { at: number; prompt: number; used?: boolean }
interface HarnessHomes { claude: string[]; codex: string[] }

const normalizeModel = (model: unknown) => String(model || '').toLowerCase().replace(/[._ ]/g, '-').replace(/-\d{8}$/, '');
const entryKey = (model: unknown, output: number, total: number) => `${normalizeModel(model)}|${output}|${total}`;

function defaultHarnessHomes(): HarnessHomes {
  return {
    claude: [process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')],
    codex: [process.env.CODEX_HOME || path.join(os.homedir(), '.codex')],
  };
}

function logFiles(dir: string, pattern: RegExp, since: number) {
  const files: string[] = [];
  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (pattern.test(entry.name)) {
        try { if (fs.statSync(file).mtimeMs >= since) files.push(file); } catch { /* The log was removed while scanning. */ }
      }
    }
  };
  walk(dir);
  return files;
}

function readLines(file: string) {
  try { return fs.readFileSync(file, 'utf8').split('\n'); } catch { return []; }
}

function claudeEntries(home: string, since: number, entries: LogEntry[], compactions: Compaction[]) {
  // Streaming writes a message several times before its final usage, and resumed
  // sessions copy earlier messages, so each message and usage pair counts once.
  const seen = new Set<string>();
  for (const file of logFiles(path.join(home, 'projects'), /\.jsonl$/, since)) {
    for (const line of readLines(file)) {
      const compactLine = line.includes('"compact_boundary"');
      if (!compactLine && !line.includes('"usage"')) continue;
      let record: any;
      try { record = JSON.parse(line); } catch { continue; }
      const compact = compactLine && record.subtype === 'compact_boundary' ? record.compactMetadata : null;
      if (compact?.preTokens > 0 && compact.durationMs >= 0 && !seen.has(record.uuid)) {
        // Compaction calls are not logged as messages; the marker records when the call
        // finished, how long it took, and the size of the compacted prompt.
        seen.add(record.uuid);
        compactions.push({ at: Date.parse(record.timestamp) - compact.durationMs, prompt: compact.preTokens });
        continue;
      }
      const message = record.message;
      const usage = message?.usage;
      if (!usage || !message.model) continue;
      const output = usage.output_tokens || 0;
      const total = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + output;
      const id = `${message.id}|${output}|${total}`;
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push({ harness: 'claude-code', at: Date.parse(record.timestamp), key: entryKey(message.model, output, total) });
    }
  }
}

function codexEntries(home: string, since: number, entries: LogEntry[]) {
  for (const folder of ['sessions', 'archived_sessions']) {
    for (const file of logFiles(path.join(home, folder), /^rollout-.*\.jsonl$/, since)) {
      let model = '';
      for (const line of readLines(file)) {
        if (!line.includes('turn_context') && !line.includes('token_count')) continue;
        let record: any;
        try { record = JSON.parse(line); } catch { continue; }
        if (record.type === 'turn_context' && record.payload?.model) model = record.payload.model;
        const usage = record.payload?.type === 'token_count' ? record.payload.info?.last_token_usage : null;
        if (usage) entries.push({ harness: 'codex', at: Date.parse(record.timestamp), key: entryKey(model, usage.output_tokens || 0, usage.total_tokens || 0) });
      }
    }
  }
}

// Adds a harness to saved requests that have none. Unmatched requests are marked
// unknown so later starts skip them. Run only while the proxy is stopped, because
// the history file is replaced.
function attributeHarnesses(usageFile: string, homes: HarnessHomes = defaultHarnessHomes()) {
  let text: string;
  try { text = fs.readFileSync(usageFile, 'utf8'); } catch { return { checked: 0, matched: 0 }; }
  const lines = text.split('\n');
  const pending: { index: number; event: any; at: number }[] = [];
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (!('harness' in event)) pending.push({ index, event, at: Date.parse(event.at) });
    } catch { /* Unreadable lines stay as they are. */ }
  });
  if (!pending.length) return { checked: 0, matched: 0 };

  const since = pending.reduce((earliest, item) => Math.min(earliest, item.at), Infinity) - 86_400_000;
  const entries: LogEntry[] = [];
  const compactions: Compaction[] = [];
  for (const home of homes.claude) claudeEntries(home, since, entries, compactions);
  for (const home of homes.codex) codexEntries(home, since, entries);
  const byKey = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, []);
    byKey.get(entry.key).push(entry);
  }
  let matched = 0;
  for (const item of pending) {
    let harness = 'unknown';
    if (item.event.total_tokens > 0) {
      let best: LogEntry | undefined;
      for (const entry of byKey.get(entryKey(item.event.model, item.event.output_tokens, item.event.total_tokens)) || []) {
        const gap = entry.at - item.at;
        if (entry.used || gap < -MATCH_BEFORE_MS || gap > MATCH_AFTER_MS) continue;
        if (!best || Math.abs(gap) < Math.abs(best.at - item.at)) best = entry;
      }
      const prompt = item.event.total_tokens - item.event.output_tokens;
      const compaction = best ? undefined : compactions.find((candidate) => !candidate.used &&
        Math.abs(candidate.at - item.at) <= COMPACTION_START_MS && Math.abs(prompt - candidate.prompt) <= candidate.prompt * 0.05);
      if (best) {
        best.used = true;
        harness = best.harness;
        matched++;
      } else if (compaction) {
        compaction.used = true;
        harness = 'claude-code';
        matched++;
      }
    }
    lines[item.index] = JSON.stringify({ ...item.event, harness });
  }
  const backup = `${usageFile}.before-harness.bak`;
  if (!fs.existsSync(backup)) fs.copyFileSync(usageFile, backup);
  const temporary = `${usageFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, lines.join('\n'), { mode: 0o600 });
  fs.renameSync(temporary, usageFile);
  return { checked: pending.length, matched };
}

export { attributeHarnesses, defaultHarnessHomes };
