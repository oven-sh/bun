import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

function filterStderr(stderr: string) {
  return stderr
    .split("\n")
    .filter(line => !line.startsWith("WARNING: ASAN"))
    .join("\n")
    .trim();
}

async function runDecorator(code: string) {
  using dir = tempDir("dec-28010", {
    "test.js": code,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr: filterStderr(rawStderr), exitCode };
}

describe("issue#28010 - decorator initializers mismapped in subclasses", () => {
  test("parent and child class decorators use correct initializers", async () => {
    const { stdout, stderr, exitCode } = await runDecorator(`
      let logs = [];

      function decorate(name) {
        return function (_value, context) {
          return function (initialValue) {
            logs.push(name + ":" + String(context.name) + "=" + initialValue);
            return initialValue;
          }
        }
      }

      class Parent {
        @decorate('Parent.foo') foo = 'parent_foo';
        @decorate('Parent.shared') shared = 'parent_shared';
      }

      class Child extends Parent {
        @decorate('Child.foo') foo = 'child_foo';
        @decorate('Child.childOnly') childOnly = 'child_childOnly';
      }

      new Child();
      console.log(logs.join("\\n"));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      "Parent.foo:foo=parent_foo\n" +
        "Parent.shared:shared=parent_shared\n" +
        "Child.foo:foo=child_foo\n" +
        "Child.childOnly:childOnly=child_childOnly\n",
    );
    expect(exitCode).toBe(0);
  });

  test("multiple independent decorated classes in same scope", async () => {
    const { stdout, stderr, exitCode } = await runDecorator(`
      let logs = [];

      function track(name) {
        return function (_value, context) {
          return function (initialValue) {
            logs.push(name + "=" + initialValue);
            return initialValue;
          }
        }
      }

      class A {
        @track('A.x') x = 'a';
      }

      class B {
        @track('B.y') y = 'b';
      }

      class C {
        @track('C.z') z = 'c';
      }

      new A();
      new B();
      new C();
      console.log(logs.join("\\n"));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("A.x=a\nB.y=b\nC.z=c\n");
    expect(exitCode).toBe(0);
  });

  test("decorated class expression in same scope as decorated class statement", async () => {
    const { stdout, stderr, exitCode } = await runDecorator(`
      let logs = [];

      function track(name) {
        return function (_value, context) {
          return function (initialValue) {
            logs.push(name + "=" + initialValue);
            return initialValue;
          }
        }
      }

      class Stmt {
        @track('Stmt.a') a = '1';
      }

      const Expr = class {
        @track('Expr.b') b = '2';
      };

      new Stmt();
      new Expr();
      console.log(logs.join("\\n"));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("Stmt.a=1\nExpr.b=2\n");
    expect(exitCode).toBe(0);
  });
});
