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

    // Keep the JS thread busy for a fixed wall-clock window so the sampler
    // thread is guaranteed time to fire regardless of how fast the JIT makes
    // fib() or how slowly the sampler thread wakes after start()/pause(). A
    // single fib(n) call has no such lower bound: once JIT-compiled, fib(26)
    // can complete inside one 50us sample interval on fast release hardware.
    const work = () => {
      const start = performance.now();
      let acc = 0;
      do {
        acc += fib(18);
      } while (performance.now() - start < 10);
      return acc;
    };

    // First profile call
    const result1 = profile(work, sampleInterval);
    expect(result1).toBeDefined();
    expect(result1.functions).toBeDefined();
    expect(result1.stackTraces).toBeDefined();
    expect(result1.stackTraces.traces.length).toBeGreaterThan(0);

    // Second profile call - should work after first one completed
    // This verifies that shutdown() -> pause() fix works
    const result2 = profile(work, sampleInterval);
    expect(result2).toBeDefined();
    expect(result2.functions).toBeDefined();
    expect(result2.stackTraces).toBeDefined();
    expect(result2.stackTraces.traces.length).toBeGreaterThan(0);

    // Third profile call - verify profiler can be reused multiple times
    const result3 = profile(work, sampleInterval);
    expect(result3).toBeDefined();
    expect(result3.functions).toBeDefined();
    expect(result3.stackTraces).toBeDefined();
    expect(result3.stackTraces.traces.length).toBeGreaterThan(0);
  });

  it("profile accepts a callable Proxy", async () => {
    // functionRunProfiler used to uncheckedDowncast<JSFunction> the callback after only
    // checking isCallable(), which aborts asserts builds when the callable is a ProxyObject.
    const script = `
      const { profile } = require("bun:jsc");
      const result = profile(new Proxy(function () { return 1; }, {}));
      if (!result || typeof result.functions !== "string" || !("stackTraces" in result)) {
        throw new Error("unexpected profile() result keys: " + JSON.stringify(result && Object.keys(result)));
      }
      console.log("ok");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
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

it("deserialize does not pre-allocate array storage from an untrusted length field", async () => {
  // Serialize [7], then overwrite the ArrayTag's uint32 length with 1e8. The
  // payload still only holds one element, so the deserializer must not allocate
  // 1e8 contiguous slots (~800 MB) up front just because the header says so.
  const script = `
    import { serialize, deserialize } from "bun:jsc";
    const length = 100_000_000;
    const base = Buffer.from(serialize([7]));
    const tag = base.indexOf(Buffer.from([1 /* ArrayTag */, 1, 0, 0, 0 /* length 1 LE */]));
    if (tag < 0) throw new Error("ArrayTag not found in " + base.toString("hex"));
    const payload = Buffer.from(base);
    payload.writeUInt32LE(length, tag + 1);
    const rssBefore = process.memoryUsage().rss;
    const out = deserialize(payload);
    const rssDeltaMB = (process.memoryUsage().rss - rssBefore) / (1024 * 1024);
    console.log(JSON.stringify({
      rssDeltaMB: Math.round(rssDeltaMB),
      length: out.length,
      keys: Object.keys(out).length,
      zero: out[0],
      isArray: Array.isArray(out),
    }));
    // Nested variant: every nested ArrayTag is counted against the same shared
    // budget, so 2000 nested arrays whose lengths each equal floor(remaining/5)
    // cannot re-spend the same input bytes 2000 times.
    const header = new Uint8Array(serialize(undefined)).slice(0, -1);
    const depth = 2000;
    const nest = Buffer.alloc(header.length + 5 + (depth - 1) * 9 + depth * 4);
    nest.set(header, 0);
    let p = header.length;
    nest[p++] = 1; // ArrayTag
    nest.writeUInt32LE(Math.floor((nest.length - (p + 4)) / 5), p); p += 4;
    for (let k = 1; k < depth; k++) {
      nest.writeUInt32LE(0, p); p += 4; // index
      nest[p++] = 1; // ArrayTag
      nest.writeUInt32LE(Math.floor((nest.length - (p + 4)) / 5), p); p += 4;
    }
    for (let k = 0; k < depth; k++) { nest.writeUInt32LE(0xffffffff, p); p += 4; }
    const nestRssBefore = process.memoryUsage().rss;
    const nestOut = deserialize(nest);
    const nestRssDeltaMB = (process.memoryUsage().rss - nestRssBefore) / (1024 * 1024);
    let d = nestOut, measuredDepth = 1;
    while (Array.isArray(d[0])) { d = d[0]; measuredDepth++; }
    console.log(JSON.stringify({
      bytes: nest.length,
      rssDeltaMB: Math.round(nestRssDeltaMB),
      depth: measuredDepth,
      outerLength: nestOut.length,
    }));
    // Legitimate arrays still round-trip. The sparse case is short enough that
    // the declared length exceeds the entry budget, so it exercises the
    // ArrayStorage path; the dense case exercises the unchanged fast path.
    const sparse = new Array(10);
    sparse[3] = "x";
    const dense = [1, 2, 3, 4, 5];
    const rtSparse = deserialize(serialize(sparse));
    const rtDense = deserialize(serialize(dense));
    console.log(JSON.stringify({
      sparse: { length: rtSparse.length, keys: Object.keys(rtSparse), three: rtSparse[3], hole: 0 in rtSparse },
      dense: { length: rtDense.length, values: rtDense },
    }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const [forged, nested, roundTrip] = stdout
    .trim()
    .split("\n")
    .map(line => JSON.parse(line));
  const rssLimitMB = isASAN || isDebug ? 40 : 20;
  expect({ ...forged, rssDeltaMB: undefined }).toEqual({
    rssDeltaMB: undefined,
    length: 100_000_000,
    keys: 1,
    zero: 7,
    isArray: true,
  });
  // Without the clamp this allocates ~800 MB of contiguous storage.
  expect(forged.rssDeltaMB).toBeLessThan(rssLimitMB);
  expect({ ...nested, rssDeltaMB: undefined }).toEqual({
    rssDeltaMB: undefined,
    bytes: 26000,
    depth: 2000,
    outerLength: 5198,
  });
  // Without the shared budget every level re-spends the same input bytes.
  expect(nested.rssDeltaMB).toBeLessThan(rssLimitMB);
  expect(roundTrip).toEqual({
    sparse: { length: 10, keys: ["3"], three: "x", hole: false },
    dense: { length: 5, values: [1, 2, 3, 4, 5] },
  });
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

describe("JsRef::Weak liveness", () => {
  // collectSyncWithoutSweep leaves dead cells allocated until the incremental sweeper reaches them.
  it("dead-but-unswept cells read as not live, kept cells read as live", () => {
    const { jscInternals } = require("bun:internal-for-testing");
    let objects: object[] = [];
    const dropped: bigint[] = [];
    for (let i = 0; i < 2000; i++) {
      const o = { i, pad: [i] };
      objects.push(o);
      dropped.push(jscInternals.rawCellAddress(o));
    }
    const kept = { keep: true };
    const keptAddr = jscInternals.rawCellAddress(kept);
    expect(dropped.every(a => jscInternals.isLiveCellAtRawAddress(a))).toBe(true);
    expect(jscInternals.isLiveCellAtRawAddress(keptAddr)).toBe(true);

    objects = [];
    jscInternals.collectSyncWithoutSweep();

    // A few may survive via the conservative stack scan; the bulk must read as dead.
    const stillLive = dropped.filter(a => jscInternals.isLiveCellAtRawAddress(a)).length;
    expect(stillLive).toBeLessThan(dropped.length / 2);
    expect(jscInternals.isLiveCellAtRawAddress(keptAddr)).toBe(true);
    expect(kept.keep).toBe(true);
  });
});
