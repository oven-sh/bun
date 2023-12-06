export async function run(path) {
  const jest = Bun.jest(path);
  const { expect, mock } = jest;

  // https://api.qunitjs.com/config/
  const config = {};

  // https://api.qunitjs.com/assert/
  const assert = {
    async(count) {
      throw new Error("Not implemented: async");
    },
    deepEqual(actual, expected) {
      expect(actual).toStrictEqual(expected);
    },
    equal(actual, expected) {
      expect(actual).toEqual(expected);
    },
    expect(amount) {
      // TODO
    },
    false(actual) {
      expect(actual).toBeFalse();
    },
    notDeepEqual(actual, expected) {
      expect(actual).not.toStrictEqual(expected);
    },
    notEqual(actual, expected) {
      expect(actual).not.toEqual(expected);
    },
    notOk(actual) {
      expect(actual).toBeFalsy();
    },
    notPropContains(actual, expected) {
      throw new Error("Not implemented: notPropContains");
    },
    notPropEqual(actual, expected) {
      throw new Error("Not implemented: notPropEqual");
    },
    notStrictEqual(actual, expected) {
      expect(actual).not.toStrictEqual(expected);
    },
    ok(actual) {
      expect(actual).toBeTruthy();
    },
    propContains(actual, expected) {
      throw new Error("Not implemented: propContains");
    },
    propEqual(actual, expected) {
      throw new Error("Not implemented: propEqual");
    },
    pushResult(resultInfo) {
      throw new Error("Not implemented: pushResult");
    },
    rejects(actual, expected) {
      expect(actual).rejects.toThrow(expected);
    },
    step(label) {
      throw new Error("Not implemented: step");
    },
    strictEqual(actual, expected) {
      expect(actual).toStrictEqual(expected);
    },
    throws(actual, expected) {
      expect(actual).toThrow(expected);
    },
    raises(actual, expected) {
      expect(actual).toThrow(expected);
    },
    timeout() {
      // TODO
    },
    true(actual) {
      expect(actual).toBeTrue();
    },
    verifySteps(steps) {
      throw new Error("Not implemented: verifySteps");
    },
  };

  let module = "";
  const QUnit = {
    config,
    test(name, fn) {
      if (module) {
        name = `${module} > ${name}`;
      }
      jest.test(name, () => fn(assert));
    },
    module(name, fn) {
      if (fn) {
        module = "";
        jest.describe(name, () => fn(assert));
      } else {
        module = name;
      }
    },
  };

  for (const fn of Object.values(QUnit)) {
    hideFromStack(fn);
  }

  globalThis.QUnit = QUnit;
  mock.module("qunit", () => {
    const module = {
      default: QUnit,
      ...QUnit,
    };

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
