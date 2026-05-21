# WhatsZapp

**WhatsApp on your desktop, built for the AI you choose.**

WhatsZapp is an AI-native desktop client for Linux and Windows. Every message syncs into a local SQLite database on your machine. Your scripts, agents, and models can read that data today. Meta's assistant cannot.

![WhatsZapp screenshot](screenshot.png)

## Why WhatsZapp instead of Meta AI?

Meta's AI lives inside their app. It suggests replies, pushes bots into your inbox, and runs on their servers with their rules. You cannot point it at a local model, pipe your full chat history into your own stack, or let an agent act on your inbox without sending everything through Meta first.

WhatsZapp flips that:

| What you want | Meta AI | WhatsZapp |
|---------------|---------|-------------|
| AI on your terms | Their model, their UI | Bring your own model and API keys (roadmap) |
| Full history for agents | Locked in the app | Plain SQLite you can query with SQL today |
| Automate replies and workflows | Limited, inside WhatsApp | Agent API, webhooks, CLI (roadmap) |
| Privacy for sensitive chats | Processed on Meta's stack | Data stays on disk; only WhatsApp servers for sync |
| No unsolicited AI in the UI | Bots, banners, suggested replies | Chat first. AI when you wire it up |

WhatsZapp does not ship a chatbot in your sidebar. It ships the **foundation** Meta will never give you: a real desktop app plus a database your tools can actually use.

## What AI-native means here

**Today:** Every message lands in `~/.config/whatsapp-desktop/whatsapp.db`. WAL mode, fast sync, one file to back up or copy. You can already inspect chats with SQL, build dashboards, or feed exports into whatever model stack you run.

**Coming (see [Roadmap](#roadmap)):**

- **Bring-your-own AI** — Ollama, OpenAI, Anthropic, or whatever you run. Your keys, your prompts, your policy.
- **Agent API** — Local HTTP / MCP so agents can search threads, summarize groups, and draft replies without a browser tab.
- **Smart inbox** — Rules and filters you define (priority contacts, mute patterns, auto-labels).
- **Programmatic send** — Reply from scripts, cron, or your backend.
- **Webhooks** — Trigger automations when a message arrives.
- **Reply from the terminal** — One command to answer without opening the window.

That is the gap Meta AI cannot close: they optimize for engagement inside WhatsApp. WhatsZapp optimizes for **your** automation stack outside it.

## Desktop app (not a browser tab)

Linux and Windows get a proper Electron window: system theme, split inbox inspired by macOS Messages, tray-friendly workflow (tray icon on the roadmap). No tab lost among twenty others, no "please keep this tab open" energy.

## Features

- Split inbox UI (sent bubbles, sidebar, smooth scrolling)
- Filter by All, DMs, or Groups, plus in-app search
- Contact names when available; push names when that is all WhatsApp provides
- Group chats show sender name and avatar per message
- Unread badges on new messages; clear when you open a chat
- Dark, Light, or system theme
- Local SQLite storage for sync and external access
- Relink via QR when your session or phone changes

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

Download from [**Releases**](https://github.com/laxman-patel/WhatsZapp/releases):

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
git clone https://github.com/laxman-patel/WhatsZapp.git
cd WhatsZapp
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

The app talks to WhatsApp's servers for messaging only. This project does not run a cloud backend that sees your chats. When you add AI, you choose where that processing happens.

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
