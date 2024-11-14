//#FILE: test-child-process-fork-args.js
//#SHA1: 172297ab2ed7887ced1b830b8c36d2d6a508deed
//-----------------
"use strict";
const fixtures = require("../common/fixtures");
const { fork } = require("child_process");

// This test check the arguments of `fork` method
// Refs: https://github.com/nodejs/node/issues/20749
const expectedEnv = { foo: "bar" };

// Ensure that first argument `modulePath` must be provided
// and be of type string
test("fork modulePath argument must be a string", () => {
  const invalidModulePath = [0, true, undefined, null, [], {}, () => {}, Symbol("t")];
  invalidModulePath.forEach(modulePath => {
    expect(() => fork(modulePath)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.stringMatching(/^The "modulePath" argument must be of type string/),
      }),
    );
  });
});

test("fork with valid modulePath", done => {
  const cp = fork(fixtures.path("child-process-echo-options.js"));
  cp.on("exit", code => {
    expect(code).toBe(0);
    done();
  });
});

// Ensure that the second argument of `fork`
// and `fork` should parse options
// correctly if args is undefined or null
test("fork second argument validation", () => {
  const invalidSecondArgs = [0, true, () => {}, Symbol("t")];
  invalidSecondArgs.forEach(arg => {
    expect(() => {
      fork(fixtures.path("child-process-echo-options.js"), arg);
    }).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
      }),
    );
  });
});

test("fork with valid second argument", async () => {
  const argsLists = [undefined, null, []];

  for (const args of argsLists) {
    const cp = fork(fixtures.path("child-process-echo-options.js"), args, {
      env: { ...process.env, ...expectedEnv },
    });

    await new Promise(resolve => {
      cp.on("message", ({ env }) => {
        expect(env.foo).toBe(expectedEnv.foo);
      });

      cp.on("exit", code => {
        expect(code).toBe(0);
        resolve();
      });
    });
  }
});

// Ensure that the third argument should be type of object if provided
test("fork third argument must be an object if provided", () => {
  const invalidThirdArgs = [0, true, () => {}, Symbol("t")];
  invalidThirdArgs.forEach(arg => {
    expect(() => {
      fork(fixtures.path("child-process-echo-options.js"), [], arg);
    }).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
      }),
    );
  });
});

//<#END_FILE: test-child-process-fork-args.js
