import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("useDefineForClassFields: false strips type-only fields", async () => {
  using dir = tempDir("issue-2060", {
    "index.ts": `
class Base {
  constructor(data: any) {
    Object.assign(this, data);
  }
}

class Outer extends Base {
  stuff: string;
  things: number;
  extra: any;
}

class Inner extends Base {
  more: string;
  greatness: boolean;
}

let outer = new Outer({
  stuff: "Hello World",
  things: 42,
  extra: new Inner({
    more: "Bun is becoming great!",
    greatness: true
  })
});

console.log(JSON.stringify(outer));
`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        useDefineForClassFields: false,
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.stuff).toBe("Hello World");
  expect(result.things).toBe(42);
  expect(result.extra.more).toBe("Bun is becoming great!");
  expect(result.extra.greatness).toBe(true);
  expect(exitCode).toBe(0);
});

test("useDefineForClassFields: false moves initialized fields to constructor", async () => {
  using dir = tempDir("issue-2060-init", {
    "index.ts": `
class Foo {
  x: number = 42;
  y: string = "hello";
  constructor() {
    // With useDefineForClassFields: false, field initializers
    // should be moved into the constructor as assignments.
  }
}

const foo = new Foo();
console.log(JSON.stringify({ x: foo.x, y: foo.y }));
`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        useDefineForClassFields: false,
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.x).toBe(42);
  expect(result.y).toBe("hello");
  expect(exitCode).toBe(0);
});

test("useDefineForClassFields: false - fields don't override parent constructor assignments", async () => {
  using dir = tempDir("issue-2060-override", {
    "index.ts": `
class Base {
  constructor(data: Record<string, any>) {
    Object.assign(this, data);
  }
}

class Child extends Base {
  name: string;
  value: number;
}

const child = new Child({ name: "test", value: 123 });
// With useDefineForClassFields: false, type-only fields should be stripped,
// so Object.assign values should be preserved (not overwritten to undefined).
console.log(JSON.stringify({ name: child.name, value: child.value }));
`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        useDefineForClassFields: false,
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.name).toBe("test");
  expect(result.value).toBe(123);
  expect(exitCode).toBe(0);
});

test("useDefineForClassFields: true (default) keeps fields in class body", async () => {
  using dir = tempDir("issue-2060-default", {
    "index.ts": `
class Base {
  constructor(data: any) {
    Object.assign(this, data);
  }
}

class Child extends Base {
  name: string;
}

const child = new Child({ name: "test" });
// With useDefineForClassFields: true (default), type-only fields remain,
// causing them to be initialized to undefined, overwriting Object.assign values.
console.log(JSON.stringify({ name: child.name }));
`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        useDefineForClassFields: true,
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // With define semantics, the field declaration overwrites the parent's assignment
  const result = JSON.parse(stdout.trim());
  expect(result.name).toBeUndefined();
  expect(exitCode).toBe(0);
});

test("useDefineForClassFields: false - transpile output strips type-only fields", async () => {
  using dir = tempDir("issue-2060-build", {
    "index.ts": `
class Foo {
  name: string;
  value: number;
  method() { return 1; }
}
`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        useDefineForClassFields: false,
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Type-only fields should not appear in the output
  expect(stdout).not.toContain("name;");
  expect(stdout).not.toContain("value;");
  // Method should still be present
  expect(stdout).toContain("method()");
  expect(exitCode).toBe(0);
});

test("useDefineForClassFields: false keeps static fields", async () => {
  using dir = tempDir("issue-2060-static", {
    "index.ts": `
class Foo {
  static count: number = 0;
  name: string;
}

console.log(JSON.stringify({ count: Foo.count }));
`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        useDefineForClassFields: false,
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.count).toBe(0);
  expect(exitCode).toBe(0);
});
