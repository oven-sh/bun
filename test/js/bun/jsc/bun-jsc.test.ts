import {
  callerSourceOrigin,
  describeArray,
  deserialize,
  drainMicrotasks,
  edenGC,
  fullGC,
  gcAndSweep,
  getProtectedObjects,
  getRandomSeed,
  heapSize,
  heapStats,
  isRope,
  describe as jscDescribe,
  memoryUsage,
  numberOfDFGCompiles,
  optimizeNextInvocation,
  profile,
  releaseWeakRefs,
  reoptimizationRetryCount,
  serialize,
  setRandomSeed,
  setTimeZone,
  totalCompileTime,
} from "bun:jsc";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isBuildKite, isDebug, isWindows } from "harness";
import path from "node:path";

describe("bun:jsc", () => {
  function count() {
    var j = 0;
    for (var i = 0; i < 999999; i++) {
      j += i + 2;
    }

    return j;
  }

  it("describe", () => {
    expect(jscDescribe([])).toBeDefined();
  });
  it("describeArray", () => {
    expect(describeArray([1, 2, 3])).toBeDefined();
  });
  it("gcAndSweep", () => {
    expect(gcAndSweep()).toBeGreaterThan(0);
  });
  it("fullGC", () => {
    expect(fullGC()).toBeGreaterThan(0);
  });
  it("edenGC", () => {
    expect(edenGC()).toBeGreaterThan(0);
  });
  it("heapSize", () => {
    expect(heapSize()).toBeGreaterThan(0);
  });
  it("heapStats", () => {
    const stats = heapStats();
    expect(stats.heapCapacity).toBeGreaterThan(0);
    expect(stats.heapSize).toBeGreaterThan(0);
    expect(stats.objectCount).toBeGreaterThan(0);
  });
  it("memoryUsage", () => {
    const usage = memoryUsage();
    expect(usage.current).toBeGreaterThan(0);
    expect(usage.peak).toBeGreaterThan(0);
  });
  it("getRandomSeed", () => {
    expect(getRandomSeed()).toBeDefined();
  });
  it("setRandomSeed", () => {
    expect(setRandomSeed(2)).toBeUndefined();
  });
  it("isRope", () => {
    // https://twitter.com/bunjavascript/status/1806921203644571685
    let y;
    y = 123;
    expect(isRope("a" + y + "b")).toBe(true);
    expect(isRope("abcdefgh")).toBe(false);
  });
  it("callerSourceOrigin", () => {
    expect(callerSourceOrigin()).toBe(import.meta.url);
  });
  it("noFTL", () => {});
  it("noOSRExitFuzzing", () => {});
  it("optimizeNextInvocation", () => {
    count();
    expect(optimizeNextInvocation(count)).toBeUndefined();
    count();
  });
  it("numberOfDFGCompiles", async () => {
    await Bun.sleep(5); // this failed once and i suspect it is because the query was done too fast
    expect(numberOfDFGCompiles(count)).toBeGreaterThanOrEqual(0);
  });
  it("releaseWeakRefs", () => {
    expect(releaseWeakRefs()).toBeUndefined();
  });
  it("totalCompileTime", () => {
    expect(totalCompileTime(count)).toBeGreaterThanOrEqual(0);
  });
  it("reoptimizationRetryCount", () => {
    expect(reoptimizationRetryCount(count)).toBeGreaterThanOrEqual(0);
  });
  it("drainMicrotasks", () => {
    expect(drainMicrotasks()).toBeUndefined();
  });
  it("startRemoteDebugger", () => {
    // try {
    //   startRemoteDebugger("");
    // } catch (e) {
    //   if (process.platform !== "darwin") {
    //     throw e;
    //   }
    // }
  });
  it("getProtectedObjects", () => {
    expect(getProtectedObjects().length).toBeGreaterThan(0);
  });

  it("setTimeZone", () => {
    var origTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const realOrigTimezone = origTimezone;
    if (origTimezone === "America/Anchorage") {
      origTimezone = "America/New_York";
    }
    const origDate = new Date();
    origDate.setSeconds(0);
    origDate.setMilliseconds(0);
    origDate.setMinutes(0);
    const origDateString = origDate.toString();
    expect(origTimezone).toBeDefined();
    expect(origTimezone).not.toBe("America/Anchorage");
    expect(setTimeZone("America/Anchorage")).toBe("America/Anchorage");
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Anchorage");
    if (realOrigTimezone === origTimezone) {
      const newDate = new Date();
      newDate.setSeconds(0);
      newDate.setMilliseconds(0);
      newDate.setMinutes(0);
      const newDateString = newDate.toString();
      expect(newDateString).not.toBe(origDateString);
    }

    setTimeZone(realOrigTimezone);

    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(origTimezone);
  });

  it("serialize", () => {
    const serialized = serialize({ a: 1 });
    expect(serialized).toBeInstanceOf(SharedArrayBuffer);
    expect(deserialize(serialized)).toStrictEqual({ a: 1 });
    const nested = serialize(serialized);
    expect(deserialize(deserialize(nested))).toStrictEqual({ a: 1 });
  });

  it("serialize (binaryType: 'nodebuffer')", () => {
    const serialized = serialize({ a: 1 }, { binaryType: "nodebuffer" });
    expect(serialized).toBeInstanceOf(Buffer);
    expect(serialized.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(deserialize(serialized)).toStrictEqual({ a: 1 });
    const nested = serialize(serialized);
    expect(deserialize(deserialize(nested))).toStrictEqual({ a: 1 });
  });

  it("serialize GC test", () => {
    for (let i = 0; i < 1000; i++) {
      serialize({ a: 1 });
    }
    Bun.gc(true);
  });

  it.todoIf(isBuildKite && isWindows)("profile async", async () => {
    const { promise, resolve } = Promise.withResolvers();
    const result = await profile(
      async function hey(arg1: number) {
        await Bun.sleep(10).then(() => resolve(arguments));
        return arg1;
      },
      1,
      2,
    );
    const input = await promise;
    expect({ ...input }).toStrictEqual({ "0": 2 });
  });

  it.todoIf(isBuildKite && isWindows)("profile can be called multiple times", () => {
    // Fibonacci generates deep stacks and is CPU-intensive
    function fib(n: number): number {
      if (n <= 1) return n;
      return fib(n - 1) + fib(n - 2);
    }

    // After the JIT warms up fib() can finish within the default 1ms sample
    // interval, yielding zero traces. Use a short interval so every call is
    // sampled regardless of how fast the optimized code runs.
    const sampleInterval = 50;

    // fib(26) keeps each call long enough (~400k recursive calls) to collect
    // samples at a 50us interval while staying within the per-test timeout on
    // slow debug builds; fib(30) takes >4s per call there.
    // First profile call
    const result1 = profile(() => fib(26), sampleInterval);
    expect(result1).toBeDefined();
    expect(result1.functions).toBeDefined();
    expect(result1.stackTraces).toBeDefined();
    expect(result1.stackTraces.traces.length).toBeGreaterThan(0);

    // Second profile call - should work after first one completed
    // This verifies that shutdown() -> pause() fix works
    const result2 = profile(() => fib(26), sampleInterval);
    expect(result2).toBeDefined();
    expect(result2.functions).toBeDefined();
    expect(result2.stackTraces).toBeDefined();
    expect(result2.stackTraces.traces.length).toBeGreaterThan(0);

    // Third profile call - verify profiler can be reused multiple times
    const result3 = profile(() => fib(26), sampleInterval);
    expect(result3).toBeDefined();
    expect(result3.functions).toBeDefined();
    expect(result3.stackTraces).toBeDefined();
    expect(result3.stackTraces.traces.length).toBeGreaterThan(0);
  });
});

it("deserialize rejects an object reference index outside the deserialized object pool", async () => {
  // A payload whose first value is ObjectReferenceTag must have its pool index
  // validated against the number of objects deserialized so far (zero here),
  // instead of indexing past the end of the pool.
  const script = `
    import { serialize, deserialize } from "bun:jsc";
    // serialize(undefined) is [version header][UndefinedTag]; keep just the header.
    const prefix = new Uint8Array(serialize(undefined));
    const header = prefix.subarray(0, prefix.length - 1);
    const payload = new Uint8Array([...header, 19 /* ObjectReferenceTag */, 200 /* index into the (empty) object pool */]);
    let outcome;
    try {
      const value = deserialize(payload);
      outcome = value === null ? "rejected" : "accepted " + String(value);
    } catch (error) {
      outcome = error instanceof Error ? "rejected" : "threw non-error";
    }
    console.log(outcome);
    // A legitimate payload still round-trips.
    console.log(JSON.stringify(deserialize(serialize({ a: 1 }))));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe('rejected\n{"a":1}\n');
  expect(exitCode).toBe(0);
});

it("deserialize rejects a typed array whose backing store is not an array buffer", async () => {
  // A serialized ArrayBufferView must be backed by an ArrayBuffer (or a
  // reference to one already in the object pool). A payload that nests
  // ArrayBufferViewTag inside ArrayBufferViewTag thousands of levels deep must
  // be rejected at the first level instead of being followed all the way down.
  const script = `
    import { serialize, deserialize } from "bun:jsc";
    // serialize(undefined) is [version header][UndefinedTag]; keep just the header.
    const prefix = new Uint8Array(serialize(undefined));
    const header = prefix.subarray(0, prefix.length - 1);
    const depth = 200000;
    // Each level is: ArrayBufferViewTag (22), Uint8Array subtag (2),
    // byteOffset:uint64 = 0, byteLength:uint64 = 0. The next level's tag sits
    // where the backing ArrayBuffer is supposed to be.
    const unit = new Uint8Array(18);
    unit[0] = 22;
    unit[1] = 2;
    const payload = new Uint8Array(header.length + unit.length * depth);
    payload.set(header, 0);
    for (let i = 0; i < depth; i++) {
      payload.set(unit, header.length + i * unit.length);
    }
    let outcome;
    try {
      const value = deserialize(payload);
      outcome = value === null ? "rejected" : "accepted " + String(value);
    } catch (error) {
      outcome = error instanceof Error ? "rejected" : "threw non-error";
    }
    console.log(outcome);
    // Real typed arrays still round-trip, including two views sharing one
    // buffer (the second view's backing store is serialized as a reference
    // into the object pool).
    const shared = new ArrayBuffer(4);
    const first = new Uint8Array(shared);
    first.set([1, 2, 3, 4]);
    const second = new Uint16Array(shared);
    const out = deserialize(serialize({ first, second }));
    console.log(out.first instanceof Uint8Array, Array.from(out.first).join(","));
    console.log(out.second instanceof Uint16Array, Array.from(out.second).join(","));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("rejected\ntrue 1,2,3,4\ntrue 513,1027\n");
  expect(exitCode).toBe(0);
});

it("deserialize rejects a RegExp record whose pattern does not parse", async () => {
  // A serialized RegExp whose pattern bytes are rewritten to an unparseable
  // expression must be rejected at deserialize time instead of producing a
  // RegExp object that throws SyntaxError on every use.
  const script = `
    import { serialize, deserialize } from "bun:jsc";
    import * as v8 from "node:v8";

    function patch(buf) {
      const bytes = buf instanceof Buffer ? buf : Buffer.from(buf);
      const idx = bytes.indexOf("abc");
      bytes.write("(((", idx, "latin1");
      return buf;
    }

    for (const [name, ser, deser] of [
      ["bun:jsc", serialize, deserialize],
      ["node:v8", v8.serialize, v8.deserialize],
    ]) {
      let outcome;
      try {
        const value = deser(patch(ser(/abc/g)));
        outcome = "accepted " + value.source + " " + value.flags;
      } catch (error) {
        outcome = error instanceof Error ? "rejected " + error.constructor.name : "threw non-error";
      }
      console.log(name, outcome);
      // A valid RegExp still round-trips.
      const roundTripped = deser(ser(/xyz/gi));
      console.log(name, roundTripped instanceof RegExp, roundTripped.source, roundTripped.flags, roundTripped.test("AXYZB"));
    }
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(
    [
      "bun:jsc rejected TypeError",
      "bun:jsc true xyz gi true",
      "node:v8 rejected TypeError",
      "node:v8 true xyz gi true",
      "",
    ].join("\n"),
  );
  expect(exitCode).toBe(0);
});

it("serialize rejects a CryptoKey created with extractable set to false", async () => {
  // bun:jsc serialize() (and node:v8 serialize(), which wraps it) hands the raw
  // structured-clone buffer to the caller, so a key imported with
  // extractable: false must not be serializable through it. Keys marked
  // extractable still serialize, and the non-extractable key remains usable.
  const script = `
    import { serialize } from "bun:jsc";
    const secret = "THIS-IS-SECRET-KEY-MATERIAL-32B!";
    const secretBytes = new TextEncoder().encode(secret);
    const nonExtractable = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    let outcome;
    try {
      const bytes = new Uint8Array(serialize(nonExtractable));
      const text = Array.from(bytes, b => String.fromCharCode(b)).join("");
      outcome = text.includes(secret) ? "serialized with key material" : "serialized without key material";
    } catch {
      outcome = "rejected";
    }
    console.log(outcome);
    // A key the caller marked extractable still serializes.
    const extractable = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      true,
      ["sign"],
    );
    console.log(serialize(extractable).byteLength > 0);
    // The non-extractable key is still usable for its intended purpose.
    const signature = await crypto.subtle.sign("HMAC", nonExtractable, secretBytes);
    console.log(signature.byteLength);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("rejected\ntrue\n32\n");
  expect(exitCode).toBe(0);
});

