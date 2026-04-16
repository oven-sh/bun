import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Runtime-transpiled modules store an InternalSourceMap blob (varint stream +
// sync points) instead of expanding VLQ into a Mapping.List. These tests pin
// the remapped line:col for a few stack-trace shapes so the sync-index lookup
// can't drift without notice.
const fixture = `\
type Unused = { a: number };

function alpha(): never {
  const x: Unused = { a: 1 };
  void x;
  throw new Error("boom");
}

function beta() {
  return alpha();
}

function gamma() {
  return beta();
}

function captureViaCaptureStackTrace() {
  const obj: { stack?: string } = {};
  Error.captureStackTrace(obj, captureViaCaptureStackTrace);
  return obj.stack!;
}

try {
  gamma();
} catch (e) {
  console.log("--throw--");
  console.log((e as Error).stack);
}

console.log("--newError--");
console.log(new Error("here").stack);

console.log("--captureStackTrace--");
console.log(captureViaCaptureStackTrace());
`;

// Keep only the line:col suffixes from frames inside our fixture so the
// comparison is independent of temp-dir paths and frame formatting.
function extractPositions(stack: string): string[] {
  return stack
    .split("\n")
    .map(line => {
      const m = line.match(/index\.ts:(\d+):(\d+)/);
      return m ? `${m[1]}:${m[2]}` : null;
    })
    .filter((s): s is string => s !== null);
}

async function run(files: Record<string, string>, env: Record<string, string> = {}) {
  using dir = tempDir("internal-sourcemap", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exited };
}

describe("InternalSourceMap", () => {
  test("remaps thrown error, new Error().stack, and captureStackTrace to original lines", async () => {
    const { stdout, stderr, exited } = await run({ "index.ts": fixture });

    expect(stderr).toBe("");

    const positions = extractPositions(stdout);
    expect(positions).toEqual([
      "6:13", // throw new Error("boom")
      "24:3", // gamma() at top level
      "31:17", // new Error("here").stack
      "34:13", // captureViaCaptureStackTrace()
    ]);

    expect(exited).toBe(0);
  });

  // Minified-shape: a single ~12KB line with thousands of mappings forces the
  // bit-packed `gc_w` lane wide and the absolute SyncEntry.gen_col into the
  // thousands, while `gl_mask` is all-zeros. Stack column must still remap to
  // the original `throw`.
  test("remaps a throw deep into a single very long line", async () => {
    let src = "";
    for (let i = 0; i < 1000; i++) src += `const a${i}:number=${i};`;
    // One very long identifier forces a single ~10k-column delta inside one
    // window so the bit-packed `gc` lane width must exceed 8 bits.
    src += `const ${Buffer.alloc(10000, "Z").toString()}: number = 0;`;
    const throwCol = src.length + 1;
    src += `throw new Error("x");\n`;

    const { stderr, exited } = await run({ "index.ts": src });

    const m = stderr.match(/index\.ts:1:(\d+)/);
    expect(m).not.toBeNull();
    // Mapped column lands inside the `throw new Error(...)` expression. The
    // printer maps the throw at the `Error` constructor, ~10 columns past the
    // `throw` keyword; a tolerance well under one statement width still rejects
    // sync-index or bit-lane drift (which would be off by hundreds/thousands).
    expect(Math.abs(Number(m![1]) - throwCol)).toBeLessThan(24);
    expect(exited).toBe(1);
  });

  // 200 single-expression lines so the map has well over `sync_interval` (64)
  // mappings and lookup must bsearch past sync_points[0].
  test("remaps frames past multiple sync points", async () => {
    const lines: string[] = ["let v: number = 0;"];
    for (let i = 0; i < 200; i++) lines.push(`v = (v + ${i}) | 0;`);
    lines.push("function deep() { return new Error('e').stack!; }");
    lines.push("console.log(deep());");
    const big = lines.join("\n") + "\n";

    const { stdout, stderr, exited } = await run({ "index.ts": big });

    expect(stderr).toBe("");
    // `function deep()` is at source line 202; the call is at line 203.
    expect(stdout).toMatch(/index\.ts:202:\d+/);
    expect(stdout).toMatch(/index\.ts:203:\d+/);
    expect(exited).toBe(0);
  });

  test("FindCache eviction (>16 distinct windows in one stack)", async () => {
    // 20 functions spread ~125 lines apart in a single file. With ~6 mappings
    // per padding line that's ~750 mappings between calls -> each frame lands
    // in a different K=64 window, and 20 windows > FindCache.slot_count (16),
    // so the cache must evict mid-stack. Capture twice so the second pass
    // exercises lookups against post-eviction slot state.
    const lines: string[] = ["Error.stackTraceLimit = 50;", "export const keep: number[] = [];"];
    const callLines: number[] = [];
    for (let i = 0; i < 20; i++) {
      for (let p = 0; p < 125; p++) lines.push(`keep.push(${i * 1000 + p});`);
      callLines.push(lines.length + 1);
      lines.push(
        i === 0
          ? `function f0(): string { return new Error("e").stack!; }`
          : `function f${i}(): string { return f${i - 1}(); }`,
      );
    }
    lines.push(`const stacks: string[] = [];`);
    lines.push(`for (let i = 0; i < 2; i++) stacks.push(f19());`);
    lines.push(
      `if (stacks[0] !== stacks[1]) throw new Error("FindCache produced different positions across passes:\\n" + stacks[0] + "\\n---\\n" + stacks[1]);`,
    );
    lines.push(`console.log(stacks[0]);`);

    // Disable JSC tail-call elimination so all 20 frames survive in the stack.
    const { stdout, stderr, exited } = await run(
      { "index.ts": lines.join("\n") + "\n" },
      { BUN_JSC_useTailCalls: "0" },
    );

    expect(stderr).toBe("");
    for (const ln of callLines) {
      expect(stdout).toMatch(new RegExp(`index\\.ts:${ln}:`));
    }
    expect(exited).toBe(0);
  });
});
