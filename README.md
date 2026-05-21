# WhatsZapp

A desktop WhatsApp client for Linux and Windows. Messages live in a local SQLite database on your machine, so you can search, script, and back them up without asking Meta for permission.

![WhatsZapp screenshot](screenshot.png)

## Why this exists

**Linux deserves a real app.** WhatsApp Web in a browser tab works, but it is easy to lose in a sea of tabs, hard to minimize to the tray, and heavier than it needs to be. WhatsZapp is an Electron app with a proper window, system theme support, and startup that does not feel like opening another website.

**No built-in AI assistant.** The official client keeps adding bots, suggested replies, and features you did not ask for. WhatsZapp is just chat. If you want AI on your messages later, you can plug in your own model and point it at the local database.

**Your data should be yours.** Every message syncs into SQLite on disk. You can query it with SQL, back it up as a single file, or build tools on top of it. Sending from scripts, webhooks, and a CLI are planned; reading is available today.

## Features

- Split inbox UI inspired by macOS Messages (sent bubbles, sidebar, smooth scrolling)
- Filter by All, DMs, or Groups, plus in-app search
- Contact names resolved when possible; push names shown when that is all WhatsApp provides
- Group chats show sender name and avatar on each message
- Unread badges update on new messages and clear when you open a chat
- Dark, Light, or system theme
- Local SQLite storage (WAL mode) for fast sync and external access
- Relink flow when you get a new phone or your session expires (QR scan)

## Tech stack

| Layer | Technology |
|-------|------------|
| Shell | Electron 33 (frameless on Linux) |
| UI framework | React 19 + Vite |
| Component library | chatcn (macOS Messages style) |
| Styling | Tailwind CSS v3 |
| WhatsApp protocol | [Baileys](https://github.com/WhiskeySockets/Baileys) 6.x (main process only) |
| Database | better-sqlite3 (SQLite WAL) |
| IPC | contextBridge + typed channels (renderer never touches Node directly) |

## Installation

### Pre-built releases

Download from [**Releases**](https://github.com/laxman-patel/whatsapp-linux/releases):

| Platform | File |
|----------|------|
| Linux (x86_64) | `WhatsZapp-*-linux-x64.AppImage` |
| Windows (x64) | `WhatsZapp-*-windows-setup.exe` |

**Linux (AppImage):**

```bash
chmod +x WhatsZapp-*-linux-x64.AppImage
./WhatsZapp-*-linux-x64.AppImage
```

If you see a FUSE error, install `fuse2` (`sudo pacman -S fuse2` on Arch, `sudo apt install libfuse2` on Ubuntu/Debian).

**Windows (installer):**

Run the `.exe` and follow the prompts. SmartScreen may flag the unsigned binary on first run. Use *More info → Run anyway* if you trust the build.

## Build from source

**Requirements:** Node.js 20+, Linux or Windows (macOS works for dev; AppImage targets Linux)

```bash
git clone https://github.com/laxman-patel/whatsapp-linux
cd whatsapp-linux
npm install   # postinstall rebuilds better-sqlite3 for Electron
```

**Development:**

```bash
npm run dev
```

Opens Vite + Electron with hot reload. On first launch, link your account: **WhatsApp → Settings → Linked Devices → Link a device**, then scan the QR code.

**Production build:**

```bash
npm run build   # output in release/<version>/
```

Produces an AppImage on Linux and an NSIS installer on Windows.

**Tagged releases (CI):**

```bash
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions uploads artifacts to the Releases tab.

## Data and privacy

Everything stays on your computer:

| Path | Contents |
|------|----------|
| `~/.config/whatsapp-desktop/baileys-auth/` | WhatsApp session keys (Linux) |
| `~/.config/whatsapp-desktop/whatsapp.db` | Messages, chats, contacts (SQLite) |
| `~/.config/whatsapp-desktop/avatars/` | Cached profile pictures |

On Windows, the same folder name lives under `%APPDATA%\whatsapp-desktop\`.

The app only talks to WhatsApp's own servers for messaging. Nothing is sent to a third-party backend run by this project.

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

## Roadmap

**AI and automation**

- [ ] Bring-your-own AI (local models or your API keys, not Meta's)
- [ ] Agent API (local HTTP / MCP endpoint for inbox read/write)
- [ ] Smart inbox (priority contacts, custom filters, rules)
- [ ] Programmatic send from scripts
- [ ] Webhooks on new messages
- [ ] Reply from the terminal

**Messaging**

- [ ] Media download and display (images, video, audio, documents)
- [ ] Send attachments from the composer
- [ ] OS notifications for new messages
- [ ] Read receipts via Baileys
- [ ] System tray icon and badge
- [ ] Full-text search across SQLite
- [ ] Per-chat export (JSON/CSV)

## Disclaimer

WhatsZapp is not affiliated with Meta or WhatsApp. It uses the unofficial [Baileys](https://github.com/WhiskeySockets/Baileys) library, which reverse-engineers the WhatsApp Web protocol. Unofficial clients may violate WhatsApp's Terms of Service and can lead to account restrictions or bans. Use at your own risk.

## License

MIT. See [LICENSE](LICENSE).

Application code © 2025 Laxman. Baileys is separately licensed under its own terms.
