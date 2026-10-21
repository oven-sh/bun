import { heapStats } from "bun:jsc";
import { afterAll, expect, it, jest, test } from "bun:test";
import { bunEnv, bunExe, isLinux, normalizeBunSnapshot, tempDir } from "harness";
import fs from "node:fs";
import { join } from "node:path";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});

// Only primitives and wrapped functions cross a ShadowRealm's boundary, so each check runs inside
// the realm and hands back a string.
globalThis.MAIN_REALM_MARKER = "set in the main realm";

const dir = tempDir("shadow-realm", {
  "a.txt": "hello",
  "d/b.txt": "hello",
  "echo-worker.js": "self.onmessage = event => postMessage(event.data);",
});
afterAll(() => dir[Symbol.dispose]());
const file = join(String(dir), "a.txt");

function realmWithNatives() {
  const realm = new ShadowRealm();
  realm.evaluate(`
    globalThis.fs = process.getBuiltinModule("node:fs");
    globalThis.crypto_ = process.getBuiltinModule("node:crypto");
    globalThis.dir = ${JSON.stringify(String(dir))};
    globalThis.file = ${JSON.stringify(file)};
    // The Function behind a value belongs to the realm the value was built in.
    globalThis.realmOf = value => {
      if (Object(value) !== value) return "not an object: " + String(value);
      const F = value.constructor.constructor;
      if (F === Function) return "own realm";
      return F("return typeof MAIN_REALM_MARKER")() === "string" ? "main realm" : "another realm";
    };
    globalThis.settle = (promise, done) =>
      Promise.resolve(promise).then(realmOf).then(done, error => done("rejected: " + error));
    0`);
  return realm;
}

let shared;
const sharedRealm = () => (shared ??= realmWithNatives());

function settledIn(realm, expression) {
  return new Promise(done => realm.evaluate(`done => { settle(${expression}, done); }`)(done));
}

