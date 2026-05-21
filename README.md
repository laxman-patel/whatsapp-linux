# WhatsApp Desktop (Linux)

Personal, unofficial WhatsApp desktop client for Linux (Arch, x86_64) built with **Electron**, **Baileys**, and a **macOS Messages-style** UI powered by [chatcn](https://github.com/leonickson1/chatcn).

## Disclaimer

This is **not** an official WhatsApp client. It uses the unofficial [Baileys](https://github.com/WhiskeySockets/Baileys) library and violates WhatsApp's Terms of Service. Your account may be **banned** or require **re-pairing**. Use at your own risk.

## Current status

| Phase | Status |
|-------|--------|
| **0 — Scaffold** | Mock conversations, filter toggle, IPC bridge, chatcn UI |
| 1 — Baileys session | QR auth, reconnect |
| 2 — Chats & messages | SQLite, live sync |
| 3 — Media | Download, send/receive |
| 4 — Polish | Notifications, AppImage, read receipts |

## Features (Phase 0)

- Split inbox layout (conversation list + active chat)
- **All / DMs / Groups** filter toggle under search (persisted via electron-store)
- Search within filtered conversations
- Mock data: 2 DMs + 2 groups
- Typed IPC via preload `contextBridge` (Baileys stays in main process only)

## Requirements

- Node.js 20+ (Electron 33 bundles its own Node for runtime)
- Linux x86_64 (Arch tested)
- For AppImage: `fuse2` may be required

## Development

```bash
npm install
npm run dev
```

## Build (AppImage)

```bash
npm run build
```

Output: `release/<version>/WhatsApp Desktop-<version>.AppImage`

## Wayland / X11

Electron uses `--ozone-platform-hint=auto` by default on recent builds. If you hit rendering issues:

```bash
./WhatsApp\ Desktop-*.AppImage --ozone-platform=x11
```

## Project structure

```
electron/          Main process (Baileys, SQLite, IPC)
src/renderer/      React UI (chatcn, hooks, adapters)
src/shared/        IPC types shared between main & renderer
```

## License

MIT (application code). Baileys is unofficial and not affiliated with Meta/WhatsApp.
