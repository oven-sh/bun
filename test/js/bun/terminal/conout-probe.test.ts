// TEMPORARY. This file exists only in the observation pull request and is never merged.
//
// It fails on purpose on Windows, so that CI prints what Node.js and the
// unfixed Bun report for a tty.WriteStream on a console descriptor above 2:
// both spellings of the device name, and a descriptor that is opened for
// reading and writing or write-only.

import { test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExe, tempDir } from "harness";

// The bare name is opened with 'r+' only: a runtime that takes it for a file
// name must not create that file.
const script = String.raw`
  const fs = require('fs');
  const tty = require('tty');
  const probe = (path, flags) => {
    try {
      const fd = fs.openSync(path, flags);
      const isatty = tty.isatty(fd);
      const stream = new tty.WriteStream(fd);
      return [fd > 2, isatty, stream.isTTY, stream.columns, stream.rows, stream.getWindowSize()];
    } catch (e) {
      return e.code || String(e);
    }
  };
  const out = { v: process.versions.bun || process.version };
  out['bare r+'] = probe('CONOUT$', 'r+');
  for (const flags of ['r+', 'w+', 'w']) out['device ' + flags] = probe('\\\\.\\CONOUT$', flags);
  try {
    const size = [0, 0];
    out.stdin = [new (process.binding('tty_wrap').TTY)(0, {}).getWindowSize(size), size];
  } catch (e) {
    out.stdin = e.code || String(e);
  }
  out.stdout = [process.stdout.columns, process.stdout.rows];
  out.stderr = [process.stderr.columns, process.stderr.rows];
  process.stdout.write('PROBE=' + JSON.stringify(out) + ' DONE', () => process.exit(0));
`;

async function run(exe: string, cwd: string): Promise<string> {
  let output = "";
  const decoder = new TextDecoder();
  const finished = Promise.withResolvers<void>();
  const eof = Promise.withResolvers<void>();
  const proc = Bun.spawn({
    cmd: [exe, "-e", script],
    env: bunEnv,
    cwd,
    terminal: {
      // Wide enough that the line does not wrap.
      cols: 500,
      rows: 19,
      data(_t, chunk: Uint8Array) {
        output += decoder.decode(chunk, { stream: true });
        if (output.includes("DONE")) finished.resolve();
      },
      exit() {
        eof.resolve();
      },
    },
  });
  await Promise.race([finished.promise, eof.promise]);
  proc.kill();
  await proc.exited;
  proc.terminal?.close();
  output += decoder.decode();
  return Bun.stripANSI(output).replace(/[\r\n]+/g, "");
}

test.skipIf(!isWindows)(
  "probe: tty.WriteStream on a console descriptor above 2, in Node.js and in Bun",
  async () => {
    using dir = tempDir("conout-probe", {});
    const node = nodeExe();
    const results = {
      node: node ? await run(node, String(dir)) : "no node on this machine",
      bun: await run(bunExe(), String(dir)),
    };
    throw new Error("probe output, not a failure of a change: " + JSON.stringify(results));
  },
  60_000,
);
