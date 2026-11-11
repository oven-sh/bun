import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

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

test.if(isWindows)("process.env can be listed after an attempt to keep it from being extended", () => {
  expect(() => Object.preventExtensions(process.env)).toThrow(TypeError);
  expect(() => Object.seal(process.env)).toThrow(TypeError);
  expect(() => Object.freeze(process.env)).toThrow(TypeError);
  expect(Reflect.preventExtensions(process.env)).toBe(false);
  expect(Object.isExtensible(process.env)).toBe(true);

  expect(Object.keys(process.env)).toContain(Object.keys({ ...process.env })[0]);
  process.env.storedBehindTheAttempt = "stored";
  expect(process.env.STOREDBEHINDTHEATTEMPT).toBe("stored");
  expect(Object.keys(process.env).pop()).toBe("storedBehindTheAttempt");
  delete process.env.storedBehindTheAttempt;
});

// A variable is stored under its name in upper case, so that is the name a prototype could take the write for.
test.if(isWindows)("a write of a new variable asks no prototype for its name in upper case", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let calls = 0;
       Object.defineProperty(Object.prototype, "ZZ_INHERITED_ACCESSOR", { get() { calls++; }, set() { calls++; }, configurable: true });
       Object.defineProperty(Object.prototype, "ZZ_INHERITED_VALUE", { value: "same", writable: false, configurable: true });
       process.env.zz_inherited_accessor = "written";
       process.env.zz_inherited_value = "same";
       process.env.__proto__ = "shown";
       const names = ["zz_inherited_accessor", "zz_inherited_value"];
       const child = Bun.spawnSync({
         cmd: [process.execPath, "-e", "console.log(process.env.ZZ_INHERITED_ACCESSOR, process.env.ZZ_INHERITED_VALUE)"],
         env: { ...process.env },
       });
       console.log(JSON.stringify({
         calls,
         own: names.map(name => Object.hasOwn(process.env, name)),
         listed: names.map(name => Object.keys(process.env).includes(name)),
         read: [process.env.ZZ_Inherited_Accessor, process.env.ZZ_Inherited_Value],
         child: [child.stdout.toString().trim(), child.exitCode],
         // The copies that JSON.stringify() and console.log() get.
         copies: [JSON.parse(JSON.stringify(process.env)), process.env[Symbol.for("nodejs.util.inspect.custom")]()].map(
           copy => Object.hasOwn(copy, "__proto__") && copy.__proto__,
         ),
       }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim() || "null"), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
    out: {
      calls: 0,
      own: [true, true],
      listed: [true, true],
      read: ["written", "same"],
      child: ["written same", 0],
      copies: ["shown", "shown"],
    },
    stderr: "",
    exitCode: 0,
  });
});
