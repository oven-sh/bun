import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// Run `sh -c <cmd>` inside a fresh PTY session and return the child's output
// as LF-normalized lines. Bun.spawn's inline `terminal:` option creates the
// PTY and runs setsid()+TIOCSCTTY in the child, so the child is always the
// foreground process group of its own controlling terminal. That avoids the
// SIGTTOU stop the no-`script` fallback used to hit under
// `bun test --parallel`, where the worker is a background pgrp.
async function runInPty(shellCmd: string, cwd: string): Promise<{ lines: string[]; exitCode: number }> {
  const chunks: Uint8Array[] = [];
  await using proc = Bun.spawn({
    cmd: ["sh", "-c", shellCmd],
    env: bunEnv,
    cwd,
    terminal: {
      data(_term, data) {
        chunks.push(data.slice());
      },
    },
  });
  const exitCode = await proc.exited;
  const output = Buffer.concat(chunks).toString("utf8");
  const lines = output
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  return { lines, exitCode };
}

// Skip on Windows as it doesn't have /dev/tty
test.skipIf(isWindows)("can reopen /dev/tty after stdin EOF for interactive session", async () => {
  // This test ensures that Bun can reopen /dev/tty after stdin reaches EOF,
  // which is needed for tools like Claude Code that read piped input then
  // switch to interactive mode.
  const testScript = `
    const fs = require('fs');
    const tty = require('tty');

    let inputData = '';
    process.stdin.on('data', (chunk) => {
      inputData += chunk;
    });

    process.stdin.on('end', () => {
      console.log('GOT_INPUT:' + inputData.trim());
      try {
        const fd = fs.openSync('/dev/tty', 'r+');
        console.log('OPENED_TTY:true');

        const ttyStream = new tty.ReadStream(fd);
        console.log('CREATED_STREAM:true');
        console.log('POS:' + ttyStream.pos);
        console.log('START:' + ttyStream.start);

        if (typeof ttyStream.setRawMode === 'function') {
          ttyStream.setRawMode(true);
          console.log('SET_RAW_MODE:true');
          ttyStream.setRawMode(false);
        }

        ttyStream.destroy();
        fs.closeSync(fd);
        console.log('SUCCESS:true');
        process.exit(0);
      } catch (err) {
        console.log('ERROR:' + err.code);
        process.exit(1);
      }
    });

    if (process.stdin.isTTY) {
      console.log('ERROR:NO_PIPED_INPUT');
      process.exit(1);
    }
  `;

  using dir = tempDir("tty-reopen", { "test.js": testScript });
  const scriptPath = join(String(dir), "test.js");

  const { lines, exitCode } = await runInPty(`echo 'test input' | ${bunExe()} ${scriptPath}`, String(dir));

  expect(lines).toEqual([
    "GOT_INPUT:test input",
    "OPENED_TTY:true",
    "CREATED_STREAM:true",
    "POS:undefined",
    "START:undefined",
    "SET_RAW_MODE:true",
    "SUCCESS:true",
  ]);
  expect(exitCode).toBe(0);
});

// Skip on Windows as it doesn't have /dev/tty
test.skipIf(isWindows)("TTY ReadStream should not set position for character devices", async () => {
  // This test ensures that when creating a ReadStream with an fd (like for TTY),
  // the position remains undefined so that fs.read uses read() syscall instead
  // of pread() which would fail with ESPIPE on character devices.
  const testScript = `
    const fs = require('fs');
    const tty = require('tty');

    try {
      const fd = fs.openSync('/dev/tty', 'r+');
      const ttyStream = new tty.ReadStream(fd);

      console.log('POS_TYPE:' + typeof ttyStream.pos);
      console.log('START_TYPE:' + typeof ttyStream.start);

      const originalRead = fs.read;
      let capturedPosition = 'NOT_CALLED';
      let readCalled = false;
      fs.read = function(fd, buffer, offset, length, position, callback) {
        capturedPosition = position;
        readCalled = true;
        process.nextTick(() => callback(null, 0, buffer));
        return originalRead;
      };

      ttyStream.on('data', () => {});
      ttyStream.on('error', () => {});

      console.log('POSITION_PASSED:' + capturedPosition);
      console.log('POSITION_TYPE:' + typeof capturedPosition);
      console.log('READ_CALLED:' + readCalled);

      ttyStream.destroy();
      fs.closeSync(fd);
      process.exit(0);
    } catch (err) {
      console.log('ERROR:' + err.code);
      process.exit(1);
    }
  `;

  using dir = tempDir("tty-position", { "test.js": testScript });
  const scriptPath = join(String(dir), "test.js");

  const { lines, exitCode } = await runInPty(`${bunExe()} ${scriptPath}`, String(dir));

  expect(lines).toEqual([
    "POS_TYPE:undefined",
    "START_TYPE:undefined",
    "POSITION_PASSED:NOT_CALLED",
    "POSITION_TYPE:string",
    "READ_CALLED:false",
  ]);
  expect(exitCode).toBe(0);
});
