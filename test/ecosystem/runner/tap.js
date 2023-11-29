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
    throws(fn, expected) {
      expect(fn).toThrow(expected);
    },
    doesNotThrow(fn, expected) {
      expect(fn).not.toThrow(expected);
    },
    fail(message) {
      expect.fail(message);
    },
    pass(message) {
      // ...
    },
    ok(value) {
      expect(value).toBeTruthy();
    },
    notOk(value) {
      expect(value).toBeFalsy();
    },
    error(err, message) {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe(message);
    },
    match(actual, expected) {
      if (typeof expected === "string" || expected instanceof RegExp) {
        expect(actual).toMatch(expected);
      } else {
        expect(actual).toMatchObject(expected);
      }
    },
    comment(message) {
      // ...
    },
    resolveMatch(fnOrPromise, expected) {
      const promise = typeof fnOrPromise === "function" ? fnOrPromise() : fnOrPromise;
      expect(promise).resolves.toMatch(expected);
    },
    resolveMatchSnapshot(fnOrPromise) {
      const promise = typeof fnOrPromise === "function" ? fnOrPromise() : fnOrPromise;
      expect(promise).resolves.toMatchSnapshot();
    },
    test(name, fn) {
      jest.test(name, () => {
        fn(t);
      });
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