it("deserialize rejects a CryptoKey whose named curve does not match its algorithm", async () => {
  const script = `
    import { serialize, deserialize } from "bun:jsc";
    const { publicKey } = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const bytes = new Uint8Array(serialize(publicKey));
    const pattern = [5, 22, 1, 32, 0, 0, 0];
    const offsets = [];
    for (let i = 0; i + pattern.length <= bytes.length; i++) {
      if (pattern.every((byte, j) => bytes[i + j] === byte)) offsets.push(i);
    }
    console.log(offsets.length);
    const mutated = bytes.slice();
    mutated[offsets[0] + 2] = 0;
    let outcome;
    try {
      outcome = deserialize(mutated) instanceof CryptoKey ? "accepted" : "rejected";
    } catch {
      outcome = "rejected";
    }
    console.log(outcome);
    const roundTripped = deserialize(bytes);
    console.log(roundTripped instanceof CryptoKey, roundTripped.algorithm.name);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "1\nrejected\ntrue Ed25519\n", exitCode: 0 });
});

it("deserialize rejects a CryptoKey whose algorithm does not belong to its key class", async () => {
  const script = `
    import { serialize, deserialize } from "bun:jsc";
    const { publicKey } = await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["encrypt", "decrypt"],
    );
    const bytes = new Uint8Array(serialize(publicKey));
    const pattern = [2, 3, 1, 0, 0, 0, 16];
    const offsets = [];
    for (let i = 0; i + pattern.length <= bytes.length; i++) {
      if (pattern.every((byte, j) => bytes[i + j] === byte)) offsets.push(i);
    }
    console.log(offsets.length);
    const mutated = bytes.slice();
    mutated[offsets[0] + 1] = 20;
    let outcome;
    try {
      outcome = deserialize(mutated) instanceof CryptoKey ? "accepted" : "rejected";
    } catch {
      outcome = "rejected";
    }
    console.log(outcome);
    const roundTripped = deserialize(bytes);
    console.log(roundTripped instanceof CryptoKey, roundTripped.algorithm.name);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "1\nrejected\ntrue RSA-OAEP\n", exitCode: 0 });
});

