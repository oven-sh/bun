// https://github.com/oven-sh/bun/issues/7780
//
// Class methods should appear in stack traces with the owning class name
// prefixed, matching V8/Node (`MyClass.method` rather than bare `method`).
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function runFixture(source: string): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode).toBe(0);
  // console.trace writes to stderr.
  return stderr + stdout;
}

test("console.trace inside a class method prefixes the class name", async () => {
  const output = await runFixture(`
    class MyClass {
      method() {
        console.trace("here");
      }
    }
    new MyClass().method();
  `);
  expect(output).toContain("at MyClass.method (");
  // and NOT the bare name
  expect(output).not.toMatch(/\bat method \(/);
});

test("error.stack from a throwing class method prefixes the class name", async () => {
  const output = await runFixture(`
    class MyClass {
      method() {
        throw new Error("boom");
      }
    }
    try {
      new MyClass().method();
    } catch (e) {
      console.log(e.stack);
    }
  `);
  expect(output).toContain("at MyClass.method (");
});

test("static methods get the class prefix", async () => {
  const output = await runFixture(`
    class MyClass {
      static staticMethod() {
        throw new Error("boom");
      }
    }
    try {
      MyClass.staticMethod();
    } catch (e) {
      console.log(e.stack);
    }
  `);
  expect(output).toContain("at MyClass.staticMethod (");
});

test("async class methods get the class prefix", async () => {
  const output = await runFixture(`
    class MyClass {
      async method() {
        throw new Error("boom");
      }
    }
    (async () => {
      try {
        await new MyClass().method();
      } catch (e) {
        console.log(e.stack);
      }
    })();
  `);
  expect(output).toContain("at MyClass.method (");
});

test("getter methods get the class prefix", async () => {
  const output = await runFixture(`
    class MyClass {
      get answer() {
        throw new Error("boom");
      }
    }
    try {
      new MyClass().answer;
    } catch (e) {
      console.log(e.stack);
    }
  `);
  // Node prints "at MyClass.get answer" — we accept either that or just
  // "MyClass.answer", but we must have the class prefix.
  expect(output).toMatch(/at MyClass\.(?:get )?answer /);
});

test("class with extends still resolves the declaring class name", async () => {
  const output = await runFixture(`
    class Base {}
    class MyClass extends Base {
      method() {
        throw new Error("boom");
      }
    }
    try {
      new MyClass().method();
    } catch (e) {
      console.log(e.stack);
    }
  `);
  expect(output).toContain("at MyClass.method (");
});

test("class constructor frame is unchanged (still shows class name)", async () => {
  const output = await runFixture(`
    class MyClass {
      constructor() {
        throw new Error("boom");
      }
    }
    try {
      new MyClass();
    } catch (e) {
      console.log(e.stack);
    }
  `);
  // Constructor frame already rendered as "new MyClass" or "MyClass" in Bun
  // — make sure we didn't regress to "MyClass.MyClass" or similar.
  expect(output).toContain("new MyClass");
  expect(output).not.toContain("MyClass.MyClass");
});

test("plain function inside the same file is not falsely prefixed", async () => {
  const output = await runFixture(`
    function outer() {
      throw new Error("boom");
    }
    try {
      outer();
    } catch (e) {
      console.log(e.stack);
    }
  `);
  expect(output).toContain("at outer (");
  expect(output).not.toMatch(/\.outer \(/);
});

test("anonymous class expression produces no bogus prefix", async () => {
  const output = await runFixture(`
    const Anon = class {
      method() {
        throw new Error("boom");
      }
    };
    try {
      new Anon().method();
    } catch (e) {
      console.log(e.stack);
    }
  `);
  // We can't infer a class name for an anonymous class expression from
  // the source. Accept either "at method" or "at Anon.method" (if Bun's
  // function.name propagation ever gets smarter), but NOT a wrong prefix.
  expect(output).toMatch(/at (?:Anon\.)?method \(/);
});

test("methods on two different classes keep their own prefixes", async () => {
  const output = await runFixture(`
    class First {
      go() { throw new Error("first"); }
    }
    class Second {
      go() { throw new Error("second"); }
    }
    try { new First().go(); } catch (e) { console.log(e.stack); }
    try { new Second().go(); } catch (e) { console.log(e.stack); }
  `);
  expect(output).toContain("at First.go (");
  expect(output).toContain("at Second.go (");
});
