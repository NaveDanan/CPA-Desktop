# CLI model setup

This document covers the desktop CLI model configuration page in `harness.html`, `harness.css`, and `harness-renderer.js`. It does not prescribe a redesign of the management UI.

The page is an operational setup tool using the management center's current theme. Copy its semantic background, text, border, and neutral accent tokens into the embedded setup page and follow live light, white, and dark theme changes. Use system typography, thin rules between sections, and a high-contrast neutral primary action. The Configure CLI entry belongs to the sidebar's Controls group and uses the existing navigation styles. Selecting it shows the setup form in the main content area while preserving the sidebar and header. Switching tabs retains unfinished form values.

Each CLI has an enable checkbox, an all-models checkbox, an editable configuration path with Browse and default-path reset, and a session-default model selector. A shared searchable table shows independent model selections for Codex and Claude Code. Keep model names and IDs readable, with sticky column headings inside the scrolling model list.

On wide windows, place the path and session default side by side. At widths of 750 CSS pixels or less, stack these fields and expand search to the available width. Allow client headings to wrap. Long paths stay editable within their inputs instead of widening the page.

Keep Apply visible in a fixed bottom action bar with backup and restart guidance. Stack the bar contents in narrow windows and reserve enough space below the document for content to scroll above it. Show success and error messages in the live status region and scroll that region into view.

Use explicit field labels, model-specific checkbox accessible names, visible neutral keyboard focus, themed selection and caret colors, and native form controls. Disable Apply while loading or saving, when no CLI is enabled, or when any enabled CLI has no selected models. Refresh removes unavailable model selections and explains the change.

Restore Defaults opens a native modal dialog with Codex and Claude Code checked. Show the exact paths and explain that restoring removes proxy connection and model settings while preserving unrelated settings and sign-ins. Disable confirmation with no selection and keep errors inside the dialog. Cancel returns focus to the opening button. Restoration remains available when model discovery fails.
