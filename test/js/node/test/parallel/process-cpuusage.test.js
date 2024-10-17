//#FILE: test-process-cpuUsage.js
//#SHA1: 68c5aeede535139b8caa17340dcad82df9677047
//-----------------
"use strict";

test("process.cpuUsage", () => {
  const result = process.cpuUsage();

  // Validate the result of calling with no previous value argument.
  validateResult(result);

  // Validate the result of calling with a previous value argument.
  validateResult(process.cpuUsage(result));

  // Ensure the results are >= the previous.
  let thisUsage;
  let lastUsage = process.cpuUsage();
  for (let i = 0; i < 10; i++) {
    thisUsage = process.cpuUsage();
    validateResult(thisUsage);
    expect(thisUsage.user).toBeGreaterThanOrEqual(lastUsage.user);
    expect(thisUsage.system).toBeGreaterThanOrEqual(lastUsage.system);
    lastUsage = thisUsage;
  }

  // Ensure that the diffs are >= 0.
  let startUsage;
  let diffUsage;
  for (let i = 0; i < 10; i++) {
    startUsage = process.cpuUsage();
    diffUsage = process.cpuUsage(startUsage);
    validateResult(startUsage);
    validateResult(diffUsage);
    expect(diffUsage.user).toBeGreaterThanOrEqual(0);
    expect(diffUsage.system).toBeGreaterThanOrEqual(0);
  }

  // Ensure that an invalid shape for the previous value argument throws an error.
  expect(() => process.cpuUsage(1)).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.stringContaining(`The "previousValue" argument must be of type object. Received`),
    }),
  );

  // Check invalid types.
  [{}, { user: "a" }, { user: null, system: "c" }].forEach(value => {
    expect(() => process.cpuUsage(value)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.stringContaining(`The "prevValue.user" property must be of type number. Received`),
      }),
    );
  });

  [
    { user: 3, system: "b" },
    { user: 3, system: null },
  ].forEach(value => {
    expect(() => process.cpuUsage(value)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.stringContaining(`The "prevValue.system" property must be of type number. Received`),
      }),
    );
  });

  // Check invalid values.
  [
    { user: -1, system: 2 },
    { user: Number.POSITIVE_INFINITY, system: 4 },
  ].forEach(value => {
    expect(() => process.cpuUsage(value)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        name: "TypeError",
        message: expect.stringContaining(`The property 'prevValue.user' must be a number between 0 and 2^53. Received`),
      }),
    );
  });

  [
    { user: 3, system: -2 },
    { user: 5, system: Number.NEGATIVE_INFINITY },
  ].forEach(value => {
    expect(() => process.cpuUsage(value)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        name: "TypeError",
        message: expect.stringContaining(
          `The property 'prevValue.system' must be a number between 0 and 2^53. Received`,
        ),
      }),
    );
  });
});

// Ensure that the return value is the expected shape.
function validateResult(result) {
  expect(result).not.toBeNull();

  expect(Number.isFinite(result.user)).toBe(true);
  expect(Number.isFinite(result.system)).toBe(true);

  expect(result.user).toBeGreaterThanOrEqual(0);
  expect(result.system).toBeGreaterThanOrEqual(0);
}

//<#END_FILE: test-process-cpuUsage.js
