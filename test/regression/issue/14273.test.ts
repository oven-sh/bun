import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/14273
// In strict mode, duplicate plain function declarations in a block scope
// should be a SyntaxError (they behave like `let` bindings per ES2015+ spec).

test("strict mode: duplicate function declarations in block scope is SyntaxError", async () => {
  const cases = [
    // Basic block scope
    `"use strict"; { function f(){} function f(){} }`,
    // Nested block
    `"use strict"; { { function f(){} function f(){} } }`,
    // Inside if
    `"use strict"; if(true){ function f(){} function f(){} }`,
    // Inside for
    `"use strict"; for(;;){ function f(){} function f(){} break; }`,
    // Inside switch case
    `"use strict"; switch(1){ case 1: function f(){} function f(){} }`,
    // Function body with "use strict"
    `function outer(){ "use strict"; { function f(){} function f(){} } }`,
  ];

  for (const code of cases) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect({
      code,
      exitCode,
      hasError: stderr.includes("has already been declared"),
    }).toEqual({
      code,
      exitCode: 1,
      hasError: true,
    });
  }
}, 30_000);

test("sloppy mode: duplicate function declarations in block scope is allowed", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `{ function f(){} function f(){} }`],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("strict mode: duplicate async function declarations in block scope is SyntaxError", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `"use strict"; { async function f(){} async function f(){} }`],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toInclude("has already been declared");
  expect(exitCode).toBe(1);
});

test("strict mode: duplicate generator function declarations in block scope is SyntaxError", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `"use strict"; { function* f(){} function* f(){} }`],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toInclude("has already been declared");
  expect(exitCode).toBe(1);
});

test("strict mode: duplicate function declarations at top level is allowed", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `"use strict"; function f(){} function f(){}`],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("strict mode: duplicate var declarations in block scope is allowed", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `"use strict"; { var x = 1; var x = 2; }`],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