it("deserialize rejects a CryptoKey record with no key bytes", async () => {
  const script = `
    import { serialize, deserialize } from "bun:jsc";
    const prefix = new Uint8Array(serialize(undefined));
    const header = prefix.subarray(0, prefix.length - 1);
    const payload = new Uint8Array([...header, 33, 0, 0, 0, 0]);
    let outcome;
    try {
      outcome = deserialize(payload) instanceof CryptoKey ? "accepted" : "rejected";
    } catch {
      outcome = "rejected";
    }
    console.log(outcome);
    const { publicKey } = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const roundTripped = deserialize(serialize(publicKey));
    console.log(roundTripped instanceof CryptoKey, roundTripped.algorithm.name);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "rejected\ntrue Ed25519\n", exitCode: 0 });
});

it("deserialize applies the same nesting depth limit to arrays as to objects", async () => {
  const script = `
    import { serialize, deserialize } from "bun:jsc";
    const prefix = new Uint8Array(serialize(undefined));
    const header = prefix.subarray(0, prefix.length - 1);
    const undefinedTag = prefix[prefix.length - 1];
    const depth = 40005;
    const open = new Uint8Array([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    const close = new Uint8Array([255, 255, 255, 255]);
    const payload = new Uint8Array(header.length + open.length * depth + 1 + close.length * depth);
    payload.set(header, 0);
    let offset = header.length;
    for (let i = 0; i < depth; i++) {
      payload.set(open, offset);
      offset += open.length;
    }
    payload[offset++] = undefinedTag;
    for (let i = 0; i < depth; i++) {
      payload.set(close, offset);
      offset += close.length;
    }
    let outcome;
    try {
      outcome = Array.isArray(deserialize(payload)) ? "accepted" : "rejected";
    } catch {
      outcome = "rejected";
    }
    console.log(outcome);
    const shallow = [];
    let cursor = shallow;
    for (let i = 0; i < 64; i++) {
      const next = [];
      cursor.push(next);
      cursor = next;
    }
    let depthSeen = 0;
    for (let value = deserialize(serialize(shallow)); Array.isArray(value); value = value[0]) depthSeen++;
    console.log(depthSeen);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "rejected\n65\n", exitCode: 0 });
});

