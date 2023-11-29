export async function run(path) {
  const jest = Bun.jest(path);
  const { expect, mock } = jest;

  // https://github.com/avajs/ava/blob/main/docs/03-assertions.md
  const t = {
    is(actual, expected) {
      expect(actual).toBe(expected);
    },
    not(actual, expected) {
      expect(actual).not.toBe(expected);
    },
    deepEqual(actual, expected) {
      expect(actual).toEqual(expected);
    },
    throws(fn, expected) {
      if (expected.message) {
        expect(fn).toThrow(expected.message);
      } else {
        expect(fn).toThrow(expected);
      }
    },
  };

  for (const fn of Object.values(t)) {
    hideFromStack(fn);
  }

  mock.module("ava", () => {
    return {
      default: (title, fn) => {
        jest.test(title, async () => {
          await fn(t);
        });
      },
    };
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
