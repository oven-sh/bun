import { test, expect } from "bun:test";
import { isWindows } from "harness";

test.if(isWindows)("process.env is case insensitive on windows", () => {
  const keys = Object.keys(process.env);
  // this should have at least one character that is lowercase
  // it is likely that PATH will be 'Path', and also stuff like 'WindowsLibPath' and so on.
  // but not guaranteed, so we just check that there is at least one of each case
  expect(
    keys
      .join("")
      .split("")
      .some(c => c.toUpperCase() !== c),
  ).toBe(true);
  expect(
    keys
      .join("")
      .split("")
      .some(c => c.toLowerCase() !== c),
  ).toBe(true);
  expect(process.env.path).toBe(process.env.PATH!);
  expect(process.env.pAtH).toBe(process.env.PATH!);

  expect(process.env.doesntexistahahahahaha).toBeUndefined();
  // @ts-expect-error
  process.env.doesntExistAHaHaHaHaHa = true;
  expect(process.env.doesntexistahahahahaha).toBe("true");
  expect(process.env.doesntexistahahahahaha).toBe("true");
  expect(process.env.doesnteXISTahahahahaha).toBe("true");
  expect(Object.keys(process.env).pop()).toBe("doesntExistAHaHaHaHaHa");
  delete process.env.DOESNTEXISTAHAHAHAHAHA;
  expect(process.env.doesntexistahahahahaha).toBeUndefined();
  expect(Object.keys(process.env)).not.toInclude("doesntExistAHaHaHaHaHa");
});
