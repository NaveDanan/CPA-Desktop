import fs = require('node:fs/promises');
import path = require('node:path');
import { createHash } from 'node:crypto';
import { removeUpdateDirectory, verifyInstaller, type DownloadedUpdate } from './update-installer.cjs';

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
    installer: releaseInstaller(release),
    notes: typeof release.body === 'string' && release.body.trim()
      ? release.body.trim().slice(0, 16000) : 'No release notes were provided.',
  };
}

interface ReleaseAsset { name: string; size: number; digest?: string; state?: string }
interface Release { tag_name: string; draft?: boolean; prerelease?: boolean; body?: string; assets?: ReleaseAsset[] }
function releaseInstaller(release: Release) {
  const version = release.tag_name.replace(/^v/, '');
  const name = 'CLIProxyAPI-Desktop-Setup-' + version + '.exe';
  const asset = Array.isArray(release.assets) ? release.assets.find((item) => item?.name === name && item.state === 'uploaded') : null;
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0 || typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) return null;
  return {
    name, size: asset.size, sha256: asset.digest.slice(7).toLowerCase(),
    url: RELEASES_URL + '/download/' + encodeURIComponent(release.tag_name) + '/' + encodeURIComponent(name),
  };
}

export interface UpdateState {
  currentVersion: string;
  status: 'idle' | 'checking' | 'current' | 'available' | 'error' | 'downloading' | 'downloaded' | 'installing';
  release: ReturnType<typeof newerRelease> | null;
  error: string | null;
  canInstall: boolean;
  progress: { received: number; total: number } | null;
}
interface UpdateOptions {
  currentVersion: string;
  fetchRelease?: typeof fetch;
  fetchInstaller?: typeof fetch;
  onChange?: (state: UpdateState) => void;
  now?: () => number;
  cacheDir?: string;
  installUpdate?: (update: DownloadedUpdate) => Promise<void>;
  installationError?: string | null;
}
class DownloadError extends Error {}
function createUpdateChecker({ currentVersion, fetchRelease = fetch, fetchInstaller = fetch, onChange = () => {}, now = Date.now, cacheDir, installUpdate, installationError = null }: UpdateOptions) {
  let state: UpdateState = { currentVersion, status: 'idle', release: null, error: installationError, canInstall: Boolean(cacheDir && installUpdate), progress: null };
  let pending: Promise<UpdateState> | null;
  let action: Promise<UpdateState> | null;
  let downloadController: AbortController | null = null;
  let downloaded: DownloadedUpdate | null = null;
  let handedOff = false;
  let lastAttempt = -Infinity;
  let stopped = false;
  const controller = new AbortController();
  const publish = (changes: Partial<UpdateState>) => {
    state = { ...state, ...changes };
    if (!stopped) onChange({ ...state });
    return { ...state };
  };
  const check = () => {
    if (action || state.status === 'downloaded' || state.status === 'installing') return Promise.resolve({ ...state });
    if (pending) return pending;
    if (stopped || now() - lastAttempt < 60000) return Promise.resolve({ ...state });
    lastAttempt = now();
    publish({ status: 'checking', error: installationError });
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
        return publish({ status: release ? 'available' : 'current', release, error: installationError });
      } catch {
        return publish({ status: 'error', error: 'Unable to check GitHub. Try again later.' });
      }
    })().finally(() => { pending = null; });
    return pending;
  };
  const download = (): Promise<UpdateState> => {
    if (action) return action;
    if (pending) return pending.then(download);
    if (stopped || state.status === 'downloaded' || state.status === 'installing' || !state.release) return Promise.resolve({ ...state });
    const release = state.release;
    const installer = release.installer;
    if (!state.canInstall || !installer) return Promise.resolve(publish({ error: 'This release does not have an installer available for in-app updating. Use View release on GitHub.' }));
    downloadController = new AbortController();
    const signal = AbortSignal.any([controller.signal, downloadController.signal]);
    installationError = null;
    publish({ status: 'downloading', error: null, progress: { received: 0, total: installer.size } });
    action = (async () => {
      let directory: string | null = null;
      let file: fs.FileHandle | null = null;
      try {
        await fs.mkdir(cacheDir, { recursive: true });
        directory = await fs.mkdtemp(path.join(cacheDir, 'update-'));
        const partial = path.join(directory, 'installer.exe.part');
        file = await fs.open(partial, 'wx', 0o600);
        const response = await fetchInstaller(installer.url, { signal, headers: { 'User-Agent': 'CPA-Desktop' } });
        if (!response.ok || !response.body) throw new DownloadError('Unable to download the update from GitHub. Try again later.');
        const reader = response.body.getReader();
        const hash = createHash('sha256');
        let received = 0;
        let lastProgress = 0;
        try {
          while (true) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > installer.size) throw new DownloadError('The installer size does not match the release. Download it again.');
            hash.update(value);
            await file.writeFile(value);
            if (Date.now() - lastProgress >= 200) {
              publish({ progress: { received, total: installer.size } });
              lastProgress = Date.now();
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        await file.close();
        file = null;
        signal.throwIfAborted();
        if (received !== installer.size || hash.digest('hex') !== installer.sha256) throw new DownloadError('The installer could not be verified. Download it again.');
        const target = path.join(directory, 'installer.exe');
        await fs.rename(partial, target);
        downloaded = { version: release.version, directory, file: target, sha256: installer.sha256, size: installer.size };
        return publish({ status: 'downloaded', progress: { received, total: installer.size } });
      } catch (error) {
        if (file) await file.close().catch(() => {});
        if (directory) await removeUpdateDirectory(cacheDir, directory).catch(() => {});
        return publish({
          status: 'available', progress: null,
          error: signal.aborted ? null : (error instanceof DownloadError ? error.message : 'Unable to download the update. Check your connection and try again.'),
        });
      }
    })().finally(() => { action = null; downloadController = null; });
    return action;
  };
  const install = (): Promise<UpdateState> => {
    if (action) return action;
    if (stopped || handedOff || !downloaded || !installUpdate || state.status !== 'downloaded') return Promise.resolve({ ...state });
    const update = downloaded;
    publish({ status: 'installing', error: null });
    action = (async () => {
      try {
        await verifyInstaller(update);
        await installUpdate(update);
        handedOff = true;
        return { ...state };
      } catch {
        await removeUpdateDirectory(cacheDir, update.directory).catch(() => {});
        downloaded = null;
        return publish({ status: 'available', progress: null, error: 'Unable to start the update. Download it again and retry, or use the GitHub installer.' });
      }
    })().finally(() => { action = null; });
    return action;
  };
  return {
    check, download, install,
    cancelDownload: async () => { downloadController?.abort(); return action ? await action : { ...state }; },
    getState: () => ({ ...state }),
    stop: async () => {
      stopped = true;
      controller.abort();
      await pending;
      await action;
      if (downloaded && !handedOff) {
        await removeUpdateDirectory(cacheDir, downloaded.directory);
        downloaded = null;
      }
    },
  };
}

export { createUpdateChecker, newerRelease, RELEASES_URL, CHECK_INTERVAL };
