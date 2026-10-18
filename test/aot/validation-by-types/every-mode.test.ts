// JSON.parse<T>(text) validates wherever Bun compiles the call: `bun run`, a bundle for Bun, for Node and for browsers, `bun run --aot`
// and `bun build --compile --aot`. ./every-mode/program.ts prints one line per text, and every way of running it prints the same lines.
import { expect } from "bun:test";
import { test } from "../supported";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";

const sources = join(import.meta.dir, "every-mode");

async function run(cmd: string[], cwd: string): Promise<string> {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return stdout;
}

function copyOfSources(name: string) {
  const dir = tempDir(name, {});
  cpSync(sources, String(dir), { recursive: true });
  return dir;
}

let expected: Promise<string> | undefined;
const plainRun = () => (expected ??= run([bunExe(), "run", join(sources, "program.ts")], sources));

test("bun run validates", async () => {
  const lines = (await plainRun()).trim().split("\n");
  expect(lines.length).toBeGreaterThan(100);
  expect(lines.find(line => line.startsWith("Order: as declared"))).toContain('| {"id":7,');
  expect(lines.find(line => line.startsWith("Order: with more"))).toEndWith("| first,id,items,to,kind,coupon,last");
  expect(lines.find(line => line.startsWith("Order: a number is a string"))).toBe(
    'Order: a number is a string | TypeError | id: Invalid input: expected number, received string | [{"path":["id"],"code":"invalid_type","expected":"number","received":"string","message":"Invalid input: expected number, received string"}]',
  );
  expect(lines).toContain('above its declaration {"value":1,"children":[]} TypeError value: Invalid input: expected number, received string');
  expect(lines).toContain('through export *, a misfit two files away | TypeError | leaves.0.color: Invalid input: expected "green" | "red", received string');
  expect(lines).toContain('typeof such a value, a misfit | TypeError | season: Invalid input: expected "spring" | "fall", received string');
  expect(lines).toContain("a global that a module nobody imports declares | TypeError | age: Invalid input: expected number, received string");
  expect(lines.find(line => line.startsWith("no type argument"))).toContain('| {"id":"one"} |');
  expect(lines.find(line => line.startsWith("a variable named JSON"))).toContain("mine ");
  expect(lines.filter(line => line.startsWith("not JSON")).every(line => line.includes(" true SyntaxError"))).toBe(true);
});

test.each(["bun", "node", "browser"])("a bundle for %s prints what bun run prints", async target => {
  using dir = copyOfSources("json-parse-bundle-" + target);
  await run([bunExe(), "build", "--target=" + target, "./program.ts", "--outfile=bundle.js"], String(dir));
  expect(await run([bunExe(), "run", "./bundle.js"], String(dir))).toBe(await plainRun());
  const node = target === "node" ? Bun.which("node") : null;
  if (node) expect(await run([node, "./bundle.js"], String(dir))).toBe(await plainRun());
});

test("a minified bundle prints what bun run prints", async () => {
  using dir = copyOfSources("json-parse-bundle-minified");
  await run([bunExe(), "build", "--target=browser", "--minify", "./program.ts", "--outfile=bundle.js"], String(dir));
  expect(await run([bunExe(), "run", "./bundle.js"], String(dir))).toBe(await plainRun());
});

test("bun run --aot prints what bun run prints", async () => {
  expect(await run([bunExe(), "run", "--aot", join(sources, "program.ts")], sources)).toBe(await plainRun());
}, 120_000);

