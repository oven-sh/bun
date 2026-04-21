import { describe, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// This test file programmatically runs esbuild's decorator test suite
// (vendor/esbuild/scripts/decorator-tests.ts) against Bun's transpiler.
// All tests are written into a single .ts file (each wrapped in its own
// IIFE scope) in a temp directory with a tsconfig that does NOT have
// experimentalDecorators, so standard decorators are used. A single Bun
// subprocess transpiles and runs the file, reporting per-test results.

const testBoilerplate = `
// Polyfill Symbol.metadata (not natively available in JSC)
const metaKey = Symbol.metadata || Symbol.for("Symbol.metadata");
if (!(metaKey in Function.prototype)) {
  Object.defineProperty(Function.prototype, metaKey, { value: null });
}
if (!Symbol.metadata) Symbol.metadata = metaKey;

function prettyPrint(x) {
  if (x && x.prototype && x.prototype.constructor === x) return 'class';
  if (typeof x === 'string') return JSON.stringify(x);
  try { return x + ''; } catch { return 'typeof ' + typeof x; }
}

function assertEq(callback, expected) {
  let x;
  try { x = callback(); } catch (e) {
    const code = callback.toString().replace(/^\\(\\) => /, '').replace(/\\s+/g, ' ');
    throw new Error('assertEq threw: ' + e + '\\nCode: ' + code);
  }
  if (x !== expected) {
    const code = callback.toString().replace(/^\\(\\) => /, '').replace(/\\s+/g, ' ');
    throw new Error('Expected ' + prettyPrint(expected) + ' but got ' + prettyPrint(x) + '\\nCode: ' + code);
  }
  return true;
}

function assertThrows(callback, expected) {
  try {
    callback();
  } catch (e) {
    if (e instanceof expected) return true;
    throw new Error('Expected ' + expected.name + ' but threw: ' + e);
  }
  throw new Error('Expected ' + expected.name + ' to be thrown but nothing was thrown');
}
`;

function filterStderr(stderr: string) {
  return stderr
    .split("\n")
    .filter(line => !line.startsWith("WARNING: ASAN"))
    .join("\n")
    .trim();
}

// Read the esbuild decorator test source and extract individual tests
const esbuildTestPath = join(import.meta.dir, "esbuild-decorator-tests.ts");
const esbuildSource = readFileSync(esbuildTestPath, "utf8");

interface TestEntry {
  name: string;
  body: string;
  isAsync: boolean;
}

function extractTests(source: string): TestEntry[] {
  const results: TestEntry[] = [];

  // Find test entry start positions using the pattern:
  //   'Test Name': () => {
  //   'Test Name': async () => {
  const testStartRegex = /^  '([^']+)':\s*(async\s*)?\(\)\s*=>\s*\{/gm;
  const starts: { name: string; isAsync: boolean; index: number; matchEnd: number }[] = [];

  let m;
  while ((m = testStartRegex.exec(source)) !== null) {
    starts.push({
      name: m[1],
      isAsync: !!m[2],
      index: m.index,
      matchEnd: m.index + m[0].length,
    });
  }

  // For each test, find the function body by brace counting from the opening {
  for (let i = 0; i < starts.length; i++) {
    const { name, isAsync, matchEnd } = starts[i];
    let depth = 1;
    let pos = matchEnd;
    let inString: string | null = null;
    let escaped = false;

    while (pos < source.length && depth > 0) {
      const ch = source[pos];

      if (escaped) {
        escaped = false;
        pos++;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        pos++;
        continue;
      }

      if (inString) {
        if (ch === inString) {
          inString = null;
        }
        pos++;
        continue;
      }

      // Skip line comments (handles apostrophes in comments like "context's")
      if (ch === "/" && pos + 1 < source.length && source[pos + 1] === "/") {
        const nl = source.indexOf("\n", pos);
        pos = nl === -1 ? source.length : nl + 1;
        continue;
      }

      if (ch === "'" || ch === '"' || ch === "`") {
        inString = ch;
        pos++;
        continue;
      }

      if (ch === "{") depth++;
      if (ch === "}") depth--;

      pos++;
    }

    // pos is now right after the closing brace
    const functionBody = source.substring(matchEnd, pos - 1); // exclude closing }
    results.push({ name, body: functionBody, isAsync });
  }

  return results;
}

