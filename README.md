# CLIProxyAPI Desktop

Electron hosts the existing management center and adds a desktop CLI configuration window. It bundles the Go server, starts it hidden, and signs the local window into management automatically. Closing the window hides it in the system tray and keeps the proxy running. Click the tray icon or choose **Open CPA-Desktop** to reopen it. Choose **Quit CPA-Desktop** in the tray menu to stop the proxy and exit. A second launch focuses the existing window. An occupied server port produces an error instead of starting a duplicate.

## Release updates

The app checks [CPA-Desktop releases](https://github.com/NaveDanan/CPA-Desktop/releases) at startup and every six hours, including while running in the tray. You can also check from the title bar or tray menu. Checks are limited to once per minute and require internet access; errors can be retried without interrupting the proxy.

When a newer stable release exists, the title bar displays **Update available** with its version. Hover over it or focus it with the keyboard to read the release notes. **View release on GitHub** opens the release page to download the installer. Updates are not downloaded or installed automatically. Close the app using the tray's Quit command before running an installer.

Publish releases in `NaveDanan/CPA-Desktop` with version tags such as `v1.2.2`, matching the packaged app version in `package.json`. The checker reads all release pages and selects the highest stable version, even when GitHub's **Latest** label points to an older release. Drafts, prereleases, and versions at or below the installed version do not trigger an update. Release notes come from the GitHub release body and are displayed as text. Failed or inaccessible release requests show an error instead of reporting that the app is up to date.

## Build on Windows

Requires Node.js 22.12 or later, npm, and Go 1.26 or later on the build machine only. The desktop source uses TypeScript 7.0.2, pinned in the lockfile.

```powershell
cd desktop
npm ci
npm run prepare:resources -- --ui C:\path\to\existing\management.html
npm test
npm run dist
```

The installer is `dist/CLIProxyAPI-Desktop-Setup-1.2.6.exe`. It installs per user and creates Desktop and Start menu shortcuts. No Go, Node.js, terminal, or browser is required on the installed machine.

Application and build-tool sources live in `src/`. CommonJS sources use `.cts`; browser scripts use `.ts`. `npm run build` compiles them to the original runtime paths. Generated JavaScript is ignored by Git. Start, tests, resource preparation, and packaging compile automatically; `npm run typecheck` checks without emitting files. All source files reject implicit `any` types. Existing JavaScript regression tests exercise the compiled application.

The management page, CLI configuration HTML and CSS, window dimensions, sandbox settings, and desktop interactions are preserved. This release includes the new CPA app icon and the sidebar name CPA for Desktop. The Go proxy remains the bundled backend.

For first-run migration, launch the installed application with `--import-config C:\path\to\config.yaml`. The app copies the configuration and JSON account files into its own Windows application-data directory. Existing files remain untouched, API keys and the port are preserved, and subsequent starts reuse the migrated data. Do not bundle user credentials into installers.

The desktop app binds only to `127.0.0.1`, uses its own management key, and disables automatic management-page downloads so the packaged interface stays the same. The renderer is sandboxed and does not receive the actual management key. External sign-in links open in the default browser.

To validate the packaged window, pass `--smoke-test C:\path\to\results`. This checks the dashboard, session, model listing, credential listing, and renderer isolation, saves screenshots, and exits. `--user-data-dir` can isolate test data.

## Copilot usage

Select **Copilot usage** in the desktop sidebar to view model request and token
counts by day. Filter by today, this week, this month, or inclusive custom UTC
dates, and switch the estimated cost between USD and GitHub AI credits.
Unpriced requests stay visible but do not contribute to the cost estimate.
The history starts when this version of the proxy begins recording requests;
it does not include usage made directly in GitHub or other applications.

## Configure Copilot models in coding CLIs

Click **Configure CLI** under **Controls** in the desktop sidebar. The setup page opens in the main content area, keeps the sidebar available, follows the management center's theme and discovers models from your enabled GitHub Copilot accounts. Claude Code lists Anthropic models; Codex lists OpenAI models. Choose models independently or expose all available models from each client's model family. Choose each client's starting model, then click **Apply to CLIs**.

Claude versions use Anthropic's hyphenated spelling, such as `claude-sonnet-5-1`, while the proxy sends Copilot's original dotted ID upstream. OpenAI IDs such as `gpt-5.1` keep their spelling. Previously saved Claude selections migrate to the canonical name when the proxy advertises it. Claude's Opus, Sonnet, Haiku, and Fable aliases use a selected model from that family when available, and subagents can inherit the session's model instead of a fixed setup-time override.

Default files are `~/.codex/config.toml` and `~/.claude/settings.json`. `CODEX_HOME` and `CLAUDE_CONFIG_DIR` overrides are honored. Edit a path, use **Browse**, or restore its default. Custom paths must be files your CLI actually loads; selecting another path does not change the CLI's configuration directory.

The app merges settings, saves a Codex model catalog alongside its config, and creates uniquely named `.cliproxy-*.bak` backups before replacing existing files. TOML formatting and comments may change; unrelated settings are preserved. Selections and paths persist between launches. **Refresh models** reloads the current account models; apply again to update CLI menus when available models change.

**Restore Defaults** opens a dialog with both CLIs selected. Uncheck either CLI to keep its configuration, then confirm. This removes the proxy's connection and model settings at the displayed paths and preserves unrelated preferences and sign-ins. Existing files are backed up first. It also works when model discovery is unavailable. Restart the selected CLIs afterward.

Claude Code uses the proxy API key and stores its starting model in `model`, so `/model` can change it without an `ANTHROPIC_MODEL` override. Apply again to update files generated by earlier desktop versions. Environment overrides set outside these files must be removed in the terminal that launches the CLI.

Keep the desktop proxy running and restart the CLIs after applying. Claude Code's custom `modelPicker` requires v2.1.242 or later. Codex must support `model_catalog_json`. Model menus do not grant upstream model access or guarantee that every model supports every CLI tool. This setup is available in the desktop app, which can access local files; the standalone web management page does not write browser-computer files.

Version 1.2.6 includes the [Copilot compatibility fixes and audit](https://github.com/NaveDanan/CLIProxyAPI/blob/desktop-v1.2.6/docs/copilot-compatibility-audit.md). Its backend source is pinned by the `desktop-v1.2.6` tag in that repository. After upgrading, refresh the model list, apply the CLI configuration again, and restart Claude Code and Codex.
