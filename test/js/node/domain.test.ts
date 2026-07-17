import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/30672
// Exceptions thrown inside `setTimeout` callbacks scheduled while a
// domain is active should be routed to the domain's `'error'` handler.
test.concurrent("domain catches setTimeout callback throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const domain = require("domain").create();
      domain.on("error", err => {
        console.log("domain caught:", err.message);
      });
      domain.run(() => {
        setTimeout(() => {
          throw new Error("boom");
        }, 1);
      });
      setTimeout(() => {
        console.log("still alive");
      }, 20);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "domain caught: boom\nstill alive\n",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("domain catches setImmediate callback throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const domain = require("domain").create();
      domain.on("error", err => {
        console.log("caught:", err.message);
      });
      domain.run(() => {
        setImmediate(() => {
          throw new Error("immediate-boom");
        });
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "caught: immediate-boom\n",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("domain catches setInterval callback throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const domain = require("domain").create();
      let count = 0;
      domain.on("error", err => {
        count++;
        console.log("caught:", err.message, count);
        if (count >= 2) process.exit(0);
      });
      let handle;
      domain.run(() => {
        handle = setInterval(() => {
          throw new Error("tick");
        }, 5);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("caught: tick 1");
  expect(stdout).toContain("caught: tick 2");
  expect(exitCode).toBe(0);
});

test.concurrent("domain.run synchronous throw is caught", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const domain = require("domain").create();
      domain.on("error", err => {
        console.log("caught:", err.message);
      });
      domain.run(() => {
        throw new Error("sync");
      });
      console.log("after");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "caught: sync\nafter\n",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("domain maintains correct active domain across nested run()", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const domain = require("domain");
      const d1 = domain.create();
      const d2 = domain.create();
      d1.on("error", err => console.log("d1:", err.message));
      d2.on("error", err => console.log("d2:", err.message));
      d1.run(() => {
        console.log("in d1, active is d1:", domain.active === d1);
        d2.run(() => {
          console.log("in d2, active is d2:", domain.active === d2);
          setTimeout(() => { throw new Error("inner-boom"); }, 5);
        });
        console.log("back in d1, active is d1:", domain.active === d1);
      });
      console.log("outside, active is null:", domain.active === null);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout:
      "in d1, active is d1: true\n" +
      "in d2, active is d2: true\n" +
      "back in d1, active is d1: true\n" +
      "outside, active is null: true\n" +
      "d2: inner-boom\n",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("domain.bind wraps a function to route throws through the domain", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const domain = require("domain").create();
      domain.on("error", err => console.log("caught:", err.message));
      const bound = domain.bind(() => {
        throw new Error("bound-boom");
      });
      bound();
      console.log("after");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "caught: bound-boom\nafter\n",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("process.domain reflects the currently-active domain", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const domain = require("domain");
      const d = domain.create();
      console.log("before:", process.domain);
      d.run(() => {
        console.log("during:", process.domain === d);
      });
      console.log("after:", process.domain);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "before: null\nduring: true\nafter: null\n",
    stderr: "",
    exitCode: 0,
  });
});

// Regression guard: an earlier draft of this fix attached a
// `process.on("uncaughtException")` listener from `domain`. Because Bun treats
// any such listener as "the error was handled", it caused every uncaught
// exception — including ones thrown completely outside any domain — to be
// silently swallowed once `domain` had been required anywhere in the process.
// Requiring `domain` must not change the default crash behavior for code that
// runs outside a domain.
test.concurrent("requiring domain does not suppress unrelated uncaught exceptions", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      require("domain").create();
      setTimeout(() => { throw new Error("should crash"); }, 1);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("should crash");
  expect(exitCode).not.toBe(0);
});

// Patching the global timers must not drop their own properties, notably the
// nodejs.util.promisify.custom symbol that makes util.promisify(setTimeout)
// return the timers/promises implementation.
test.concurrent("patched timers keep util.promisify working", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const util = require("util");
      require("domain").create();
      const custom = typeof setTimeout[Symbol.for("nodejs.util.promisify.custom")];
      const wait = util.promisify(setTimeout);
      const start = Date.now();
      await wait(30);
      console.log("custom:", custom);
      console.log("waited:", Date.now() - start >= 25);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "custom: function\nwaited: true\n",
    stderr: "",
    exitCode: 0,
  });
});

// Match node: the domain is exited before its 'error' handler runs. A timer
// scheduled inside the handler must NOT be bound to the failed domain, so a
// handler that retries throwing work crashes on the retry instead of looping
// through the domain forever. The error is also tagged as thrown.
test.concurrent("domain error handler runs outside the domain", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const domain = require("domain").create();
      domain.on("error", err => {
        console.log("active in handler:", process.domain === null);
        console.log("domainThrown:", err.domainThrown);
        setTimeout(() => { throw new Error("second"); }, 1);
      });
      domain.run(() => {
        setTimeout(() => { throw new Error("first"); }, 1);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("active in handler: true\ndomainThrown: true\n");
  expect(stderr).toContain("second");
  expect(exitCode).not.toBe(0);
});

// A frozen / non-extensible thrown value cannot be decorated with the
// domain / domainThrown properties, but must still reach the handler.
test.concurrent("domain routes frozen thrown values to the handler", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const domain = require("domain").create();
      domain.on("error", err => {
        console.log("caught:", err.message);
      });
      domain.run(() => {
        setTimeout(() => {
          throw Object.freeze(new Error("frozen-boom"));
        }, 1);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "caught: frozen-boom\n",
    stderr: "",
    exitCode: 0,
  });
});
