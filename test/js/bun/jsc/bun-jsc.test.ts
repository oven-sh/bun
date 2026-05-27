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
import { bunEnv, bunExe, isBuildKite, isWindows } from "harness";

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

    // First profile call
    const result1 = profile(() => fib(30), sampleInterval);
    expect(result1).toBeDefined();
    expect(result1.functions).toBeDefined();
    expect(result1.stackTraces).toBeDefined();
    expect(result1.stackTraces.traces.length).toBeGreaterThan(0);

    // Second profile call - should work after first one completed
    // This verifies that shutdown() -> pause() fix works
    const result2 = profile(() => fib(30), sampleInterval);
    expect(result2).toBeDefined();
    expect(result2.functions).toBeDefined();
    expect(result2.stackTraces).toBeDefined();
    expect(result2.stackTraces.traces.length).toBeGreaterThan(0);

    // Third profile call - verify profiler can be reused multiple times
    const result3 = profile(() => fib(30), sampleInterval);
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
