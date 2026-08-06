import { beforeAll, describe, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// This test file programmatically runs esbuild's decorator test suite
// (vendor/esbuild/scripts/decorator-tests.ts) against Bun's transpiler.
//
// To keep this file fast, we spawn ONE bun subprocess that imports each
// test case (written to its own .ts file in a temp directory so a syntax
// error in one test doesn't take down the rest). The runner prints a
// machine-readable PASS/FAIL line per test, which we parse back into
// per-test bun:test assertions so failures are still attributed to the
// correct decorator test name.

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

interface TestResult {
  ok: boolean;
  error?: string;
}

// Spawn a single bun process that imports every decorator test file in
// sequence and reports per-test PASS/FAIL on stdout.
async function runAllDecoratorTests(): Promise<Map<number, TestResult>> {
  const files: Record<string, string> = {
    "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
  };

  const fileNames: string[] = [];
  for (let i = 0; i < allTests.length; i++) {
    const { body, isAsync } = allTests[i];
    const fileName = `test-${i}.ts`;
    fileNames.push(fileName);
    // Each test is its own module so a parse/transpile error in one test
    // doesn't prevent the others from running. Async tests use top-level
    // await so a rejection turns into an import error caught by the runner.
    const wrapped = isAsync ? `await (async () => {${body}})();` : `(() => {${body}})();`;
    files[fileName] = testBoilerplate + "\n" + wrapped;
  }

  files["_runner.ts"] = [
    `const files = ${JSON.stringify(fileNames)};`,
    `for (let i = 0; i < files.length; i++) {`,
    `  try {`,
    `    await import("./" + files[i]);`,
    `    console.log("PASS " + i);`,
    `  } catch (e) {`,
    `    const raw = e && e.stack ? String(e.stack) : String(e);`,
    `    console.log("FAIL " + i + " " + JSON.stringify(raw));`,
    `  }`,
    `}`,
    ``,
  ].join("\n");

  using dir = tempDir("es-dec-esbuild", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "_runner.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const stderr = filterStderr(rawStderr);

  const results = new Map<number, TestResult>();
  for (const line of stdout.split("\n")) {
    const match = line.match(/^(PASS|FAIL) (\d+)(?: (.*))?$/);
    if (!match) continue;
    const idx = parseInt(match[2], 10);
    if (match[1] === "PASS") {
      results.set(idx, { ok: true });
    } else {
      let error = match[3] ?? "";
      try {
        error = JSON.parse(error);
      } catch {}
      results.set(idx, { ok: false, error });
    }
  }

  if (exitCode !== 0 || results.size !== allTests.length) {
    throw new Error(
      `Decorator test runner did not complete cleanly.\n` +
        `Reported ${results.size}/${allTests.length} results, exit code ${exitCode}.\n` +
        `stderr:\n${stderr}\n` +
        `stdout:\n${stdout}`,
    );
  }

  return results;
}

describe("ES Decorators (esbuild test suite)", () => {
  let results: Map<number, TestResult>;

  // The default 5s hook timeout is too short for 147 sequential transpiles
  // in a debug/ASAN build, so give the single setup spawn a generous budget.
  beforeAll(async () => {
    results = await runAllDecoratorTests();
  }, 120_000);

  for (let i = 0; i < allTests.length; i++) {
    const { name } = allTests[i];

    if (shouldTodo(name)) {
      test.todo(name);
      continue;
    }

    test(name, () => {
      const result = results.get(i);
      if (!result) {
        throw new Error(`No result reported for decorator test #${i} ("${name}")`);
      }
      if (!result.ok) {
        throw new Error(result.error || `Decorator test "${name}" failed without an error message`);
      }
    });
  }
});
