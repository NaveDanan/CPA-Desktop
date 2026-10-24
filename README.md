# CLIProxyAPI Desktop

## Linux desktop and connected VMs

The Linux desktop ships as `CLIProxyAPI-Desktop-<version>-linux-x86_64.AppImage` or `linux-arm64.AppImage`. Make it executable with `chmod +x <file>.AppImage`, then run it. On distributions without FUSE 2, install the distribution's FUSE compatibility library or run with `--appimage-extract-and-run`. Desktop VM tokens are encrypted by the OS credential store. Linux needs an unlocked GNOME Keyring or KWallet to save a connection.

Headless VMs use the separate `CPA-Headless-<version>-linux-<arch>.tar.gz` archive and Node.js 22 or later. The archive includes the Go proxy and production JavaScript dependencies, and does not need Electron or an npm install. Extract into a permanent, writable directory under the service user's home:

```sh
mkdir -p ~/.local/opt/cpa
tar -xzf CPA-Headless-<version>-linux-x64.tar.gz -C ~/.local/opt/cpa
~/.local/opt/cpa/cpa serve --name Development --import-config /path/to/config.yaml
```

The proxy and existing management UI listen on loopback port 8317. The connection API listens on loopback port 8318. State, credentials, and usage are stored under `$XDG_STATE_HOME/cpa`, defaulting to `~/.local/state/cpa`. Use `--data-dir /absolute/path` on every command to select another location. Import runs only on the first start; existing OAuth accounts and API keys are copied into this isolated state. The VM uses its own provider sign-ins. To add them through the management UI, forward port 8317 over SSH and open `http://localhost:8317/management.html` using the management key stored in the VM's `desktop-secrets.json`.

For a direct private-network connection, run `cpa serve --host <private-VM-address> --port 8318 --name Development`. For an SSH connection, keep the default loopback binding and run this on the desktop computer:

```sh
ssh -N -L 18318:127.0.0.1:8318 user@vm
```

Run `cpa token` on the VM, then open **Dashboard → Manage environments** in the desktop. Enter a name, `http://127.0.0.1:18318` for the tunnel or the VM's private address, and the token. Public connections should use an HTTPS reverse proxy to port 8318. The token grants usage, model application, and software update access. `cpa token rotate` revokes the old token immediately; disconnect and reconnect in the desktop afterward. Tokens never appear in dashboard responses or browser storage.

The **Environment** selector switches between all environments, this computer, and an individual VM. The overview chart and provider graphs use the same time buckets across VMs. Unavailable environments are explicitly excluded and named above the results. CPA must remain running on each VM to serve its persisted usage.

Select environments in **Manage environments**, then:

- **Apply saved models** copies the last applied **Configure CLI** model choices. Each target keeps its own configuration paths, proxy API key, provider credentials, and backups. Models must be available to that target's Copilot accounts. Restart the target CLIs after applying.
- **Sync to desktop version** downloads the exact desktop version's matching headless release from `NaveDanan/CPA-Desktop`. It verifies GitHub's SHA-256 asset digest before extraction, restarts through the bundled launcher, and rolls back if startup fails. Each result reports success only after that VM reports the target running version. A release without a matching headless asset produces a failure and leaves the current version running. Interrupted updates boot the previous working release.

Always launch through `cpa serve` so update supervision stays active. Do not overlay a new archive onto a running installation. A systemd user-service example is in [examples/cpa.service](examples/cpa.service). Copy it to `~/.config/systemd/user/cpa.service`, adjust the name and host, then run `systemctl --user daemon-reload` and `systemctl --user enable --now cpa`. To keep it running without an interactive login, configure user lingering with `loginctl enable-linger <username>`.

Model choices can also be applied directly with `cpa models --file selection.json`. The file contains `codex` and/or `claude` entries with `enabled`, `all`, `models`, and optional `defaultModel`, for example:

```json
{"codex":{"enabled":true,"all":true,"models":[]},"claude":{"enabled":true,"all":true,"models":[]}}
```

Build from the `desktop` directory with Node.js 22+ and Go 1.26+:

```sh
npm ci
npm run prepare:resources -- --platform linux --arch x64 --ui /path/to/management.html
npm run dist:linux
npm run dist:headless
```

AppImage packaging requires Linux or WSL. For ARM64, prepare with `--arch arm64` and pass `--arm64` to both dist commands. On Windows, `npm run dist` builds the existing NSIS installer after preparing `--platform win32 --arch x64`. Set `CPA_GO` to the Go executable if it is outside PATH. Set `CPA_BACKEND_ROOT` when the Go checkout is somewhere other than the desktop repository's parent. Completed archives and installers go to the repository's `dist/desktop/` directory. The manual **desktop-release** GitHub workflow builds Windows and both Linux architectures and uploads them to an existing version release. Supply its tag, a published backend commit/tag from `NaveDanan/CLIProxyAPI` with v8 usage dashboard support, and the exact management HTML's HTTPS URL and SHA-256. All platforms then bundle the same verified sources. Linux desktop upgrades use the release download page; one-click VM synchronization is available from either desktop platform.

