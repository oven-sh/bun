import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { Console } from "node:console";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";

function writable() {
  let intoString = "";
  const { promise, resolve } = Promise.withResolvers();
  const stream = new Writable({
    write(chunk) {
      intoString += chunk.toString();
    },
    destroy() {
      resolve(intoString);
    },
    autoDestroy: true,
  });

  (stream as any).write = (chunk: any) => {
    intoString += Buffer.from(chunk).toString("utf-8");
  };

  return [stream, () => promise] as const;
}

describe("console.Console", () => {
  test("global instanceof Console", () => {
    expect(global.console).toBeInstanceOf(Console);
  });

  test("new Console instanceof Console", () => {
    const c = new Console({ stdout: process.stdout, stderr: process.stderr });
    expect(c).toBeInstanceOf(Console);
  });

  test("it can write to a stream", async () => {
    console.log();
    const [stream, value] = writable();
    const c = new Console({ stdout: stream, stderr: stream, colorMode: false });
    c.log("hello");
    c.log({ foo: "bar" });
    stream.end();
    expect(await value()).toBe("hello\n{ foo: 'bar' }\n");
  });

  test("can enable colors", async () => {
    const [stream, value] = writable();
    const c = new Console({ stdout: stream, stderr: stream, colorMode: true });
    c.log("hello");
    c.log({ foo: "bar" });
    stream.end();
    expect(await value()).toBe("hello\n{ foo: \u001B[32m'bar'\u001B[39m }\n");
  });

  test("stderr and stdout are separate", async () => {
    const [out, outValue] = writable();
    const [err, errValue] = writable();
    const c = new Console({ stdout: out, stderr: err });
    c.log("hello world!");
    c.error("uh oh!");
    out.end();
    err.end();
    expect(await outValue()).toBe("hello world!\n");
    expect(await errValue()).toBe("uh oh!\n");
  });
});