// Objects live in a frame at the moment a loop triggers DFG/FTL tier-up are
// captured into the compilation plan's m_mustHandleValues. Those were rooted
// as RootMarkReason::JITWorkList for the life of the concurrent compile, so a
// gc() issued while plans were queued reported fewer objects collected than the
// program had let go of (node's test-gc-http-client* hit this). The snapshot is
// now treated as weak; every DFG phase that reads it already handles nullopt.
it(
  "gc() does not root user objects from a concurrent DFG plan's OSR-entry snapshot",
  async () => {
    // Reproducing this needs several independent functions to request DFG at
    // roughly the same time so most plans are still in the worklist at gc(). The
    // http client/server path does that reliably (emit, nextTick drain, stream
    // flow all tier up during the first burst of responses). The fixture reports
    // how many ClientRequest/IncomingMessage instances the debugging heap
    // snapshot attributes directly to the JIT worklist; that count must be zero.
    // One compiler thread so plans queue instead of draining in parallel.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--jsc-numberOfDFGCompilerThreads=1",
        "--jsc-numberOfFTLCompilerThreads=1",
        path.join(import.meta.dir, "dfg-plan-gc-fixture.js"),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // The "alive" count is timing dependent (how many plans were queued at the
    // first gc()), but no ClientRequest/IncomingMessage may be a JITWorkList root.
    expect(stdout.trim()).toMatch(/^jitworklist-rooted=0 alive=\d+$/);
    expect(exitCode).toBe(0);
  },
  isDebug || isASAN ? 30_000 : undefined,
);