const allTests = extractTests(esbuildSource);

// Known categories of tests that use unimplemented features
const todoPatterns: RegExp[] = [];

// Additional specific tests that use features not yet working
const todoTests = new Set<string>([]);

function shouldTodo(name: string): boolean {
  if (todoTests.has(name)) return true;
  return todoPatterns.some(p => p.test(name));
}

// Build a single runner script that executes every test body in its own
// IIFE scope (matching the original per-file isolation) and reports the
// outcome of each on stdout. This lets us spawn one Bun process instead
// of one per test while still surfacing per-test pass/fail.
const PASS_MARKER = "ESDEC_PASS";
const FAIL_MARKER = "ESDEC_FAIL";

function buildRunnerSource(): string {
  let src = testBoilerplate + "\n";
  src += `const __PASS = ${JSON.stringify(PASS_MARKER)};\n`;
  src += `const __FAIL = ${JSON.stringify(FAIL_MARKER)};\n`;
  src += `function __report(i, err) {\n`;
  src += `  if (err === undefined) console.log(__PASS + i);\n`;
  src += `  else console.log(__FAIL + i + __FAIL + (err && (err.stack || err.message) || String(err)).replace(/\\n/g, "\\\\n"));\n`;
  src += `}\n`;
  src += `async function __main() {\n`;
  for (let i = 0; i < allTests.length; i++) {
    const { name, body, isAsync } = allTests[i];
    if (shouldTodo(name)) continue;
    if (isAsync) {
      src += `try { await (async () => {${body}})(); __report(${i}); } catch (e) { __report(${i}, e); }\n`;
    } else {
      src += `try { (() => {${body}})(); __report(${i}); } catch (e) { __report(${i}, e); }\n`;
    }
  }
  src += `}\n__main().catch(e => { console.error(e); process.exit(1); });\n`;
  return src;
}

interface RunResult {
  ok: boolean;
  error?: string;
}

async function runAllDecoratorTests(): Promise<{
  results: Map<number, RunResult>;
  stderr: string;
  exitCode: number;
  stdout: string;
}> {
  using dir = tempDir("es-dec-esbuild", {
    "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
    "test.ts": buildRunnerSource(),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const stderr = filterStderr(rawStderr);

  const results = new Map<number, RunResult>();
  for (const line of stdout.split("\n")) {
    if (line.startsWith(PASS_MARKER)) {
      const idx = Number(line.slice(PASS_MARKER.length));
      results.set(idx, { ok: true });
    } else if (line.startsWith(FAIL_MARKER)) {
      const rest = line.slice(FAIL_MARKER.length);
      const sep = rest.indexOf(FAIL_MARKER);
      const idx = Number(rest.slice(0, sep));
      const error = rest.slice(sep + FAIL_MARKER.length).replace(/\\n/g, "\n");
      results.set(idx, { ok: false, error });
    }
  }

  return { results, stderr, exitCode, stdout };
}

const runPromise = runAllDecoratorTests();

describe("ES Decorators (esbuild test suite)", () => {
  for (let i = 0; i < allTests.length; i++) {
    const { name } = allTests[i];

    if (shouldTodo(name)) {
      test.todo(name);
    } else {
      test(name, async () => {
        const { results, stderr, exitCode, stdout } = await runPromise;
        const result = results.get(i);
        if (!result) {
          throw new Error(
            `Test "${name}" produced no result (runner exit code ${exitCode})\n` +
              `stdout: ${stdout}\n` +
              `stderr: ${stderr}`,
          );
        }
        if (!result.ok) {
          throw new Error(`Test "${name}" failed\n` + `error: ${result.error}\n` + `stderr: ${stderr}`);
        }
      });
    }
  }
});