const results = {
  "fs.readFileSync(file)": `fs.readFileSync(file)`,
  "fs.statSync(file)": `fs.statSync(file)`,
  "fs.promises.readFile(file)": `fs.promises.readFile(file)`,
  "fs.promises.stat(file)": `fs.promises.stat(file)`,
  "fs.promises.readdir(dir)": `fs.promises.readdir(dir)`,
  "fs.promises.readdir(dir, { withFileTypes })[0]": `fs.promises.readdir(dir, { withFileTypes: true }).then(entries => entries[0])`,
  "fs.promises.readdir(dir, { recursive })": `fs.promises.readdir(dir, { recursive: true })`,
  "fs.promises.readFile: the ENOENT error": `fs.promises.readFile(dir + "/nope").catch(error => error)`,
  "fs.promises.readFile: the AbortError": `(() => {
    const controller = new AbortController();
    const pending = fs.promises.readFile(file, { signal: controller.signal });
    controller.abort();
    return pending.catch(error => error);
  })()`,
  "fs.stat(file, callback)": `new Promise(resolve => fs.stat(file, (error, stats) => resolve(error || stats)))`,
  "fs.stat(callback): the ENOENT error": `new Promise(resolve => fs.stat(dir + "/nope", error => resolve(error)))`,
  "fs.readFile(file, callback)": `new Promise(resolve => fs.readFile(file, (error, buffer) => resolve(error || buffer)))`,
  "Bun.file(file).stat()": `Bun.file(file).stat()`,
  "Bun.write(path, Bun.file(file)): the promise": `(() => {
    const written = Bun.write(dir + "/copy.txt", Bun.file(file));
    return written.then(() => written.constructor);
  })()`,
  "Bun.write(path, Bun.file(missing)): the error": `Bun.write(dir + "/out", Bun.file(dir + "/nope")).catch(error => error)`,
  "crypto.generateKeyPair callback": `new Promise(resolve => crypto_.generateKeyPair("ed25519", {}, (error, publicKey) => resolve(error || publicKey)))`,
  "crypto.generateKey callback": `new Promise(resolve => crypto_.generateKey("aes", { length: 128 }, (error, key) => resolve(error || key)))`,
  "crypto.hkdf callback": `new Promise(resolve => crypto_.hkdf("sha1", "a", "b", "c", 8, (error, key) => resolve(error || key)))`,
  "crypto.generatePrime callback": `new Promise(resolve => crypto_.generatePrime(32, (error, prime) => resolve(error || prime)))`,
  "crypto.sign callback": `new Promise(resolve => crypto_.sign(null, new Uint8Array(1), crypto_.generateKeyPairSync("ed25519").privateKey, (error, signature) => resolve(error || signature)))`,
  "crypto.pbkdf2 callback": `new Promise(resolve => crypto_.pbkdf2("a", "b", 1, 8, "sha1", (error, key) => resolve(error || key)))`,
  "crypto.scrypt callback": `new Promise(resolve => crypto_.scrypt("a", "b", 8, (error, key) => resolve(error || key)))`,
  "crypto.randomBytes callback": `new Promise(resolve => crypto_.randomBytes(8, (error, bytes) => resolve(error || bytes)))`,
  "crypto.randomFill callback": `new Promise(resolve => crypto_.randomFill(new Uint8Array(8), (error, bytes) => resolve(error || bytes)))`,
  "crypto.argon2 callback": `new Promise(resolve => crypto_.argon2("argon2id", { message: "aaaaaaaa", nonce: "bbbbbbbbbbbbbbbb", parallelism: 1, tagLength: 16, memory: 8, passes: 1 }, (error, key) => resolve(error || key)))`,
  "Bun.password.verify: the error": `Bun.password.verify("a", "not a hash").catch(error => error)`,
  "Bun.zstdCompress()": `Bun.zstdCompress("aaaa")`,
  "Bun.zstdDecompress(): the error": `Bun.zstdDecompress("aaaa").catch(error => error)`,
  "Bun.Archive#bytes()": `new Bun.Archive({ "a.txt": "hi" }).bytes()`,
  "Bun.Archive#files()": `new Bun.Archive({ "a.txt": "hi" }).files()`,
  "Bun.Transpiler#transform(): the error": `new Bun.Transpiler().transform("let x = ;").catch(error => error)`,
  "Bun.Glob#scan(): the error": `Array.fromAsync(new Bun.Glob("*").scan(dir + "/nope")).catch(error => error)`,
  "Bun.Image#bytes(): the error": `new Bun.Image(new Uint8Array([137, 80, 78, 71])).bytes().catch(error => error)`,
  "CompressionStream chunk": `(() => {
    const stream = new CompressionStream("gzip");
    const writer = stream.writable.getWriter();
    writer.write(new Uint8Array(1024 * 1024));
    writer.close();
    return stream.readable.getReader().read().then(result => result.value);
  })()`,
  "Bun.file(file).arrayBuffer()": `Bun.file(file).arrayBuffer()`,
  "crypto.subtle.digest()": `crypto.subtle.digest("SHA-1", new Uint8Array(1))`,
};
// fs.cp is a task of its own, not a job. Its JS half checks the paths first, so only an error of
// the copy itself comes from the task: open() of a directory path fails with EISDIR.
const cpError = `fs.promises.cp(file, dir + "/copy/").then(() => "copied", error => (error.syscall === "open" ? error : error.syscall))`;
if (isLinux) results["fs.promises.cp(file, directory path): the error"] = cpError;

test.each(Object.entries(results))("in a ShadowRealm, %s is an object of that realm", async (_, expression) => {
  expect(await settledIn(sharedRealm(), expression)).toBe("own realm");
});

test("in a ShadowRealm, fs.readFileSync(file) is a Buffer", () => {
  expect(sharedRealm().evaluate(`fs.readFileSync(file) instanceof Buffer`)).toBe(true);
});

// A fetch() that fails for another reason than the timeout is rejected with an error of the realm
// too, so the name is checked first.
const timedOutFetch = args =>
  `fetch(${args}).catch(error => (error.name === "TimeoutError" ? error : "rejected with " + error.name))`;

// The timer of AbortSignal.timeout() is not a job either. It builds the reason in the realm of
// the signal's wrapper, and fetch() rejects with that reason.
test("in a ShadowRealm, the reason of AbortSignal.timeout() is an object of that realm", async () => {
  const reason = `new Promise(resolve => {
    const signal = AbortSignal.timeout(1);
    signal.addEventListener("abort", () => resolve(signal.reason));
  })`;
  expect(await settledIn(sharedRealm(), reason)).toBe("own realm");

  await using server = Bun.serve({ port: 0, fetch: () => new Promise(() => {}) });
  const rejection = timedOutFetch(`${JSON.stringify(server.url.href)}, { signal: AbortSignal.timeout(1) }`);
  expect(await settledIn(sharedRealm(), rejection)).toBe("own realm");
});

