import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-opus-4-8'

const INSTRUMENTS = [
  'synth', 'fm', 'am', 'pluck', 'bass', 'pad',
  'kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'rim',
]

const KIT_NAMES = ['808', 'acoustic', 'lofi', 'techno']

// The tools ARE the DAW's control surface. Claude emits tool calls; the main
// process records them as "commands" and hands them back to the renderer,
// which owns the audio + UI state and actually applies them.
const tools: Anthropic.Tool[] = [
  {
    name: 'set_tempo',
    description: 'Set the project tempo in beats per minute (BPM).',
    input_schema: {
      type: 'object',
      properties: { bpm: { type: 'number', description: 'Tempo, 40-240' } },
      required: ['bpm'],
    },
  },
  {
    name: 'add_track',
    description:
      'Create a new track with an instrument. Tracks are referenced by their name everywhere else, so use a unique, descriptive name (e.g. "Kick", "Bass", "Lead"). If a track with the name already exists this just updates its instrument.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        instrument: { type: 'string', enum: INSTRUMENTS },
        volume: { type: 'number', description: 'Volume in dB, e.g. -6. Optional.' },
      },
      required: ['name', 'instrument'],
    },
  },
  {
    name: 'remove_track',
    description: 'Delete a track by name.',
    input_schema: {
      type: 'object',
      properties: { track: { type: 'string' } },
      required: ['track'],
    },
  },
  {
    name: 'set_instrument',
    description: 'Change the instrument of an existing track.',
    input_schema: {
      type: 'object',
      properties: {
        track: { type: 'string' },
        instrument: { type: 'string', enum: INSTRUMENTS },
      },
      required: ['track', 'instrument'],
    },
  },
  {
    name: 'set_track_volume',
    description: 'Set a track volume in decibels (0 = unity, negative = quieter).',
    input_schema: {
      type: 'object',
      properties: { track: { type: 'string' }, volume: { type: 'number' } },
      required: ['track', 'volume'],
    },
  },
  {
    name: 'set_track_mute',
    description: 'Mute or unmute a track.',
    input_schema: {
      type: 'object',
      properties: { track: { type: 'string' }, muted: { type: 'boolean' } },
      required: ['track', 'muted'],
    },
  },
  {
    name: 'add_notes',
    description:
      'Append notes to a track. Time is measured in BEATS from the start of the song (0 = very start; in 4/4 one bar = 4 beats). pitch uses scientific note names like "C4", "F#3", "Eb5". For drum instruments (kick/snare/hihat) the pitch is mostly ignored, so any low pitch like "C2" is fine.',
    input_schema: {
      type: 'object',
      properties: {
        track: { type: 'string' },
        notes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pitch: { type: 'string', description: 'e.g. "C4"' },
              start: { type: 'number', description: 'beats from song start' },
              duration: { type: 'number', description: 'length in beats (0.25 = a 16th)' },
              velocity: { type: 'number', description: '0..1, default 0.8' },
            },
            required: ['pitch', 'start', 'duration'],
          },
        },
      },
      required: ['track', 'notes'],
    },
  },
  {
    name: 'clear_track',
    description: 'Remove all notes from a track (keeps the track and instrument).',
    input_schema: {
      type: 'object',
      properties: { track: { type: 'string' } },
      required: ['track'],
    },
  },
  {
    name: 'set_loop',
    description: 'Set the song loop length in bars (4/4). The transport loops over this region.',
    input_schema: {
      type: 'object',
      properties: { bars: { type: 'number' } },
      required: ['bars'],
    },
  },
  {
    name: 'set_kit',
    description:
      'Choose the drum kit used by all drum tracks (kick/snare/hihat/openhat/clap/tom/rim). Each kit has a different character.',
    input_schema: {
      type: 'object',
      properties: { kit: { type: 'string', enum: KIT_NAMES } },
      required: ['kit'],
    },
  },
  {
    name: 'transport',
    description: 'Start or stop playback so the user can hear the result.',
    input_schema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['play', 'stop'] } },
      required: ['action'],
    },
  },
]

function systemPrompt(project: any): string {
  return `You are the engine of "Jamalam Studio", a music production app that you control entirely through tools.
The user talks to you in chat; you build and edit the song by calling tools. There is a live piano-roll and mixer the user watches update as you work.

How to work:
- Reason about the musical goal, then call the tools to realize it. You can call many tools in one turn.
- Reference tracks by their NAME. Create a track (add_track) before adding notes to it.
- Time is in BEATS from the start of the song. 4/4 assumed: 1 bar = 4 beats. A 16th note = 0.25 beats.
- Drums are SAMPLE-BASED. Build them from separate tracks, one per drum piece: "Kick" (kick), "Snare" (snare), "Hihat" (hihat), plus optional "Openhat" (openhat), "Clap" (clap), "Tom" (tom), "Rim" (rim). The pitch of drum notes is ignored — use any low pitch like "C2".
- Pick a drum kit with set_kit when it fits the style (${KIT_NAMES.join(', ')}): 808 for hip hop/trap, acoustic for organic/rock, lofi for chill/dusty, techno for four-on-the-floor. Default is 808.
- Bass/lead/chords use bass/pad/synth/fm/pluck/am.
- Keep velocities musical (0.6-0.9). Accent downbeats; ghost notes quieter.
- After you finish building or editing something, call set_loop to fit the section, then transport play so the user hears it — unless they only asked a question.
- Keep a short, friendly chat reply describing what you made. Don't dump note lists in the text.

Melodic instruments: synth, fm, am, pluck, bass, pad. Sampled drum pieces: kick, snare, hihat, openhat, clap, tom, rim.

Current project state (JSON):
${JSON.stringify(project, null, 2)}`
}

export async function runChat(
  apiKey: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  project: any,
): Promise<{ text: string; commands: any[] }> {
  const client = new Anthropic({ apiKey })
  const system = systemPrompt(project)

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  const commands: any[] = []
  let text = ''

  for (let i = 0; i < 10; i++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      tools,
      messages,
    })

    messages.push({ role: 'assistant', content: resp.content })

    for (const block of resp.content) {
      if (block.type === 'text') text += block.text
    }

    if (resp.stop_reason !== 'tool_use') break

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of resp.content) {
      if (block.type === 'tool_use') {
        commands.push({ type: block.name, ...(block.input as object) })
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: 'ok',
        })
      }
    }
    messages.push({ role: 'user', content: toolResults })
  }

  return { text: text.trim(), commands }
}