// The global console has Node's kBindStreamsLazy get/set pair. Only a read of `console._stdout` / `console._stderr`
// builds process.stdout / process.stderr. A Console instance has data properties (kBindStreamsEager).
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/console/constructor.js#L195-L236
describe("console._stdout and console._stderr", () => {
  const accessorKeys = "get,set,enumerable,configurable";

  test.each(["_stdout", "_stderr"] as const)("global console.%s is a get/set accessor", key => {
    const descriptor = Object.getOwnPropertyDescriptor(console, key)!;
    expect(descriptor).toEqual({
      get: expect.any(Function),
      set: expect.any(Function),
      enumerable: false,
      configurable: true,
    });
    expect([descriptor.get!.name, descriptor.get!.length, descriptor.set!.name, descriptor.set!.length]).toEqual([
      "get",
      0,
      "set",
      1,
    ]);
    // @ts-ignore
    expect(console[key]).toBe(key === "_stdout" ? process.stdout : process.stderr);
    // The read leaves the accessor in place.
    expect(Object.getOwnPropertyDescriptor(console, key)!.get).toBe(descriptor.get);
    // @ts-ignore
    expect(console.__lookupGetter__(key)).toBe(descriptor.get);
  });

  test("a Console instance has data properties", () => {
    const [out] = writable();
    const [err] = writable();
    const instance = new Console(out, err);
    expect(Object.getOwnPropertyDescriptor(instance, "_stdout")).toEqual({
      value: out,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    expect(Object.getOwnPropertyDescriptor(instance, "_stderr")).toEqual({
      value: err,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  });

  test("the console of a Worker has the accessors", async () => {
    const url = URL.createObjectURL(
      new Blob([`postMessage(Object.keys(Object.getOwnPropertyDescriptor(console, "_stdout")).join());`]),
    );
    const worker = new Worker(url);
    try {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      worker.onmessage = event => resolve(event.data);
      worker.onerror = event => reject(new Error(event.message));
      expect(await promise).toBe(accessorKeys);
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  });

  // Runs `body` in a fresh bun process and returns the JSON of what it assigns to `result`. `reads` counts the reads
  // of process.stdout and process.stderr: a read is what builds the stream. The assignment comes first: it replaces
  // the lazy property, and a definition alone builds the real stream first.
  async function run(body: string) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const reads = { stdout: 0, stderr: 0 };
         const streams = { stdout: { write() {} }, stderr: { write() {} } };
         for (const name of ["stdout", "stderr"]) {
           process[name] = undefined;
           Object.defineProperty(process, name, { configurable: true, get: () => (reads[name]++, streams[name]) });
         }
         const kind = key => Object.keys(Object.getOwnPropertyDescriptor(console, key) ?? {}).join();
         // Runs each operation and returns the names of those that read a stream.
         const readers = operations =>
           Object.keys(operations).filter(name => {
             reads.stdout = reads.stderr = 0;
             operations[name]();
             return reads.stdout + reads.stderr > 0;
           });
         let result;
         ${body}
         require("node:fs").writeSync(1, JSON.stringify(result));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // Not concurrent: a debug build starts slowly when many processes start at once, and a single test then comes
  // close to the default timeout.
  describe("in a fresh process", () => {
    test("a descriptor operation on the property does not read process.stdout or process.stderr", async () => {
      const { stdout, stderr, exitCode } = await run(`
        const described = readers({
          "Object.getOwnPropertyDescriptor": () => [Object.getOwnPropertyDescriptor(console, "_stdout"), Object.getOwnPropertyDescriptor(console, "_stderr")],
          "Reflect.getOwnPropertyDescriptor": () => Reflect.getOwnPropertyDescriptor(console, "_stdout"),
          "Object.getOwnPropertyDescriptors": () => Object.getOwnPropertyDescriptors(console),
          "propertyIsEnumerable": () => [console.propertyIsEnumerable("_stdout"), console.propertyIsEnumerable("_stderr")],
          "a descriptor through a Proxy": () => Object.getOwnPropertyDescriptor(new Proxy(console, {}), "_stderr"),
          "Object.defineProperty with {}": () => Object.defineProperty(console, "_stdout", {}),
          "Object.seal": () => Object.seal(console),
          "Object.freeze": () => Object.freeze(console),
        });
        // A frozen console keeps the accessors, so an assignment still goes through the setter.
        console._stdout = streams.stderr;
        result = { described, kinds: [kind("_stdout"), kind("_stderr")], assigned: console._stdout === streams.stderr };
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ described: [], kinds: [accessorKeys, accessorKeys], assigned: true });
      expect(exitCode).toBe(0);
    });

    test("a print of console does not read process.stdout or process.stderr", async () => {
      const { stdout, stderr, exitCode } = await run(`
        const util = require("node:util");
        const printed = readers({
          "util.inspect with showHidden": () => util.inspect(console, { showHidden: true }),
          "util.format with %o": () => util.format("%o", console),
          "Bun.inspect": () => [Bun.inspect(console), Bun.inspect(console, { sorted: true })],
          "Bun.inspect of a holder": () => [Bun.inspect({ console }), Bun.inspect([console])],
          "Bun.inspect of an heir": () => Bun.inspect(Object.create(console)),
        });
        result = { printed, kinds: [kind("_stdout"), kind("_stderr")] };
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ printed: [], kinds: [accessorKeys, accessorKeys] });
      expect(exitCode).toBe(0);
    });

    test("the first read takes process.stdout / process.stderr and keeps it", async () => {
      const { stdout, stderr, exitCode } = await run(`
        const first = [console._stdout === streams.stdout, console._stdout === streams.stdout, { ...reads }];
        // A first read that throws keeps nothing. The next read tries again.
        let failures = 1;
        Object.defineProperty(process, "stderr", {
          configurable: true,
          get() {
            reads.stderr++;
            if (failures-- > 0) throw new Error("not yet");
            return streams.stderr;
          },
        });
        let thrown;
        try {
          console._stderr;
        } catch (error) {
          thrown = error.message;
        }
        const retried = console._stderr === streams.stderr;
        // A process.stdout that changes after the first read does not change the console.
        Object.defineProperty(process, "stdout", { value: "replaced" });
        result = { first, thrown, retried, kept: console._stdout === streams.stdout, kinds: [kind("_stdout"), kind("_stderr")], reads };
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        first: [true, true, { stdout: 1, stderr: 0 }],
        thrown: "not yet",
        retried: true,
        kept: true,
        kinds: [accessorKeys, accessorKeys],
        reads: { stdout: 1, stderr: 2 },
      });
      expect(exitCode).toBe(0);
    });

    test("an assignment goes through the setter, for any receiver", async () => {
      const { stdout, stderr, exitCode } = await run(`
        const a = {}, b = {};
        const { get, set } = Object.getOwnPropertyDescriptor(console, "_stdout");
        console._stdout = a;
        const assigned = [console._stdout === a, kind("_stdout"), { ...reads }];
        // A falsy value makes the getter take process.stdout again.
        console._stdout = 0;
        const falsy = [console._stdout === streams.stdout, { ...reads }];
        // The functions ignore their receiver.
        set.call({}, b);
        const heir = Object.create(console);
        heir._stderr = a;
        result = {
          assigned,
          falsy,
          foreign: [console._stdout === b, get.call(undefined) === b],
          heir: [console._stderr === a, Object.hasOwn(heir, "_stderr")],
          reads,
        };
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        assigned: [true, accessorKeys, { stdout: 0, stderr: 0 }],
        falsy: [true, { stdout: 1, stderr: 0 }],
        foreign: [true, true],
        heir: [true, false],
        reads: { stdout: 1, stderr: 0 },
      });
      expect(exitCode).toBe(0);
    });

    test("a new definition or a delete does not read the stream", async () => {
      const { stdout, stderr, exitCode } = await run(`
        Object.defineProperty(console, "_stdout", { value: 9 });
        result = {
          defined: Object.getOwnPropertyDescriptor(console, "_stdout"),
          deleted: [delete console._stderr, "_stderr" in console],
          reads,
        };
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        defined: { value: 9, writable: false, enumerable: false, configurable: true },
        deleted: [true, false],
        reads: { stdout: 0, stderr: 0 },
      });
      expect(exitCode).toBe(0);
    });

    test("an ES module import of a CommonJS module that exports console does not read the streams", async () => {
      using dir = tempDir("console-cjs-export", { "console.cjs": "module.exports = console;" });
      const { stdout, stderr, exitCode } = await run(`
        const namespace = await import(${JSON.stringify(pathToFileURL(join(String(dir), "console.cjs")).href)});
        result = { log: namespace.log === console.log, default: namespace.default === console, reads };
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ log: true, default: true, reads: { stdout: 0, stderr: 0 } });
      expect(exitCode).toBe(0);
    });

    test("the console of a ShadowRealm binds the streams of that realm", async () => {
      const { stdout, stderr, exitCode } = await run(`
        const realm = new ShadowRealm();
        // The last value of an evaluate() call must be a primitive.
        realm.evaluate('globalThis.own = { write() {} }; process.stdout = own; 0');
        const realmKind = realm.evaluate('Object.keys(Object.getOwnPropertyDescriptor(console, "_stdout")).join()');
        const read = realm.evaluate("console._stdout === own");
        // An assignment in one realm does not reach the console of the other.
        realm.evaluate('console._stderr = "realm"');
        const mainAfterRealm = console._stderr === streams.stderr;
        console._stdout = "main";
        result = { realmKind, read, mainAfterRealm, realmAfterMain: realm.evaluate("console._stdout === own"), reads };
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        realmKind: accessorKeys,
        read: true,
        mainAfterRealm: true,
        realmAfterMain: true,
        reads: { stdout: 0, stderr: 1 },
      });
      expect(exitCode).toBe(0);
    });

    test("the console keeps an assigned or a bound stream alive", async () => {
      const { stdout, stderr, exitCode } = await run(`
        // Each read of process.stderr gives a new object, so only the console holds the one that a read bound.
        Object.defineProperty(process, "stderr", { configurable: true, get: () => ({ bound: true }) });
        function bind(marker) {
          console._stdout = { marker };
          console._stderr = undefined;
          return [new WeakRef(console._stdout), new WeakRef(console._stderr)];
        }
        const lost = [];
        for (let marker = 1; marker <= 2000; marker++) {
          const refs = bind(marker);
          if (marker % 500 !== 0) continue;
          // A WeakRef keeps its target until the job that made it ends.
          await new Promise(resolve => setImmediate(resolve));
          Bun.gc(true);
          const [out, err] = refs.map(ref => ref.deref());
          if (out?.marker !== marker || err?.bound !== true || console._stdout !== out || console._stderr !== err)
            lost.push(marker);
        }
        result = { lost };
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ lost: [] });
      expect(exitCode).toBe(0);
    });

    // process.stdout and process.stderr put O_NONBLOCK on a pipe when they are built, and the flag stays on the pipe.
    describe.skipIf(!isPosix)("with fd 1 and fd 2 on pipes", () => {
      // Prints "<fd>:blocking" or "<fd>:nonblocking" for each fd number in argv.
      const probe = join(import.meta.dir, "..", "..", "bun", "spawn", "fixtures", "fd-nonblock-probe.js");

      async function flagsAfter(source: string) {
        await using proc = Bun.spawn({
          // `bun -e` puts no script path in argv, and the probe takes the fd numbers from argv[2] on.
          cmd: [bunExe(), "-e", `${source}\nawait import(${JSON.stringify(probe)});`, "probe", "1", "2"],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { flags: stdout.trimEnd().split("\n").at(-1), stderr, exitCode };
      }

      test("a descriptor read or a print of console leaves both blocking", async () => {
        expect(
          await flagsAfter(`
            Object.getOwnPropertyDescriptor(console, "_stdout");
            Object.getOwnPropertyDescriptors(console);
            console.propertyIsEnumerable("_stderr");
            require("node:util").inspect(console, { showHidden: true });
            console.log(console);
            Object.freeze(console);
          `),
        ).toEqual({ flags: "1:blocking 2:blocking", stderr: "", exitCode: 0 });
      });

      test("a read of the property builds that stream only", async () => {
        // The comparison is with a read of process.stderr itself, so that the test does not pin what a build of the
        // stream does to fd 2.
        const [viaConsole, direct] = await Promise.all([flagsAfter(`console._stderr;`), flagsAfter(`process.stderr;`)]);
        expect(direct).toEqual({
          flags: expect.stringMatching(/^1:blocking 2:(non)?blocking$/),
          stderr: "",
          exitCode: 0,
        });
        expect(viaConsole).toEqual(direct);
      });
    });
  });
});