// Natives that do not complete through a thread-pool job still hand a ShadowRealm objects of the
// main realm. Observed for both: "main realm".
// The first: a Request holds its signal without the signal's wrapper. Once that wrapper is
// collected, the timer has only the VM's own global.
test.todo(
  "in a ShadowRealm, the reason of an AbortSignal.timeout() that only a Request holds is an object of that realm",
  async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Promise(() => {}) });
    jest.useFakeTimers();
    try {
      const request = `new Request(${JSON.stringify(server.url.href)}, { signal: AbortSignal.timeout(60_000) })`;
      sharedRealm().evaluate(`globalThis.request = ${request}; 0`);
      Bun.gc(true);
      const rejection = settledIn(sharedRealm(), timedOutFetch("request"));
      jest.advanceTimersByTime(60_000);
      expect(await rejection).toBe("own realm");
    } finally {
      jest.useRealTimers();
    }
  },
);
test.todo("in a ShadowRealm, the message event of a Worker is an object of that realm", async () => {
  const message = `new Promise(resolve => {
    const worker = new Worker(dir + "/echo-worker.js");
    worker.onmessage = event => {
      worker.terminate();
      resolve(event);
    };
    worker.postMessage(1);
  })`;
  expect(await settledIn(sharedRealm(), message)).toBe("own realm");
});

// A job of a realm looks its realm up by job. A lookup that answers with another live realm fails
// here, and so does a job of the main realm that completes in a realm.
test("jobs of two ShadowRealms and of the main realm complete in the realm that scheduled them", async () => {
  const realms = [sharedRealm(), realmWithNatives()];
  const before = heapStats().protectedGlobalObjectCount;

  const pending = [];
  for (let i = 0; i < 8; i++) {
    for (const realm of realms) pending.push(settledIn(realm, `fs.promises.stat(file)`));
    pending.push(fs.promises.stat(file).then(stats => (stats instanceof fs.Stats ? "main realm" : "not main realm")));
  }
  // A realm stays GC-protected while a job of it is in flight.
  expect(heapStats().protectedGlobalObjectCount).toBe(before + realms.length);

  expect(await Promise.all(pending)).toEqual(
    Array.from({ length: 8 }, () => ["own realm", "own realm", "main realm"]).flat(),
  );
  expect(heapStats().protectedGlobalObjectCount).toBe(before);
});

// The sync fs binding and the fs.cp task hold the global of their realm without a job. The main
// realm collects the heap twice: while the first job is in flight, and while the copy is pending
// with the realm's own code off the stack.
test("a ShadowRealm that nothing references reads and copies files while the heap is collected", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const collected = Promise.withResolvers();
  // Returns nothing: an Immediate cannot cross into the realm.
  const collectSoon = () => void setImmediate(() => collected.resolve(Bun.gc(true)));
  (() => {
    realmWithNatives().evaluate(`(done, collectSoon) => {
      fs.promises
        .stat(file)
        .then(stats => {
          let buffers = 0;
          for (let i = 0; i < 100; i++) if (fs.readFileSync(file) instanceof Buffer) buffers++;
          // As in the table above: an error of the copy itself, on Linux.
          const copied = ${isLinux} ? ${cpError}.then(realmOf) : "own realm";
          collectSoon();
          return Promise.resolve(copied).then(copy => done([realmOf(stats), buffers, copy].join(", ")));
        })
        .catch(error => done("rejected: " + error));
    }`)(resolve, collectSoon);
  })();
  Bun.gc(true);
  expect(await promise).toBe("own realm, 100, own realm");
  await collected.promise;
});

// An fs callback is called through the global its job completes in. Through the VM's own global
// the store of the realm's AsyncLocalStorage is not restored: getStore() answers undefined.
test("an fs callback in a ShadowRealm sees the AsyncLocalStorage store of its caller", async () => {
  const storeIn = call =>
    new Promise(done =>
      sharedRealm().evaluate(`done => {
        const { AsyncLocalStorage } = process.getBuiltinModule("node:async_hooks");
        const storage = new AsyncLocalStorage();
        storage.run("the store", () => ${call}(file, () => done(String(storage.getStore()))));
      }`)(done),
    );
  expect({ stat: await storeIn("fs.stat"), readFile: await storeIn("fs.readFile") }).toEqual({
    stat: "the store",
    readFile: "the store",
  });
});

