import { describe, expect, test } from "bun:test";
import { closeSync, openSync } from "fs";
import { join } from "path";
import { bunEnv, bunExe, fakeNodeRun, isMacOS, isWindows, tempDir } from "../../harness";

// The node REPL boots node:repl, readline and acorn. On a debug build with
// ASAN that takes 4 to 5 seconds, more than the default test timeout.
const replTimeout = 20_000;

describe("fake node cli", () => {
  test("the node cli actually works", () => {
    using temp = tempDir("fake-node", {
      "index.ts": "console.log(Bun.version)",
    });
    expect(fakeNodeRun(temp, join(temp, "index.ts")).stdout).toBe(Bun.version);
  });
  test("doesnt resolve bins", () => {
    using temp = tempDir("fake-node", {
      "vite.js": "console.log('pass')",
      "node_modules/.bin/vite": "#!/usr/bin/sh\necho fail && exit 1",
    });
    expect(fakeNodeRun(temp, "vite").stdout).toBe("pass");
  });
  test("doesnt resolve scripts", () => {
    using temp = tempDir("fake-node", {
      "vite.js": "console.log('pass')",
      "package.json": '{"scripts":{"vite":"echo fail && exit 1"}}',
    });
    expect(fakeNodeRun(temp, "vite").stdout).toBe("pass");
  });
  test("can run a script named run.js", () => {
    using temp = tempDir("fake-node", {
      "run.js": "console.log('pass')",
      "run/index.js": "console.log('fail')",
      "node_modules/run/index.js": "console.log('fail')",
    });
    expect(fakeNodeRun(temp, "run").stdout).toBe("pass");
  });
  // A Windows command line is too short for a path longer than the path buffer.
  test.skipIf(isWindows)("reports module not found for a relative script path longer than PATH_MAX", () => {
    const long = Array(21).fill(Buffer.alloc(200, "a").toString()).join("/") + ".js";
    using temp = tempDir("fake-node-long", {});
    const { exitCode, stdout, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "--bun", "node", long],
      cwd: String(temp),
      env: { ...bunEnv, NODE_ENV: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBe("");
    const path = join(String(temp), long);
    // On macOS the lookup fails in a syscall, so the error is ENAMETOOLONG.
    const expected = isMacOS
      ? `error: ENAMETOOLONG while resolving '${path}' from 'bun:main'`
      : `error: Module not found '${path}'`;
    expect(stderr.toString().split("\n")[0]).toBe(expected);
    expect(exitCode).toBe(1);
  });
  describe("entrypoint file extension picking", () => {
    // Bun supports JSX and TS, and node doesnt, so our behavior here differs a bit
    // Hopefully these priorization rules will not break any node apps.
    test("picks tsx over any other ext", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.jsx": "console.log('fail (build.jsx)')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('fail (build.ts)')",
        "build.cts": "console.log('fail (build.cts)')",
        "build.mts": "console.log('fail (build.mts)')",
        "build.tsx": "console.log('pass')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
    test("picks jsx over ts", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.jsx": "console.log('pass')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('fail (build.ts)')",
        "build.cts": "console.log('fail (build.cts)')",
        "build.mts": "console.log('fail (build.mts)')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
    test("picks mts over ts", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('fail (build.ts)')",
        "build.cts": "console.log('fail (build.cts)')",
        "build.mts": "console.log('pass')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
    test("picks ts over js/cjs/etc", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('pass')",
        "build.cts": "console.log('fail (build.cts)')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
  });

  test("node -e ", () => {
    using temp = tempDir("fake-node", {});
    expect(fakeNodeRun(temp, ["-e", "console.log('pass')"]).stdout).toBe("pass");
  });

  test("process args work", () => {
    using temp = tempDir("fake-node", {
      "index.js": "console.log(JSON.stringify(process.argv.slice(1)))",
    });
    expect(fakeNodeRun(temp, ["index", "a", "b", "c"]).stdout).toBe(
      // note: no extension here is INTENTIONAL
      JSON.stringify([join(temp, "index"), "a", "b", "c"]),
    );
  });

  // Bare `node` matches Node.js: a TTY stdin enters the REPL, a non-TTY
  // stdin (pipe) is the program. fakeNodeRun's default stdin is
  // platform-dependent (Windows may inherit a console), so pin a piped
  // stdin here.
  describe("program on stdin", () => {
    async function nodeWithStdin(stdin: string, args: string[] = [], files: Record<string, string> = {}) {
      using temp = tempDir("fake-node-stdin", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--bun", "node", ...args],
        cwd: String(temp),
        env: { ...bunEnv, NODE_ENV: undefined },
        stdin: Buffer.from(stdin),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    const program =
      'console.log(JSON.stringify({ argv: process.argv.slice(1), file: require("path").basename(__filename) }))';

    test.concurrent("bare node runs the piped program", async () => {
      expect(await nodeWithStdin(program)).toEqual({
        stdout: JSON.stringify({ argv: [], file: "[stdin]" }) + "\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("node - runs the piped program with - in argv", async () => {
      expect(await nodeWithStdin(program, ["-", "a", "b"])).toEqual({
        stdout: JSON.stringify({ argv: ["-", "a", "b"], file: "[stdin]" }) + "\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent.each(["--input-type=module", "--input-type module"])("%s runs an ES module", async flag => {
      const source = 'import { sep } from "node:path"; console.log("ran", typeof sep);';
      expect(await nodeWithStdin(source, flag.split(" "))).toEqual({ stdout: "ran string\n", stderr: "", exitCode: 0 });
    });

    test.concurrent("empty stdin runs an empty program", async () => {
      expect(await nodeWithStdin("")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    });

    test.concurrent("empty stdin still runs a preload", async () => {
      expect(await nodeWithStdin("", ["-r", "./preload.js"], { "preload.js": 'console.log("preloaded")' })).toEqual({
        stdout: "preloaded\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("-e wins over a piped program", async () => {
      expect(await nodeWithStdin('console.log("stdin")', ["-e", 'console.log("eval")'])).toEqual({
        stdout: "eval\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("-e '' runs an empty program", async () => {
      expect(await nodeWithStdin('console.log("stdin")', ["-e", ""])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    });

    test.concurrent("a script positional wins over a piped program", async () => {
      expect(await nodeWithStdin('console.log("stdin")', ["index.js"], { "index.js": 'console.log("file")' })).toEqual({
        stdout: "file\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("-e keeps a script positional in argv", async () => {
      expect(await nodeWithStdin("", ["-e", program, "foo.js", "a"])).toEqual({
        stdout: JSON.stringify({ argv: ["foo.js", "a"], file: "[eval]" }) + "\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent(
      "-i - enters the REPL",
      async () => {
        const { stdout, stderr, exitCode } = await nodeWithStdin("console.log(42)\n", ["-i", "-"]);
        expect(stdout).toContain("Welcome to Bun");
        expect(stdout).toContain("> 42\n");
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      },
      replTimeout,
    );

    test.concurrent("--version prints the node version", async () => {
      const { stdout, stderr, exitCode } = await nodeWithStdin('console.log("stdin")', ["--version"]);
      expect(stdout).toMatch(/^v\d+\.\d+\.\d+\n$/);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    // Node's test runner and syntax check are not replaced by the program on stdin.
    test.concurrent.each([
      ["--test", "--test"],
      ["--check", "--check"],
      ["--check -", "--check"],
      ["-c", "--check"],
    ])("%s with a piped program does not run it", async (args, refused) => {
      const { stdout, stderr, exitCode } = await nodeWithStdin('console.log("stdin")', args.split(" "));
      expect(stdout).toBe("");
      expect(stderr).toContain(`${refused} is not supported when bun runs as node`);
      expect(exitCode).toBe(1);
    });

    // Node exits 0 and runs nothing when stdin cannot be read. Bun reports it.
    test.skipIf(isWindows)("a stdin that cannot be read is an error", async () => {
      using temp = tempDir("fake-node-stdin", {});
      const directory = openSync(String(temp), "r");
      let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
      try {
        proc = Bun.spawn({
          cmd: [bunExe(), "--bun", "node"],
          cwd: String(temp),
          env: { ...bunEnv, NODE_ENV: undefined },
          stdin: directory,
          stdout: "pipe",
          stderr: "pipe",
        });
      } finally {
        closeSync(directory);
      }
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("");
      expect(stderr).toContain("Failed to read the program from stdin");
      expect(exitCode).toBe(1);
    });
  });

  // A terminal on stdin is the REPL, for bare `node` and for `node -`, as in
  // node. Bun.Terminal is POSIX-only.
  describe.skipIf(isWindows)("terminal on stdin", () => {
    async function nodeOnTerminal(
      args: string[],
      fn: (helpers: {
        proc: Bun.Subprocess;
        waitFor: (text: string) => Promise<void>;
        write: (text: string) => void;
        output: () => string;
      }) => Promise<void>,
    ) {
      const received: string[] = [];
      let wake = () => {};
      using home = tempDir("fake-node-tty", {});
      await using terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
        data(_term, data) {
          received.push(Buffer.from(data).toString());
          wake();
        },
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--bun", "node", ...args],
        cwd: String(home),
        env: { ...bunEnv, NODE_ENV: undefined, TERM: "xterm-256color", HOME: String(home), USERPROFILE: String(home) },
        terminal,
      });
      let exitCode: number | null = null;
      proc.exited.then(code => {
        exitCode = code;
        wake();
      });
      const waitFor = async (text: string) => {
        while (!received.join("").includes(text)) {
          if (exitCode !== null)
            throw new Error(`exited with ${exitCode} before ${JSON.stringify(text)}:\n${received.join("")}`);
          await new Promise<void>(resolve => (wake = resolve));
        }
      };
      await fn({ proc, waitFor, write: text => terminal.write(text), output: () => received.join("") });
    }

    test(
      "bare node starts the REPL",
      () =>
        nodeOnTerminal([], async ({ proc, waitFor, write }) => {
          await waitFor("Welcome to Bun");
          await waitFor("> ");
          write("1+1\r");
          await waitFor("\n2");
          write(".exit\r");
          expect(await proc.exited).toBe(0);
        }),
      replTimeout,
    );

    test(
      "node - starts the REPL",
      () =>
        nodeOnTerminal(["-"], async ({ proc, waitFor, write }) => {
          await waitFor("Welcome to Bun");
          await waitFor("> ");
          write(".exit\r");
          expect(await proc.exited).toBe(0);
        }),
      replTimeout,
    );
  });
});
