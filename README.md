# 🎛 Jamalam Studio

The **desktop editing & export workbench** of the [Jamalam](../../README.md) project. You capture and create on the **Jamalam mobile app**; you bring those jams into **Jamalam Studio** to arrange, edit, and mix — and when you want serious production, you **export to any DAW**. It's intentionally *not* a full pro DAW — it's a clean bridge to one.

Built with **Electron + React + TypeScript + Tone.js (Web Audio)**.

> Part of the Jamalam product: the mobile app is sold standalone; **Jamalam Studio + Jamalam** is sold as a bundle. See the [architecture overview](../../docs/architecture.md).

---

## Where it fits

```
📱 Jamalam (mobile)  →  ☁️ cloud sync  →  🖥 Jamalam Studio  →  🎛 any DAW
     capture & create        sessions + stems      edit & export      Ableton · Logic · …
```

## What it does today

- **Talk to Claude to build & edit music.** Ask in plain language ("add a walking bassline in C minor", "make the hats busier") and Claude builds it — tracks, drum patterns, basslines, chords, tempo, mixing — through a tool-based command protocol. The Anthropic call runs in the Electron **main process**; your API key is stored locally and never exposed to page code.
- **Piano-roll editing.** Draw, move, resize, and delete notes directly; a **velocity lane** (drag or scroll a note) to shape dynamics.
- **Sample-based drum kits.** `808`, `acoustic`, `lofi`, `techno` — each rendered to one-shot samples on the fly (swap via the header or `set_kit`).
- **Free Jam capture.** Record live audio from the mic straight to a `.wav` on disk (streamed, so long takes never fill RAM), flag the good moments as you go. This is the seed of the mobile capture flow.
- **Auto-update.** Ships as a Windows installer and updates itself from GitHub releases.

## Its evolving role (planned)

- **Import jams recorded on the Jamalam mobile app** (via cloud sync) — multitrack takes, split stems, and the sound-to-instrument tracks (beatbox→drums, whistle→lead).
- **Export → WAV stems + MIDI** that any DAW imports.
- Arrange and refine imported group jams.

---

## Getting started (development)

Requirements: **Node 18+**.

```bash
npm install
npm run dev
```

That launches the desktop app. On first run, click **Connect** and paste an Anthropic API key (get one at https://console.anthropic.com/settings/keys) — it's stored locally in your OS user-data folder. Or set `ANTHROPIC_API_KEY` in a `.env`.

## Tech stack

Electron 30 · React 18 · TypeScript · Vite (`vite-plugin-electron`) · **Tone.js 14.7** (Web Audio) · zustand · `@anthropic-ai/sdk` (main process) · electron-builder + electron-updater. In production the renderer is served over a custom secure `app://` scheme (not `file://`) so `getUserMedia` / AudioWorklet run in a secure context.

## Project layout

| Path | What |
|------|------|
| `electron/main.ts` | Window, IPC, local API-key store, `app://` scheme, auto-update, Free Jam IPC |
| `electron/claude.ts` | Anthropic client, the DAW tool definitions, the agent loop |
| `electron/recorder.ts` | Free Jam WAV writer (streams PCM to disk) |
| `electron/preload.ts` | Context-isolated IPC bridge |
| `src/audio/engine.ts` | Tone.js engine — instruments, scheduling, transport |
| `src/audio/kits.ts` | Sample-based drum kits (offline-rendered one-shots) |
| `src/audio/recorder.ts` | Mic capture (AudioWorklet → 16-bit PCM) |
| `src/state/store.ts` | Project state + command executor (zustand) |
| `src/components/` | Transport, TrackList, PianoRoll, ChatPanel, ApiKeyModal, FreeJam, UpdateBanner |
| `build/`, `public/` | App icon + favicons, generated from the Jamalam logo |

## Build & release

```bash
npm run build     # build renderer + electron
npm run dist      # local installer in release/  (does NOT publish)
npm run release   # build + publish to GitHub (needs GH_TOKEN); installed apps auto-update
```

Publishing: `GH_TOKEN="$(gh auth token)" npm run release` → GitHub repo `AurumoConsultants/jamalam-studio`. **Close the app before building** — a running instance locks the `.exe`.

## Status / limitations

- 4/4 only; no effects yet; editing today is Claude + the piano roll.
- Importing mobile jams and export (WAV stems + MIDI) are the next big pieces of the Studio role.
