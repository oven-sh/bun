import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// Regression test for a segfault in WTF::StringBuilder::reallocateBuffer during
// BunV8HeapSnapshotBuilder::generateV8HeapSnapshot. Large JSString values in the
// heap were embedded in full as node names in the serialized JSON, so a single
// string > ~357M characters overflowed the worst-case-length computation in
// StringBuilder::appendQuotedJSONString, and smaller-but-still-huge strings caused
// OOM while growing the (upconverted to UTF-16) JSON buffer. V8's own heap profiler
// caps these at 1024 characters; we now do the same.

test("generateHeapSnapshot('v8') truncates string node names like V8", async () => {
  // Use a dedicated subprocess so the marker string is guaranteed to be a live,
  // flat (non-rope) heap cell when the snapshot is taken, and so the test runner's
  // own heap doesn't interfere with the measurement.
  const script = `
    const marker = "FINDME_MARKER_" + Buffer.alloc(100000, "Q").toString() + "_MARKER_END";
    // Flatten the rope so the heap contains a single 100k+ character JSString.
    void marker.charCodeAt(50000);
    globalThis.__keep = marker;
    const snap = Bun.generateHeapSnapshot("v8");
    const parsed = JSON.parse(snap);
    if (!Array.isArray(parsed.strings)) throw new Error("strings table missing");
    let longest = 0;
    let foundMarker = false;
    for (const s of parsed.strings) {
      if (typeof s !== "string") continue;
      if (s.length > longest) longest = s.length;
      if (s.startsWith("FINDME_MARKER_")) foundMarker = true;
    }
    console.log(JSON.stringify({ longest, foundMarker, snapLength: snap.length }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    // Surface the failure before asserting on the parsed output.
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: expect.any(String), stderr: "", exitCode: 0 });
  }
  const { longest, foundMarker } = JSON.parse(stdout.trim());
  // V8 caps strings-table entries at 1024 characters; make sure we do too.
  expect(longest).toBeLessThanOrEqual(1024);
  // The truncated marker string should still be present (first 1024 chars retained).
  expect(foundMarker).toBe(true);
  expect(exitCode).toBe(0);
});

test("generateHeapSnapshot('v8') handles a large UTF-16 string in the heap", async () => {
  // The original crash required a ~358M character string to overflow CheckedInt32
  // in appendQuotedJSONString; that allocation is ~700MB and the heap walk is very
  // slow under a debug/ASAN build. Use a smaller but still non-trivial UTF-16 string
  // here to exercise the upconvert-to-char16_t path from the crash stack and verify
  // the node name is truncated rather than embedded whole.
  const script = `
    // U+2014 is outside Latin-1, so the resulting WTF::String is 16-bit and the
    // JSON builder has to upconvert when it reaches this entry in the strings table.
    const N = 4 * 1024 * 1024;
    const s = Buffer.alloc(N * 2, "\\u2014", "utf16le").toString("utf16le");
    globalThis.__keep = s;
    const snap = Bun.generateHeapSnapshot("v8");
    const parsed = JSON.parse(snap);
    let longest = 0;
    for (const str of parsed.strings) {
      if (typeof str === "string" && str.length > longest) longest = str.length;
    }
    console.log(JSON.stringify({ longest, snapLength: snap.length }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: expect.any(String), stderr: "", exitCode: 0 });
  }
  const { longest, snapLength } = JSON.parse(stdout.trim());
  expect(longest).toBeLessThanOrEqual(1024);
  // Without truncation the 4M-character string alone would make the snapshot
  // several MB larger than the baseline; with truncation it stays small.
  expect(snapLength).toBeLessThan(4 * 1024 * 1024);
  expect(exitCode).toBe(0);
});

test("generateHeapSnapshot('v8', 'arraybuffer') also truncates string node names", async () => {
  const script = `
    const marker = "FINDMEAB_" + Buffer.alloc(100000, "Z").toString() + "_ABEND";
    void marker.charCodeAt(50000);
    globalThis.__keep = marker;
    const snap = Bun.generateHeapSnapshot("v8", "arraybuffer");
    const parsed = JSON.parse(new TextDecoder().decode(snap));
    let longest = 0;
    for (const s of parsed.strings) {
      if (typeof s === "string" && s.length > longest) longest = s.length;
    }
    console.log(JSON.stringify({ longest }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: expect.any(String), stderr: "", exitCode: 0 });
  }
  const { longest } = JSON.parse(stdout.trim());
  expect(longest).toBeLessThanOrEqual(1024);
  expect(exitCode).toBe(0);
});

// The original crash reproduction: one string long enough that len * 6 + 2 overflows
// CheckedInt32 inside StringBuilder::appendQuotedJSONString. This needs a ~700MB
// allocation and a full heap walk, which is too slow under debug and/or ASAN
// builds; run it against non-sanitized release builds only.
test.skipIf(isDebug || isASAN)(
  "generateHeapSnapshot('v8') does not crash when a single string exceeds the CheckedInt32 worst-case bound",
  async () => {
    const script = `
    const N = 360_000_000; // > (INT_MAX - 2) / 6
    const s = Buffer.alloc(N * 2, "\\u00e9\\u2014").toString("utf16le");
    globalThis.__keep = s;
    const snap = Bun.generateHeapSnapshot("v8");
    const parsed = JSON.parse(snap);
    let longest = 0;
    for (const str of parsed.strings) {
      if (typeof str === "string" && str.length > longest) longest = str.length;
    }
    console.log(JSON.stringify({ longest }));
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: expect.any(String), stderr: "", exitCode: 0 });
    }
    const { longest } = JSON.parse(stdout.trim());
    expect(longest).toBeLessThanOrEqual(1024);
    expect(exitCode).toBe(0);
  },
  120_000,
);
