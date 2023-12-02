export async function run(path) {
  const jest = Bun.jest(path);
  const { expect, mock } = jest;

  // https://github.com/lukeed/uvu/blob/master/docs/api.uvu.md
  const suite = (name, context, fn) => {
    if (typeof context === "function") {
      fn = context;
      context = {};
    }
    const tests = [];
    const skips = [];
    const onlys = [];
    const beforeAlls = [];
    const beforeEachs = [];
    const afterAlls = [];
    const afterEachs = [];
    const result = {
      name,
      context,
      test(name, fn) {
        tests.push([name, fn]);
        return result;
      },
      skip(name, fn) {
        skips.push([name, fn]);
        return result;
      },
      only(name, fn) {
        onlys.push([name, fn]);
        return result;
      },
      before: createCallable({
        default: fn => beforeAlls.push(fn),
        each: fn => beforeEachs.push(fn),
      }),
      after: createCallable({
        default: fn => afterAlls.push(fn),
        each: fn => afterEachs.push(fn),
      }),
      run() {
        jest.describe(name, () => {
          if (typeof fn === "function") {
            fn(context);
          }
          for (const fn of beforeAlls) {
            jest.beforeAll(() => fn(context));
          }
          for (const fn of beforeEachs) {
            jest.beforeEach(() => fn(context));
          }
          for (const fn of afterAlls) {
            jest.afterAll(() => fn(context));
          }
          for (const fn of afterEachs) {
            jest.afterEach(() => fn(context));
          }
          for (const [name, fn] of tests) {
            jest.test(name, () => fn(context));
          }
          for (const [name, fn] of skips) {
            jest.test.skip(name, () => fn(context));
          }
          for (const [name, fn] of onlys) {
            jest.test.only(name, () => fn(context));
          }
        });
      },
    };

    for (const fn of Object.values(result)) {
      if (typeof fn === "function") {
        hideFromStack(fn);
      }
    }

    return result;
  };

  // https://github.com/lukeed/uvu/blob/master/docs/api.assert.md
  const assert = {
    ok: value => {
      expect(value).toBeTruthy();
    },
    is: createCallable({
      default: (value, expected) => expect(value).toBe(expected),
      not: (value, expected) => expect(value).not.toBe(expected),
    }),
    equal: (value, expected) => {
      expect(value).toEqual(expected);
    },
    type: (value, expected) => {
      expect(typeof value).toBe(expected);
    },
    instance: (value, expected) => {
      expect(value).toBeInstanceOf(expected);
    },
    match: (value, expected) => {
      expect(value).toMatch(expected);
    },
    snapshot: (value, expected) => {
      expect(value).toBe(expected); // ?
    },
    fixture: (value, expected) => {
      expect(value).toBe(expected); // ?
    },
    throws: (fn, expected) => {
      if (!expected) {
        expect(fn).toThrow();
      } else if (typeof expected === "string" || expected instanceof RegExp) {
        expect(fn).toThrow(expected);
      } else if (typeof expected === "function") {
        try {
          fn();
        } catch (error) {
          if (!expected(error)) {
            throw error;
          }
        }
      } else {
        expect.unreachable();
      }
    },
    unreachable: () => {
      expect.unreachable();
    },
    not: createCallable({
      default: value => expect(value).toBeFalsy(),
      ok: value => expect(value).toBeFalsy(),
      equal: (value, expected) => expect(value).not.toEqual(expected),
      type: (value, expected) => expect(typeof value).not.toBe(expected),
      instance: (value, expected) => expect(value).not.toBeInstanceOf(expected),
      match: (value, expected) => expect(value).not.toMatch(expected),
      snapshot: (value, expected) => expect(value).not.toBe(expected), // ?
      fixture: (value, expected) => expect(value).not.toBe(expected), // ?
      throws: (fn, expected) => {
        if (!expected) {
          expect(fn).not.toThrow();
        } else if (typeof expected === "string" || expected instanceof RegExp) {
          expect(fn).not.toThrow(expected);
        } else if (typeof expected === "function") {
          try {
            fn();
          } catch (error) {
            if (expected(error)) {
              throw error;
            }
          }
        } else {
          expect.unreachable();
        }
      },
    }),
  };

  for (const fn of Object.values(assert)) {
    hideFromStack(fn);
  }

  mock.module("uvu", () => {
    return {
      suite: (name, fn) => {
        const result = suite(name, fn);
        return createCallable({
          default: (name, fn) => result.test(name, fn),
          ...result,
        });
      },
      test: (name, fn) => suite("").test(name, fn),
    };
  });

  mock.module("uvu/assert", () => {
    return {
      default: assert,
      ...assert,
    };
  });

  await import(path);
}

function createCallable(options) {
  const { default: fn, ...fns } = options;
  let result = (...args) => fn(...args);
  for (const [name, fn] of Object.entries(fns)) {
    if (typeof fn === "function") {
      result[name] = fn;
    }
  }
  return result;
}

function hideFromStack(fn) {
  Object.defineProperty(fn, "name", {
    value: "::bunternal::",
    configurable: true,
    enumerable: true,
    writable: true,
  });
}
