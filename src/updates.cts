const REPOSITORY = 'NaveDanan/CPA-Desktop';
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function parseVersion(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  return match ? { parts: match.slice(1, 4).map(BigInt), prerelease: Boolean(match[4]) } : null;
}

function newerRelease(release: Release, currentVersion: string) {
  const current = parseVersion(currentVersion);
  const next = parseVersion(release?.tag_name);
  if (!current || !next || next.prerelease || release.draft || release.prerelease) return null;
  let newer = current.prerelease;
  for (let i = 0; i < 3; i++) {
    if (next.parts[i] === current.parts[i]) continue;
    newer = next.parts[i] > current.parts[i];
    break;
  }
  if (!newer) return null;
  return {
    version: release.tag_name.replace(/^v/, ''),
    // Construct the destination ourselves; never open a URL supplied by release notes.
    url: `${RELEASES_URL}/tag/${encodeURIComponent(release.tag_name)}`,
    notes: typeof release.body === 'string' && release.body.trim()
      ? release.body.trim().slice(0, 16000) : 'No release notes were provided.',
  };
}

interface Release { tag_name: string; draft?: boolean; prerelease?: boolean; body?: string }
export interface UpdateState { currentVersion: string; status: 'idle' | 'checking' | 'current' | 'available' | 'error'; release: ReturnType<typeof newerRelease> | null; error: string | null }
interface UpdateOptions { currentVersion: string; fetchRelease?: typeof fetch; onChange?: (state: UpdateState) => void; now?: () => number }
function createUpdateChecker({ currentVersion, fetchRelease = fetch, onChange = () => {}, now = Date.now }: UpdateOptions) {
  let state: UpdateState = { currentVersion, status: 'idle', release: null, error: null };
  let pending: Promise<UpdateState> | null;
  let lastAttempt = -Infinity;
  let stopped = false;
  const controller = new AbortController();
  const publish = (changes: Partial<UpdateState>) => {
    state = { ...state, ...changes };
    if (!stopped) onChange({ ...state });
    return { ...state };
  };
  const check = () => {
    if (pending) return pending;
    if (stopped || now() - lastAttempt < 60000) return Promise.resolve({ ...state });
    lastAttempt = now();
    publish({ status: 'checking', error: null });
    pending = (async () => {
      try {
        if (!parseVersion(currentVersion)) throw new Error('The installed version is invalid.');
        let release: UpdateState['release'] = null;
        let hasEntries = false;
        let hasVersion = false;
        // GitHub's manually selected "Latest" release can lag behind a newer stable version.
        // Inspect every page and compare versions instead of relying on that designation or ordering.
        for (let page = 1; ; page++) {
          const response = await fetchRelease(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CPA-Desktop', 'Cache-Control': 'no-cache' },
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
          const data = await response.json();
          if (!Array.isArray(data)) throw new Error('GitHub returned an invalid release list.');
          hasEntries ||= data.length > 0;
          for (const item of data) {
            if (!parseVersion(item?.tag_name)) continue;
            hasVersion = true;
            const candidate = newerRelease(item, release?.version || currentVersion);
            if (candidate) release = candidate;
          }
          if (data.length < 100) break;
        }
        if (hasEntries && !hasVersion) throw new Error('Published releases have unsupported version tags.');
        return publish({ status: release ? 'available' : 'current', release });
      } catch {
        return publish({ status: 'error', error: 'Unable to check GitHub. Try again later.' });
      }
    })().finally(() => { pending = null; });
    return pending;
  };
  return {
    check,
    getState: () => ({ ...state }),
    stop: () => { stopped = true; controller.abort(); },
  };
}

export { createUpdateChecker, newerRelease, RELEASES_URL, CHECK_INTERVAL };