test("bun build --compile --aot prints what bun run prints", async () => {
  using dir = copyOfSources("json-parse-executable");
  const outfile = join(String(dir), "program" + (isWindows ? ".exe" : ""));
  await run([bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", outfile], String(dir));
  expect(await run([outfile], String(dir))).toBe(await plainRun());
}, 600_000);

test("bun build --compile prints what bun run prints", async () => {
  using dir = copyOfSources("json-parse-executable-with-jit");
  const outfile = join(String(dir), "program" + (isWindows ? ".exe" : ""));
  await run([bunExe(), "build", "--compile", "./program.ts", "--outfile", outfile], String(dir));
  expect(await run([outfile], String(dir))).toBe(await plainRun());
}, 120_000);

test("no code is generated from strings", async () => {
  expect(await run([bunExe(), "--disallow-code-generation-from-strings", "run", join(sources, "program.ts")], sources)).toBe(await plainRun());
  using dir = copyOfSources("json-parse-no-eval");
  await run([bunExe(), "build", "--target=browser", "./program.ts", "--outfile=bundle.js"], String(dir));
  const bundle = readFileSync(join(String(dir), "bundle.js"), "utf8");
  expect(bundle).not.toMatch(/\beval\s*\(|\bnew Function\b|\bFunction\s*\(/);
});

test("a bundle without such a call holds nothing of the helper", async () => {
  using dir = tempDir("json-parse-without-type-argument", {
    "program.ts": `interface User { id: number }\nconst user = JSON.parse(process.argv[2] ?? "{}") as User;\nconsole.log(user.id);\n`,
  });
  await run([bunExe(), "build", "--target=browser", "./program.ts", "--outfile=bundle.js"], String(dir));
  const bundle = readFileSync(join(String(dir), "bundle.js"), "utf8");
  expect(bundle).not.toContain("validateJSON");
  expect(bundle).not.toContain("Invalid input");
  expect(bundle.length).toBeLessThan(200);
});

test("the error points at the call", async () => {
  using dir = tempDir("json-parse-error-position", {
    "program.ts": `interface User { id: number }
function load(text: string): User {
  const user =   JSON.parse<User>(text);
  user.id++;
  return user;
}
try {
  load('{"id":"one"}');
} catch (error: any) {
  console.log(error.stack.split("\\n").slice(0, 3).join("\\n").replaceAll(import.meta.dir, "").replaceAll("\\\\", "/"));
}
`,
  });
  const stack = await run([bunExe(), "run", "./program.ts"], String(dir));
  expect(stack).toContain("TypeError: id: Invalid input: expected number, received string");
  expect(stack).toContain("at load (/program.ts:3:18)");
  expect(stack).toContain("/program.ts:8:3");
  expect(stack).not.toContain("__validate");
  await run([bunExe(), "build", "--target=bun", "--sourcemap=inline", "--minify", "./program.ts", "--outfile=bundle.js"], String(dir));
  const bundled = await run([bunExe(), "run", "./bundle.js"], String(dir));
  expect(bundled).toContain("(/program.ts:3:18)");
});

test("a type that cannot be validated is an error where the file is compiled", async () => {
  using dir = tempDir("json-parse-unsupported-type", {
    "program.ts": `interface Holder { at: Date; run(): void }\nconsole.log(JSON.parse<Holder>("{}"));\n`,
    "generic.ts": `function load<T>(text: string): T { return JSON.parse<T>(text); }\nconsole.log(load<number>("1"));\n`,
  });
  for (const file of ["./program.ts", "./generic.ts"]) {
    for (const cmd of [[bunExe(), "run", file], [bunExe(), "build", file, "--outfile=bundle.js"]]) {
      await using proc = Bun.spawn({ cmd, cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("a type that cannot be validated");
      expect(exitCode).not.toBe(0);
    }
  }
});

test("the schema follows an edit of the file that declares the type", async () => {
  using dir = tempDir("json-parse-edited-type", {
    "types.ts": `export interface User { id: number }\n`,
    "program.ts": `import type { User } from "./types";\ntry { console.log(JSON.stringify(JSON.parse<User>('{"id":1}'))); } catch (error: any) { console.log(error.message); }\n${"// padding\n".repeat(8000)}`,
  });
  expect(await run([bunExe(), "run", "./program.ts"], String(dir))).toBe('{"id":1}\n');
  await Bun.write(join(String(dir), "types.ts"), `export interface User { id: string }\n`);
  expect(await run([bunExe(), "run", "./program.ts"], String(dir))).toBe("id: Invalid input: expected string, received number\n");
});
