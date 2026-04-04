import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const source = `
const inject = (target: any) => (value: any, context: any) => {
  console.log('init', target, context.name);
  return function (initValue: any) {
    console.log('get', target, context.name, initValue);
    return initValue;
  };
};

class Test1 {
  @inject('test1') field1!: any = 'test1';
}

class Test2 {
  @inject('test2') field2!: any = 'test2';
}

const test1 = new Test1();
console.log(test1.field1);
`;

const expectedOutput = "init test1 field1\ninit test2 field2\nget test1 field1 test1\ntest1\n";

test("field decorators with two classes in same file - bundled", async () => {
  using dir = tempDir("decorator-28316", {
    "main.ts": source,
  });

  // Bundle
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "main.ts", "--outfile", "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const buildExit = await buildProc.exited;
  expect(buildExit).toBe(0);

  // Run bundled output
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "run", "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);
  expect(stdout).toBe(expectedOutput);
  expect(exitCode).toBe(0);
});

test("field decorators with two classes in same file - no bundle", async () => {
  using dir = tempDir("decorator-28316", {
    "main.ts": source,
  });

  // Transpile without bundling
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "main.ts", "--no-bundle", "--outfile", "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const buildExit = await buildProc.exited;
  expect(buildExit).toBe(0);

  // Run transpiled output
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "run", "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);
  expect(stdout).toBe(expectedOutput);
  expect(exitCode).toBe(0);
});

test("field decorators with three classes in same file - bundled", async () => {
  // Verify uniqueness holds with more than two classes
  using dir = tempDir("decorator-28316-three", {
    "main.ts": `
const log = (tag: string) => (_value: any, context: any) => {
  console.log(tag, context.name);
};

class A { @log('A') x!: any; }
class B { @log('B') y!: any; }
class C { @log('C') z!: any; }

new A(); new B(); new C();
`,
  });

  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "main.ts", "--outfile", "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const buildExit = await buildProc.exited;
  expect(buildExit).toBe(0);

  await using runProc = Bun.spawn({
    cmd: [bunExe(), "run", "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);
  expect(stdout).toBe("A x\nB y\nC z\n");
  expect(exitCode).toBe(0);
});

test("decorated class extending base without explicit constructor - bundled", async () => {
  using dir = tempDir("decorator-28316-extends", {
    "main.ts": `
const noop = (_v: any, _c: any) => {};
class Base { constructor(public x: number) {} }
class Derived extends Base { @noop field!: any; }
const d = new Derived(42);
console.log(d.x);
`,
  });

  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "main.ts", "--outfile", "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const buildExit = await buildProc.exited;
  expect(buildExit).toBe(0);

  await using runProc = Bun.spawn({
    cmd: [bunExe(), "run", "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);
  expect(stdout).toBe("42\n");
  expect(exitCode).toBe(0);
});

test("anonymous decorated class expression preserves Function.prototype.name - bundled", async () => {
  using dir = tempDir("decorator-28316-name", {
    "main.ts": `
const noop = (_v: any, _c: any) => {};
const Foo = class { @noop field!: any; };
console.log(Foo.name);
`,
  });

  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "main.ts", "--outfile", "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const buildExit = await buildProc.exited;
  expect(buildExit).toBe(0);

  await using runProc = Bun.spawn({
    cmd: [bunExe(), "run", "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);
  expect(stdout).toBe("Foo\n");
  expect(exitCode).toBe(0);
});

test("decorated classes with methods don't collide - no bundle", async () => {
  using dir = tempDir("decorator-28316-methods", {
    "main.ts": `
const noop = (_v: any, _c: any) => {};
class A {
  @noop field!: any = 'a';
  method() { return 'A'; }
}
class B {
  @noop field!: any = 'b';
  method() { return 'B'; }
}
const a = new A();
const b = new B();
console.log(a.field, b.field);
`,
  });

  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "main.ts", "--no-bundle", "--outfile", "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const buildExit = await buildProc.exited;
  expect(buildExit).toBe(0);

  await using runProc = Bun.spawn({
    cmd: [bunExe(), "run", "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);
  expect(stdout).toBe("a b\n");
  expect(exitCode).toBe(0);
});
