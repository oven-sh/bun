import { expect, test } from "bun:test";
import { bunEnv } from "harness";

const exe = process.env.PTY_EXE!;

async function runInPty(
  script: string,
  phases: ((terminal: Bun.Terminal, output: () => string) => void | Promise<void>)[],
  opts: { markers: string[] },
) {
  const decoder = new TextDecoder();
  let buffer = "";
  const waiters: { marker: string; resolve: () => void }[] = [];
  await using terminal = new Bun.Terminal({
    data(_terminal, chunk: Uint8Array) {
      buffer += decoder.decode(chunk, { stream: true });
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (buffer.includes(waiters[i].marker)) {
          waiters[i].resolve();
          waiters.splice(i, 1);
        }
      }
    },
  });
  const proc = Bun.spawn({ cmd: [exe, "-e", script], env: bunEnv, terminal });
  const exitedEarly = proc.exited.then(code => {
    throw new Error(`child exited early with code ${code}; terminal output: ${JSON.stringify(buffer)}`);
  });
  exitedEarly.catch(() => {});
  const phase = (marker: string) => {
    const seen = buffer.includes(marker)
      ? Promise.resolve()
      : new Promise<void>(resolve => waiters.push({ marker, resolve }));
    return Promise.race([seen, exitedEarly]);
  };
  for (let i = 0; i < phases.length; i++) {
    await phase(opts.markers[i]);
    await phases[i](terminal, () => buffer);
  }
  const timeout = new Promise<number>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT; output=" + JSON.stringify(buffer))), 8000));
  const code = await Promise.race([proc.exited, timeout]).catch(e => { proc.kill(); throw e; });
  return { code, output: () => buffer };
}

test("HEAD shape of #29126 test", async () => {
  const { code, output } = await runInPty(
    `
        const { spawn } = require("node:child_process");
        const s = process.stdin;
        s.setRawMode(true);
        const seen = [];
        const handler = () => {
          let c;
          while ((c = s.read()) !== null) seen.push(c.toString());
        };
        s.on("readable", handler);
        process.stdout.write("P1\\n");
        s.once("readable", () => setTimeout(() => {
          s.setRawMode(false);
          s.removeListener("readable", handler);
          s.unref();
          process.stdout.write("P2 reading=" + (s._handle && s._handle.reading) + "\\n");
          const child = spawn("cat", [], { stdio: "inherit" });
          child.on("exit", exitCode => {
            process.stdout.write("RESULT " + JSON.stringify({ parentSaw: seen, childExit: exitCode, reading: s._handle && s._handle.reading }) + "\\n");
            process.exit(0);
          });
        }, 50));
      `,
    [
      terminal => {
        terminal.write("a");
      },
      async terminal => {
        await new Promise(r => setTimeout(r, 200));
        terminal.write("hello from cat\n");
        await new Promise(r => setTimeout(r, 200));
        terminal.write("\x04");
      },
    ],
    { markers: ["P1", "P2"] },
  );
  const text = Bun.stripANSI(output());
  console.log("OUTPUT:", JSON.stringify(text));
  expect(code).toBe(0);
  const match = text.match(/RESULT (\{.*\})/);
  expect(JSON.parse(match![1])).toMatchObject({ parentSaw: ["a"], childExit: 0 });
  expect(text.split("hello from cat").length - 1).toBe(2);
});
