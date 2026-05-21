# Zap ⚡

**A fast, clean, programmable WhatsApp client for Linux and Windows — built because nothing else is.**

![Zap screenshot](screenshot.png)

---

## Why Zap?

### 1. There is no real WhatsApp desktop client for Linux
Meta ships WhatsApp Web and a Windows/macOS app. Linux users are left with a browser tab that eats RAM, can't run in the background as a tray app, has no notifications that survive a browser restart, and feels nothing like a native application. Zap is a proper desktop app — frameless window, system dark mode, SQLite-backed message history, instant startup.

### 2. WhatsApp's "Meta AI" gets in the way
Meta's AI feature occupies prime UI real estate, intercepts messages, and offers zero value for anyone who wants a fast messaging client. Zap has no AI overlay, no chat-with-AI prompt at the top of your inbox, and no suggested replies you didn't ask for.

### 3. You can't automate or prioritize anything in the official app
Read receipts, priority contacts, filtered views, message search — all locked inside a walled garden. Zap exposes your messages through a local SQLite database so you can query, script, and build on top of them. Future: programmatic send, webhooks, reply-from-CLI.

### 4. Backups
The official app stores nothing accessible on desktop. Zap writes every message to `~/.config/zap/whatsapp.db` — a plain SQLite file you can `cp`, encrypt, or sync however you want.

---

## Features

- **macOS Messages-style UI** — blue sent bubbles, split inbox, smooth scroll
- **All / DMs / Groups** filter with live search
- **Real contact names** — resolves LID-to-phone aliases, falls back gracefully to push name or number
- **Profile pictures** — fetched and cached locally, served via a custom `wa-avatar://` protocol
- **Unread badges** — cleared on open, incremented on live notify only (no badge spam during sync)
- **Group sender identity** — correct per-message avatar and name in group chats
- **Inline sync status** — small spinner next to "Messages" while history loads; tap to re-sync
- **Dark / Light / System** theme, toggled from the title bar
- **Local SQLite** — WAL mode, mmap cache, fast bulk inserts during history sync
- **Relink button** — one click to clear session and scan a fresh QR code

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Shell | Electron 33 (frameless on Linux) |
| UI framework | React 19 + Vite |
| Component library | chatcn (macOS Messages style) |
| Styling | Tailwind CSS v3 |
| WhatsApp protocol | [Baileys](https://github.com/WhiskeySockets/Baileys) 6.x (main process only) |
| Database | better-sqlite3 (SQLite WAL) |
| IPC | contextBridge + typed channels — renderer never touches Node directly |

---

## Installation

### Download a pre-built release

Head to the [**Releases**](../../releases) page and grab:

| Platform | File |
|----------|------|
| Linux (x86_64) | `Zap-*.AppImage` |
| Windows (x64) | `Zap-*-Setup.exe` |

**Linux — AppImage:**
```bash
chmod +x Zap-*.AppImage
./Zap-*.AppImage
```

> If you get a FUSE error: `sudo pacman -S fuse2` (Arch) or `sudo apt install libfuse2` (Ubuntu/Debian).

**Windows — installer:**
Run the `.exe` and follow the prompts. Windows Defender SmartScreen may warn on first run (unsigned binary) — click *More info → Run anyway*.

---

## Build from source

### Prerequisites

- Node.js 20+
- Linux or Windows (macOS works for development but AppImage targets Linux)

```bash
git clone https://github.com/laxman-patel/whatsapp-linux
cd whatsapp-linux
npm install         # also rebuilds better-sqlite3 for Electron via postinstall
```

### Development

```bash
npm run dev
```

Launches Vite dev server + Electron with hot-reload. On first launch a QR code appears — scan it in WhatsApp → Linked Devices.

### Production build

```bash
npm run build       # outputs to release/<version>/
```

Produces an AppImage on Linux and an NSIS installer on Windows.

---

## Linking your account

1. Open Zap — a QR code screen appears.
2. On your phone: **WhatsApp → Settings → Linked Devices → Link a device**.
3. Scan the QR code.
4. History syncs automatically in the background (progress shown in the status bar).

To re-link: click **Relink** in the title bar. This clears the local session and database and shows a fresh QR.

---

## Data & privacy

All data stays **local**:

| Path | Contents |
|------|----------|
| `~/.config/zap/baileys-auth/` | WhatsApp session keys |
| `~/.config/zap/whatsapp.db` | Messages, chats, contacts (SQLite) |
| `~/.config/zap/avatars/` | Cached profile pictures |

Nothing is transmitted to any server other than WhatsApp's own infrastructure.

---

## Project structure

```
electron/
  main/
    baileys/        WhatsApp socket, avatar fetcher, contact aliases
    db/             SQLite schema, migrations, repositories
    index.ts        Electron app entry, protocol registration
    ipc.ts          IPC handler registration
    sync-progress.ts Sync state machine + broadcaster

src/
  components/       React UI components
    ui/chat/        chatcn message/sidebar/header components
  hooks/            useChats, useMessages, useSyncProgress
  lib/adapters/     Baileys → chatcn data mappers
  shared/           IPC types shared between main & renderer
```

---

## Roadmap

- [ ] **Media** — download and render images, video, audio, documents
- [ ] **Send media** — attach and send files from the composer
- [ ] **Notifications** — OS-level notifications for new messages
- [ ] **Read receipts** — mark messages as read via Baileys
- [ ] **Tray icon** — minimize to system tray, badge count
- [ ] **Programmatic API** — local HTTP or IPC endpoint for scripting
- [ ] **Message search** — full-text search across SQLite
- [ ] **Export** — one-click JSON/CSV export per chat

---

## Disclaimer

Zap is **not** affiliated with or endorsed by Meta or WhatsApp. It uses the unofficial [Baileys](https://github.com/WhiskeySockets/Baileys) library, which reverse-engineers the WhatsApp Web protocol. Using unofficial clients **may violate WhatsApp's Terms of Service** and could result in your account being temporarily or permanently banned. Use at your own risk.

---

## License

MIT — see [LICENSE](LICENSE).

Application code © 2025 Laxman. Baileys is separately licensed under its own terms.