Electron hosts the existing management center and adds a desktop CLI configuration window. It bundles the Go server, starts it hidden, and signs the local window into management automatically. Closing the window hides it in the system tray and keeps the proxy running. Click the tray icon or choose **Open CPA-Desktop** to reopen it. Choose **Quit CPA-Desktop** in the tray menu to stop the proxy and exit. A second launch focuses the existing window. An occupied server port produces an error instead of starting a duplicate.

## Release updates

The app checks [CPA-Desktop releases](https://github.com/NaveDanan/CPA-Desktop/releases) at startup and every six hours, including while running in the tray. You can also check from the title bar or tray menu. Checks are limited to once per minute and require internet access; errors can be retried without interrupting the proxy.

When a newer stable release exists, the title bar displays **Update available** with its version. Click it, hover over it, or focus it with the keyboard to read the release notes. In the installed Windows app, choose **Download update** to download the installer with progress and cancellation. The app checks its size and SHA-256 digest against GitHub's release metadata before offering **Restart and install**. Downloading keeps the proxy running. Installing closes the app, stops the proxy, runs the installer, and reopens the app using the same data directory. Installation briefly interrupts active requests; configuration, accounts, and CLI settings are kept. Downloads and installation start only when requested.

**View release on GitHub** remains available for manual installation, releases without a verified installer, and development builds. For a manual install, quit the app from the tray first. Failed downloads can be retried. If installation fails, the app reopens when its executable is still available and displays an error in the update panel. Temporary downloads are cleaned up after cancellation, on quit, after installation, and on the next startup following an interrupted update.

Publish releases in `NaveDanan/CPA-Desktop` with version tags such as `v1.2.2`, matching the packaged app version in `package.json`. The checker reads all release pages and selects the highest stable version, even when GitHub's **Latest** label points to an older release. Drafts, prereleases, and versions at or below the installed version do not trigger an update. Release notes come from the GitHub release body and are displayed as text. Failed or inaccessible release requests show an error instead of reporting that the app is up to date.

Attach `CLIProxyAPI-Desktop-Setup-<version>.exe` to each release, matching the installer generated by `npm run dist`. In-app updates require an uploaded asset with a positive size and a `sha256:` digest in GitHub's API response. [GitHub supplies the digest for uploaded assets](https://github.blog/changelog/2025-06-03-releases-now-expose-digests-for-release-assets/). No separate update server or manifest is required. Existing app versions that only open GitHub need one manual installation of a build containing this updater; subsequent releases can be installed from the app.

## Build on Windows

Requires Node.js 22.12 or later, npm, and Go 1.26 or later on the build machine only. The desktop source uses TypeScript 7.0.2, pinned in the lockfile.

```powershell
cd desktop
npm ci
npm run prepare:resources -- --ui C:\path\to\existing\management.html
npm test
npm run dist
```

The installer is `../dist/desktop/CLIProxyAPI-Desktop-Setup-1.3.0.exe`. It installs per user and creates Desktop and Start menu shortcuts. No Go, Node.js, terminal, or browser is required on the installed machine.

Application and build-tool sources live in `src/`. CommonJS sources use `.cts`; browser scripts use `.ts`. `npm run build` compiles them to the original runtime paths. Generated JavaScript is ignored by Git. Start, tests, resource preparation, and packaging compile automatically; `npm run typecheck` checks without emitting files. All source files reject implicit `any` types. Existing JavaScript regression tests exercise the compiled application.

The management page, CLI configuration HTML and CSS, window dimensions, sandbox settings, and desktop interactions are preserved. This release includes the new CPA app icon and the sidebar name CPA for Desktop. The Go proxy remains the bundled backend.

For first-run migration, launch the installed application with `--import-config C:\path\to\config.yaml`. The app copies the configuration and JSON account files into its own Windows application-data directory. Existing files remain untouched, API keys and the port are preserved, and subsequent starts reuse the migrated data. Do not bundle user credentials into installers.

The desktop app binds only to `127.0.0.1`, uses its own management key, and disables automatic management-page downloads so the packaged interface stays the same. The renderer is sandboxed and does not receive the actual management key. External sign-in links open in the default browser.

To validate the packaged window, pass `--smoke-test C:\path\to\results`. This checks the dashboard, session, model listing, credential listing, and renderer isolation, saves screenshots, and exits. `--user-data-dir` can isolate test data.

## Copilot usage

Select **Copilot usage** in the desktop sidebar to view model request and token
counts by day. Filter by today, this week, this month, or inclusive custom UTC
dates, and switch the estimated cost between USD and GitHub AI credits.
Prices are fetched from [GitHub's model pricing page](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) on app startup and when you click **Refresh**. The latest successful prices are saved locally and retained if an update fails. Estimates include input, cached input, cache writes, output, and applicable context tiers. One AI credit equals $0.01, so $1 equals 100 AI credits. New records retain token details and are recalculated using the latest saved prices. Older records without those details keep their recorded estimate. Unpriced requests stay visible but do not contribute to the cost estimate.
The history starts when this version of the proxy begins recording requests;
it does not include usage made directly in GitHub or other applications.

## Configure Copilot models in coding CLIs

Click **Configure CLI** under **Controls** in the desktop sidebar. The setup page opens in the main content area, keeps the sidebar available, follows the management center's theme and discovers models from your enabled GitHub Copilot accounts. Claude Code lists Anthropic models; Codex lists OpenAI models. Choose models independently or expose all available models from each client's model family. Choose each client's starting model, then click **Apply to CLIs**.

Claude versions use Anthropic's hyphenated spelling, such as `claude-sonnet-5-1`, while the proxy sends Copilot's original dotted ID upstream. OpenAI IDs such as `gpt-5.1` keep their spelling. Previously saved Claude selections migrate to the canonical name when the proxy advertises it. Claude's Opus, Sonnet, Haiku, and Fable aliases use a selected model from that family when available, and subagents can inherit the session's model instead of a fixed setup-time override.

Default files are `~/.codex/config.toml` and `~/.claude/settings.json`. `CODEX_HOME` and `CLAUDE_CONFIG_DIR` overrides are honored. Edit a path, use **Browse**, or restore its default. Custom paths must be files your CLI actually loads; selecting another path does not change the CLI's configuration directory.

The app merges settings, saves a Codex model catalog alongside its config, and creates uniquely named `.cliproxy-*.bak` backups before replacing existing files. Codex's ChatGPT app connectors are turned off (`features.apps = false`) because their tool definitions add about 700 KB to every request and force frequent compaction; **Restore Defaults** turns them back on unless you had disabled them yourself. TOML formatting and comments may change; unrelated settings are preserved. Selections and paths persist between launches. **Refresh models** reloads the current account models; apply again to update CLI menus when available models change.

**Restore Defaults** opens a dialog with both CLIs selected. Uncheck either CLI to keep its configuration, then confirm. This removes the proxy's connection and model settings at the displayed paths and preserves unrelated preferences and sign-ins. Existing files are backed up first. It also works when model discovery is unavailable. Restart the selected CLIs afterward.

Claude Code uses the proxy API key and stores its starting model in `model`, so `/model` can change it without an `ANTHROPIC_MODEL` override. Apply again to update files generated by earlier desktop versions. Environment overrides set outside these files must be removed in the terminal that launches the CLI.

Keep the desktop proxy running and restart the CLIs after applying. Claude Code's custom `modelPicker` requires v2.1.242 or later. Codex must support `model_catalog_json`. Model menus do not grant upstream model access or guarantee that every model supports every CLI tool. This setup is available in the desktop app, which can access local files; the standalone web management page does not write browser-computer files.

Version 1.2.8 fixes duplicate replies in T3 Code and Codex CLI by keeping a stable response item ID throughout Copilot streams. Text and tool call content are preserved, along with the existing dotted-to-hyphenated model-name conversion. It includes the [Copilot compatibility fixes and audit](https://github.com/NaveDanan/CLIProxyAPI/blob/desktop-v1.2.8/docs/copilot-compatibility-audit.md). Its backend source is pinned by the `desktop-v1.2.8` tag in that repository. After upgrading, refresh the model list, apply the CLI configuration again, and restart Claude Code and Codex.

Version 1.2.9 adds a **Usage and cost** section to the Dashboard page with spend and tokens by provider, model, and harness for the past 24 hours, 7, 30, or 90 days. Usage saved before harnesses were recorded is matched to Claude Code and Codex session logs at startup. The proxy no longer blocks the only Copilot account for 60 seconds after an upstream timeout, so follow-up requests are not rejected with immediate 503 errors; set `transient-error-cooldown-seconds` to restore a cooldown. Apply the CLI configuration again so Codex drops the ChatGPT app connectors described above.

Version 1.2.10 shows model pricing in the dashboard. Hover or focus a model in the **Breakdown** table to see its input, output, cache read, and cache write prices per 1M tokens, in USD or AI credits, with the GitHub cost category. Models whose price rises past a prompt-size threshold have a **Context size** switch between the standard and long-context rates, labeled with the prompt limits your Copilot account reports.
