const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newerRelease, createUpdateChecker } = require('../updates.cjs');

const release = (tag_name = 'v1.2.0', extra = {}) => ({ tag_name, body: '## Changes\n- Tray support', ...extra });
const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });

test('finds v1.2.3 when GitHub still marks installed v1.2.2 as latest', async () => {
  const checker = createUpdateChecker({ currentVersion: '1.2.2',
    fetchRelease: async (url) => response(url.endsWith('/latest')
      ? release('v1.2.2') : [release('v1.2.3'), release('v1.2.2')]),
  });
  const state = await checker.check();
  assert.equal(state.status, 'available');
  assert.equal(state.release.version, '1.2.3');
});

test('only newer stable releases are offered with a repository-owned URL', () => {
  for (const tag of ['v1.1.0', 'v1.0.99', 'v0.99.99', 'v1.3.0-beta.1', 'garbage']) {
    assert.equal(newerRelease(release(tag), '1.1.0'), null, tag);
  }
  assert.equal(newerRelease(release('v1.2.0', { draft: true }), '1.1.0'), null);
  assert.equal(newerRelease(release('v1.2.0', { prerelease: true }), '1.1.0'), null);
  assert.equal(newerRelease(release(), 'invalid'), null);
  assert.equal(newerRelease(release('v1.10.0'), '1.9.0').version, '1.10.0');
  assert.equal(newerRelease(release('v1.1.0'), '1.1.0-beta.1').version, '1.1.0');
  assert.equal(newerRelease(release('v1.1.0+build'), '1.1.0'), null);
  const next = newerRelease(release('v1.2.0', { html_url: 'https://untrusted.example/', body: '<script>alert(1)</script>' }), '1.1.0');
  assert.equal(next.url, 'https://github.com/NaveDanan/CPA-Desktop/releases/tag/v1.2.0');
  assert.equal(next.notes, '<script>alert(1)</script>');
  assert.equal(newerRelease(release('v1.2.0', { body: null }), '1.1.0').notes, 'No release notes were provided.');
});

test('checks coalesce, throttle, and preserve an available release through failures', async () => {
  let now = 0;
  let calls = 0;
  let resolveFetch;
  const states = [];
  const checker = createUpdateChecker({ currentVersion: '1.1.0', now: () => now, onChange: (state) => states.push(state),
    fetchRelease: (url, options) => {
      calls++;
      assert.equal(url, 'https://api.github.com/repos/NaveDanan/CPA-Desktop/releases?per_page=100&page=1');
      assert.equal(options.headers.Authorization, undefined);
      return new Promise((resolve) => { resolveFetch = resolve; });
    },
  });
  const first = checker.check();
  assert.equal(checker.check(), first);
  resolveFetch(response([release()]));
  assert.equal((await first).status, 'available');
  await checker.check();
  assert.equal(calls, 1);
  now += 60000;
  const second = checker.check();
  resolveFetch(response(null, 403));
  const failed = await second;
  assert.equal(failed.status, 'error');
  assert.equal(failed.release.version, '1.2.0');
  assert.deepEqual(states.map((state) => state.status), ['checking', 'available', 'checking', 'error']);
});

test('no releases, current versions, malformed responses and offline errors settle safely', async () => {
  for (const [fetchRelease, expected] of [
    [async () => response(null, 404), 'error'],
    [async () => response([]), 'current'],
    [async () => response([release('v1.1.0')]), 'current'],
    [async () => response([release('invalid-tag')]), 'error'],
    [async () => response({}), 'error'],
    [async () => { throw new Error('offline'); }, 'error'],
  ]) {
    const checker = createUpdateChecker({ currentVersion: '1.1.0', fetchRelease });
    const state = await checker.check();
    assert.equal(state.status, expected);
    assert.equal(state.release, null);
  }
});

test('stopping aborts an active check and prevents further notifications or checks', async () => {
  let calls = 0;
  const states = [];
  const checker = createUpdateChecker({ currentVersion: '1.1.0', onChange: (state) => states.push(state),
    fetchRelease: (_url, { signal }) => {
      calls++;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    },
  });
  const pending = checker.check();
  checker.stop();
  await pending;
  await checker.check();
  assert.equal(calls, 1);
  assert.equal(states.length, 1);
});

test('a synchronous network failure can be retried', async () => {
  let now = 0;
  let calls = 0;
  const checker = createUpdateChecker({ currentVersion: '1.1.0', now: () => now,
    fetchRelease: () => { calls++; throw new Error('network unavailable'); } });
  assert.equal((await checker.check()).status, 'error');
  now = 60000;
  await checker.check();
  assert.equal(calls, 2);
});

test('checks every page and chooses the highest stable version regardless of release order', async () => {
  const urls = [];
  const checker = createUpdateChecker({ currentVersion: '1.2.2', fetchRelease: async (url) => {
    urls.push(url);
    return response(url.endsWith('page=1') ? Array.from({ length: 100 }, () => release('v1.2.2')) : [
      release('v1.9.0'), release('v2.0.0', { draft: true }), release('v1.10.0'),
      release('v3.0.0', { prerelease: true }), release('v4.0.0-beta.1'),
      release('not-a-version'), null, release('v1.2.3'),
    ]);
  } });
  const state = await checker.check();
  assert.equal(state.status, 'available');
  assert.equal(state.release.version, '1.10.0');
  assert.equal(urls.length, 2);
  assert.match(urls[1], /per_page=100&page=2$/);
});

test('later page failures cannot incorrectly report up to date', async () => {
  const checker = createUpdateChecker({ currentVersion: '1.2.2', fetchRelease: async (url) =>
    url.endsWith('page=1') ? response(Array.from({ length: 100 }, () => release('v1.2.2'))) : response(null, 500),
  });
  assert.equal((await checker.check()).status, 'error');
});