// A node:crypto callback is called through the VM's own global whichever realm its job completes
// in (JsThread::run_callback). Called through the realm's global, a throw goes to the realm's own
// `process`, which has no listener: the main realm hears nothing and the exit code is 1.
test.concurrent(
  "a throw in a ShadowRealm's node:crypto callback reaches the main realm's uncaughtException listeners",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
      const heard = [];
      process.on("uncaughtException", error => heard.push(error.message));
      process.on("exit", () => console.log(heard.sort().join("\\n")));
      new ShadowRealm().evaluate(\`
        const crypto = process.getBuiltinModule("node:crypto");
        const thrower = name => () => {
          throw new Error(name);
        };
        crypto.pbkdf2("a", "b", 1, 8, "sha1", thrower("pbkdf2"));
        crypto.scrypt("a", "b", 8, thrower("scrypt"));
        crypto.randomFill(new Uint8Array(8), thrower("randomFill"));
        crypto.hkdf("sha1", "a", "b", "c", 8, thrower("hkdf"));
        crypto.argon2("argon2id", { message: "aaaaaaaa", nonce: "bbbbbbbbbbbbbbbb", parallelism: 1, tagLength: 16, memory: 8, passes: 1 }, thrower("argon2"));
        0\`);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "argon2\nhkdf\npbkdf2\nrandomFill\nscrypt\n", stderr: "" });
    expect(exitCode).toBe(0);
  },
);

// A job that ends without its completion gives up the protection of its realm too. Here
// dispose() stops the graph's context, so the loop releases the jobs without running them.
test.concurrent("a disposed Bun.ModuleGraph does not leave the ShadowRealm of its jobs protected", async () => {
  using fixtures = tempDir("shadow-realm-graph", {
    "realm-jobs-of-a-disposed-graph.mjs": `
      import { heapStats } from "bun:jsc";
      const baseline = heapStats().protectedGlobalObjectCount;
      const graph = new Bun.ModuleGraph();
      graph.run(() => {
        new ShadowRealm().evaluate(\`
          const crypto = process.getBuiltinModule("node:crypto");
          for (let i = 0; i < 20; i++) crypto.randomBytes(8, () => {});
          0\`);
      });
      const inFlight = heapStats().protectedGlobalObjectCount - baseline;
      graph.dispose();
      let kept = inFlight;
      while (kept !== 0) {
        await new Promise(resolve => setImmediate(resolve));
        kept = heapStats().protectedGlobalObjectCount - baseline;
      }
      console.log(JSON.stringify({ inFlight, kept }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "realm-jobs-of-a-disposed-graph.mjs"],
    env: bunEnv,
    cwd: String(fixtures),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: `{"inFlight":1,"kept":0}\n`, stderr: "" });
  expect(exitCode).toBe(0);
});

// The same for a job that `bun test --isolate` fences off: the file that scheduled it has
// finished, so the job is released when it lands in the next file.
test.concurrent("bun test --isolate does not leave the ShadowRealm of a finished file's job protected", async () => {
  using fixtures = tempDir("shadow-realm-isolate", {
    "a-realm.test.ts": `
      import { heapStats } from "bun:jsc";
      import { test, expect } from "bun:test";
      import { existsSync, writeFileSync } from "node:fs";
      import { join } from "node:path";

      const dir = import.meta.dir;

      test("leaks a thread-pool chain of a ShadowRealm", () => {
        const baseline = heapStats().protectedGlobalObjectCount;
        writeFileSync(join(dir, "protected-globals"), String(baseline));
        // Each turn hops through the thread pool, so a job of the realm is in flight at the swap.
        new ShadowRealm().evaluate(\`
          const { existsSync } = process.getBuiltinModule("node:fs");
          (async () => {
            while (!existsSync(\${JSON.stringify(join(dir, "b-running"))})) {
              await Bun.password.hash("pw", { algorithm: "bcrypt", cost: 4 });
            }
          })();
          0\`);
        expect(heapStats().protectedGlobalObjectCount).toBe(baseline + 1);
        expect(existsSync(join(dir, "b-running"))).toBe(false);
      });
    `,
    "b-realm.test.ts": `
      import { heapStats } from "bun:jsc";
      import { test, expect } from "bun:test";
      import { readFileSync, writeFileSync } from "node:fs";
      import { join } from "node:path";

      const dir = import.meta.dir;

      test("A's realm is not protected once its job has landed", async () => {
        writeFileSync(join(dir, "b-running"), "");
        const expected = Number(readFileSync(join(dir, "protected-globals"), "utf8"));
        // Round-trip the thread pool so A's pending job lands here.
        let protectedGlobals = heapStats().protectedGlobalObjectCount;
        while (protectedGlobals !== expected) {
          await Bun.password.hash("pw", { algorithm: "bcrypt", cost: 4 });
          protectedGlobals = heapStats().protectedGlobalObjectCount;
        }
        expect(protectedGlobals).toBe(expected);
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "./a-realm.test.ts", "./b-realm.test.ts"],
    env: bunEnv,
    cwd: String(fixtures),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(normalizeBunSnapshot(stderr, fixtures)).toContain("2 pass");
  expect(normalizeBunSnapshot(stderr, fixtures)).toContain("0 fail");
  expect(exitCode).toBe(0);
});
