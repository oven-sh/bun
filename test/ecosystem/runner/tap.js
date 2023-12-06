import { spawnSync } from "bun";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";

export async function run(path) {
  const jest = Bun.jest(path);
  const { expect, mock } = jest;

  // https://node-tap.org/api/
  // https://github.com/tapjs/tapjs/blob/511019b2ac0fa014370154c3a341a0e632f50b19/src/asserts/src/index.ts
  const t = {
    plan(count) {
      // expect.assertions(count);
    },
    equal(actual, expected) {
      expect(actual).toBe(expected);
    },
    notEqual(actual, expected) {
      expect(actual).not.toBe(expected);
    },
    deepEqual(actual, expected) {
      expect(actual).toEqual(expected);
    },
    notDeepEqual(actual, expected) {
      expect(actual).not.toEqual(expected);
    },
    fail(message) {
      expect.fail(message);
    },
    pass(message) {
      // ...
    },
    // https://github.com/tapjs/tapjs/blob/511019b2ac0fa014370154c3a341a0e632f50b19/src/asserts/src/index.ts
    ok(value) {
      expect(value).toBeTruthy();
    },
    notOk(value) {
      expect(value).toBeFalsy();
    },
    equal(actual, expected) {
      expect(actual).toBe(expected);
    },
    not(actual, expected) {
      expect(actual).not.toBe(expected);
    },
    type(actual, expected) {
      if (actual in ["undefined", "boolean", "number", "string", "symbol", "function", "object"]) {
        expect(typeof actual).toBe(expected);
      } else {
        expect(actual).toBeInstanceOf(expected);
      }
    },
    same(actual, expected) {
      expect(actual).toEqual(expected);
    },
    notSame(actual, expected) {
      expect(actual).not.toEqual(expected);
    },
    strictSame(actual, expected) {
      expect(actual).toStrictEqual(expected);
    },
    strictNotSame(actual, expected) {
      expect(actual).not.toStrictEqual(expected);
    },
    has(actual, expected) {
      throw new Error("Not implemented: has");
    },
    notHas(actual, expected) {
      throw new Error("Not implemented: notHas");
    },
    hasStrict(actual, expected) {
      throw new Error("Not implemented: hasStrict");
    },
    notHasStrict(actual, expected) {
      throw new Error("Not implemented: notHasStrict");
    },
    match(actual, expected) {
      if (typeof expected === "string" || expected instanceof RegExp) {
        expect(actual).toMatch(expected);
      } else {
        expect(actual).toMatchObject(expected);
      }
    },
    notMatch(actual, expected) {
      if (typeof expected === "string" || expected instanceof RegExp) {
        expect(actual).not.toMatch(expected);
      } else {
        expect(actual).not.toMatchObject(expected);
      }
    },
    matchOnly(actual, expected) {
      throw new Error("Not implemented: matchOnly");
    },
    notMatchOnly(actual, expected) {
      throw new Error("Not implemented: notMatchOnly");
    },
    matchOnlyStrict(actual, expected) {
      throw new Error("Not implemented: matchOnlyStrict");
    },
    notMatchOnlyStrict(actual, expected) {
      throw new Error("Not implemented: notMatchOnlyStrict");
    },
    matchStrict(actual, expected) {
      throw new Error("Not implemented: matchStrict");
    },
    notMatchStrict(actual, expected) {
      throw new Error("Not implemented: notMatchStrict");
    },
    hasProp(actual, expected) {
      throw new Error("Not implemented: hasProp");
    },
    hasOwnProp(actual, expected) {
      throw new Error("Not implemented: hasOwnProp");
    },
    hasProps(actual, expected) {
      throw new Error("Not implemented: hasProps");
    },
    hasOwnProps(actual, expected) {
      throw new Error("Not implemented: hasOwnProps");
    },
    hasOwnPropsOnly(actual, expected) {
      throw new Error("Not implemented: hasOwnPropsOnly");
    },
    throws(fn, expected) {
      expect(fn).toThrow(expected);
    },
    doesNotThrow(fn, expected) {
      expect(fn).not.toThrow(expected);
    },
    rejects(fnOrPromise, expected) {
      const promise = typeof fnOrPromise === "function" ? fnOrPromise() : fnOrPromise;
      expect(promise).rejects.toThrow(expected);
    },
    resolves(fnOrPromise, expected) {
      const promise = typeof fnOrPromise === "function" ? fnOrPromise() : fnOrPromise;
      expect(promise).resolves.toEqual(expected);
    },
    resolveMatch(fnOrPromise, expected) {
      const promise = typeof fnOrPromise === "function" ? fnOrPromise() : fnOrPromise;
      expect(promise).resolves.toMatch(expected);
    },
    emits(emitter, event) {
      throw new Error("Not implemented: emits");
    },
    error(err) {
      expect(err).toBeInstanceOf(Error);
    },
    // https://github.com/tapjs/tapjs/blob/511019b2ac0fa014370154c3a341a0e632f50b19/src/mock/src/index.ts
    mock(name, mocks) {
      jest.mock(name, mocks);
      return require(name);
    },
    mockImport(name, mocks) {
      jest.mock(name, mocks);
      return import(name);
    },
    mockRequire(name, mocks) {
      jest.mock(name, mocks);
      return require(name);
    },
    mockAll(name, mocks) {
      jest.mock(name, mocks);
    },
    // https://github.com/tapjs/tapjs/blob/main/src/snapshot/src/index.ts
    matchSnapshot(expected) {
      expect(expected).toMatchSnapshot();
    },
    resolveMatchSnapshot(fnOrPromise) {
      const promise = typeof fnOrPromise === "function" ? fnOrPromise() : fnOrPromise;
      expect(promise).resolves.toMatchSnapshot();
    },
    // https://github.com/tapjs/tapjs/tree/511019b2ac0fa014370154c3a341a0e632f50b19/src/fixture
    fixture(type, content) {
      return {
        type,
        content,
      };
    },
    testdir(content) {
      const cwd = mkdtempSync(join(tmpdir(), "tap-testdir-"));
      const write = (path, content) => {
        if (typeof content === "string") {
          writeFileSync(join(cwd, path), content);
        } else if (typeof content === "object") {
          if ("type" in content && "content" in content) {
            const { type, content: value } = content;
            if (type === "file") {
              writeFileSync(join(cwd, path), content);
            } else if (type === "dir") {
              mkdirSync(join(cwd, path));
            } else if (type === "symlink") {
              symlinkSync(join(cwd, path), value);
            } else if (type === "link") {
              linkSync(join(cwd, path), value);
            } else {
              throw new Error(`Not implemented fixture: ${type}`);
            }
          } else {
            if (path) {
              mkdirSync(join(cwd, path));
            }
            for (const [filename, entry] of Object.entries(content)) {
              write(join(path, filename), entry);
            }
          }
        }
      };
      write("", content);
    },
    // https://github.com/tapjs/tapjs/tree/511019b2ac0fa014370154c3a341a0e632f50b19/src/spawn
    spawn(cmd, args, { cwd, env }) {
      spawnSync({
        cmd: [cmd, ...args],
        cwd,
        env,
      });
    },
    // ...
    comment(message) {
      // ...
    },
    test(name, fn, options) {
      // if (typeof fn !== "function") {
      //   if (fn.skip) {
      //     jest.skip(name, () => {});
      //     return;
      //   }
      //   fn = options;
      // }
      jest.test(name, () => {
        fn(t);
      });
    },
    before(fn) {
      jest.beforeAll(() => fn(t));
    },
    beforeEach(fn) {
      jest.beforeEach(() => fn(t));
    },
    after(fn) {
      jest.afterAll(() => fn(t));
    },
    afterEach(fn) {
      jest.afterEach(() => fn(t));
    },
    teardown(fn) {
      jest.afterAll(() => fn(t));
    },
    end() {
      // ...
    },
  };

  for (const fn of Object.values(t)) {
    hideFromStack(fn);
  }

  mock.module("tap", () => {
    const module = {
      default: t,
      ...t,
    };

    for (const fn of Object.values(module)) {
      hideFromStack(fn);
    }

    return module;
  });

  await import(path);
}

function hideFromStack(fn) {
  Object.defineProperty(fn, "name", {
    value: "::bunternal::",
    configurable: true,
    enumerable: true,
    writable: true,
  });
}
