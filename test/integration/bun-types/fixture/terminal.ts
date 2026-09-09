// Fixture: Bun.Terminal pause/resume backpressure API (issue #41410).
const terminal = new Bun.Terminal({
  cols: 80,
  rows: 24,
  data(term, data) {
    const bytes: Uint8Array<ArrayBuffer> = data;
    term.pause();
    console.log(bytes.byteLength);
  },
  exit(term, exitCode, signal) {
    const code: number = exitCode;
    const sig: string | null = signal;
    console.log(code, sig, term.closed);
  },
  drain(term) {
    term.resume();
  },
});

const terminalPaused: boolean = terminal.paused;
const terminalClosed: boolean = terminal.closed;
terminal.pause();
terminal.resume();
terminal.write("echo hi\n");
terminal.resize(120, 40);
terminal.setRawMode(true);
terminal.ref();
terminal.unref();
terminal.close();
