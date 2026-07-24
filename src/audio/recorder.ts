// Free Jam capture (renderer side): grabs the mic, converts to 16-bit mono PCM
// in an AudioWorklet, and streams chunks to the main process to write to disk.

const WORKLET_SRC = `
class JamCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this._size = 4800 // ~0.1s at 48k -> ~10 messages/sec
    this._buf = new Int16Array(this._size)
    this._n = 0
    this._peak = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        let s = ch[i]
        if (s > 1) s = 1
        else if (s < -1) s = -1
        this._buf[this._n++] = s < 0 ? s * 0x8000 : s * 0x7fff
        const a = s < 0 ? -s : s
        if (a > this._peak) this._peak = a
        if (this._n === this._size) {
          const out = this._buf.slice(0, this._n)
          this.port.postMessage({ pcm: out, level: this._peak }, [out.buffer])
          this._buf = new Int16Array(this._size)
          this._n = 0
          this._peak = 0
        }
      }
    }
    return true
  }
}
registerProcessor('jam-capture', JamCapture)
`

export class JamRecorder {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private id: string | null = null
  private startPerf = 0
  onLevel: (v: number) => void = () => {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone is not available in this context.')
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    const { id } = await window.daw.jam.start(this.ctx.sampleRate)
    this.id = id

    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
    try {
      await this.ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }

    const source = this.ctx.createMediaStreamSource(this.stream)
    const node = new AudioWorkletNode(this.ctx, 'jam-capture')
    node.port.onmessage = (e: MessageEvent) => {
      const { pcm, level } = e.data as { pcm: Int16Array; level: number }
      if (this.id && pcm) window.daw.jam.chunk(this.id, new Uint8Array(pcm.buffer))
      this.onLevel(level)
    }
    // keep the worklet pulling audio without routing the mic to the speakers
    const mute = this.ctx.createGain()
    mute.gain.value = 0
    source.connect(node)
    node.connect(mute)
    mute.connect(this.ctx.destination)

    this.node = node
    this.startPerf = performance.now()
  }

  elapsedMs(): number {
    return this.startPerf ? performance.now() - this.startPerf : 0
  }

  async flag(): Promise<number> {
    const ms = Math.round(this.elapsedMs())
    if (this.id) await window.daw.jam.flag(this.id, ms)
    return ms
  }

  async stop(): Promise<JamMeta | null> {
    const id = this.id
    try {
      this.node?.disconnect()
    } catch {
      // ignore
    }
    try {
      this.stream?.getTracks().forEach((t) => t.stop())
    } catch {
      // ignore
    }
    try {
      await this.ctx?.close()
    } catch {
      // ignore
    }
    this.node = null
    this.stream = null
    this.ctx = null
    this.id = null
    this.startPerf = 0
    return id ? await window.daw.jam.stop(id) : null
  }
}
