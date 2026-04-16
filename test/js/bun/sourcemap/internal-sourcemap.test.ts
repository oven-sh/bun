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

async function run(files: Record<string, string>) {
  using dir = tempDir("internal-sourcemap", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
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
});
