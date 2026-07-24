# 🎛 Aurumo DAW

A desktop **Digital Audio Workstation controlled 100% by Claude**. You don't click around a mixer — you *talk* to Claude, and it builds the song for you: tracks, drum patterns, basslines, chord progressions, tempo, mixing. A live piano roll and track list update in real time as Claude works, and you hear the result instantly.

Built with **Electron + React + Tone.js (Web Audio synthesis)**. Claude drives everything through a small tool-based command protocol.

---

## How it works

```
You (chat)  ─▶  Claude (Anthropic API, in the Electron main process)
                   │  emits tool calls = DAW commands
                   ▼
            Renderer applies commands ─▶ Tone.js audio engine + piano-roll UI
```

Claude has a fixed set of tools that *are* the studio's controls: `add_track`, `add_notes`,
`set_tempo`, `set_track_volume`, `set_loop`, `transport`, etc. When you ask for something,
Claude reasons about the music and calls those tools; the app applies each one to the audio
engine and the visible UI.

The API key lives in the Electron main process (not the browser renderer), so it's never
exposed to page code.

---

## Getting started

Requirements: **Node 18+**.

```bash
npm install
npm run dev
```

That launches the desktop app. On first run, click **Connect** and paste an Anthropic API key
(get one at https://console.anthropic.com/settings/keys). It's stored locally in your OS user-data
folder — or set `ANTHROPIC_API_KEY` in a `.env` file instead.

Then just ask, e.g.:

- *"Make a lo-fi hip hop beat at 82 BPM"*
- *"Add a walking bassline in C minor"*
- *"Give me a dreamy 4-chord pad progression and play it"*
- *"Make the hi-hats busier and drop the kick a bit"*

Press **▶ Play** (top-left) any time to hear the current arrangement. Click a track to see its
notes in the piano roll.

---

## Instruments

Web-Audio synths (no samples needed): `synth`, `fm`, `am`, `pluck`, `bass`, `pad`, and drum voices
`kick`, `snare`, `hihat`. Claude picks appropriate ones per request.

## Project layout

| Path | What |
|------|------|
| `electron/main.ts` | Electron window + IPC + local API-key store |
| `electron/claude.ts` | Anthropic client, the DAW tool definitions, the agent loop |
| `src/audio/engine.ts` | Tone.js engine (instruments, scheduling, transport) |
| `src/state/store.ts` | Project state + command executor (zustand) |
| `src/components/` | Transport, TrackList, PianoRoll, ChatPanel, ApiKeyModal |

## Notes & limitations (MVP)

- 4/4 only, synth/MIDI sound (no audio recording or samples yet).
- The piano roll is a live visualization; editing is done through Claude.
- Roadmap: manual note editing, effects (reverb/delay), sample kits, export to WAV/MIDI.

## Build

```bash
npm run build
```
