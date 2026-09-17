import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// tbh, we should have more tests for this
test("Symbol.dispose exists", () => {
  expect(Symbol.dispose).toBeDefined();
  expect(Symbol.dispose).toBeSymbol();
  expect(Symbol.asyncDispose).toBeDefined();
  expect(Symbol.asyncDispose).toBeSymbol();
});

test("SuppressedError works", () => {
  const e = new SuppressedError(new Error("this is error"), new Error("this was suppressed"), "this is a message");
  expect(e.message).toBe("this is a message");
  expect(() => {
    throw e.suppressed;
  }).toThrow("this was suppressed");
  expect(() => {
    throw e.error;
  }).toThrow("this is error");
});

let disposeOrder = 0;
function useWithAsync() {
  return {
    status: "none",
    disposeOrder: -1,
    [Symbol.dispose]() {
      this.status = "disposed";
      this.disposeOrder = disposeOrder++;
    },
    [Symbol.asyncDispose]() {
      this.status = "async-disposed";
      this.disposeOrder = disposeOrder++;
    },
  };
}

test("using syntax works and doesnt collide with user symbols", () => {
  disposeOrder = 0;
  {
    let __using = "break";
    let __callDispose = function () {
      throw new Error("should not be called");
    };
    let __stack = {
      push: () => {
        throw new Error("stack corruption");
      },
    };

    const a1 = useWithAsync();
    {
      using u1 = a1;
      expect(u1.status).toBe("none");
    }
    expect(a1.status).toBe("disposed");
  }

  {
    const a1 = useWithAsync();
    const a2 = useWithAsync();
    const a3 = useWithAsync();
    {
      using u1 = a1,
        u2 = a2;
      {
        using u3 = a3;
        expect(u3.status).toBe("none");
      }
      expect(u1.status).toBe("none");
      expect(u2.status).toBe("none");
      expect(a3.status).toBe("disposed");
    }
    expect(a1.status).toBe("disposed");
    expect(a2.status).toBe("disposed");

    expect(a3.disposeOrder).toBe(1);
    expect(a2.disposeOrder).toBe(2);
    expect(a1.disposeOrder).toBe(3);
  }

  const a1 = useWithAsync();
  {
    using u1 = a1;
    {
      var __stack = 1;
      var _catch = 1;
      var _err = 1;
      var _hasErr = 1;
    }
  }
});

test("await using syntax works and doesnt collide with user symbols", async () => {
  disposeOrder = 0;
  {
    let __using = "break";
    let __callDispose = function () {
      throw new Error("should not be called");
    };
    let __stack = {
      push: () => {
        throw new Error("stack corruption");
      },
    };

    const a1 = useWithAsync();
    {
      using u1 = a1;
      expect(u1.status).toBe("none");
    }
    expect(a1.status).toBe("disposed");
  }

  {
    const a1 = useWithAsync();
    const a2 = useWithAsync();
    const a3 = useWithAsync();
    {
      using u1 = a1;
      await using u2 = a2;
      {
        using u3 = a3;
        expect(u3.status).toBe("none");
      }
      expect(u1.status).toBe("none");
      expect(u2.status).toBe("none");
      expect(a3.status).toBe("disposed");
    }
    expect(a1.status).toBe("disposed");
    expect(a2.status).toBe("async-disposed");

    expect(a3.disposeOrder).toBe(1);
    expect(a2.disposeOrder).toBe(2);
    expect(a1.disposeOrder).toBe(3);
  }

  const a1 = useWithAsync();
  {
    await using u1 = a1;
    {
      var __stack = 1;
      var _catch = 1;
      var _err = 1;
      var _hasErr = 1;
    }
  }
});

// The disposal code keeps "did the body throw" in a local that only the synthesized catch around the dispose call
// reads. That catch has never run by the time the function is optimized, so the local is kept alive only for the
// dispose call's exception exit.
test("a dispose that throws after the body threw reports a SuppressedError from optimized code", async () => {
  const fixture = `
    const state = { throwOnDispose: false };
    // Distinct executables, so the dispose call stays a real call instead of being inlined.
    const resources = [];
    for (let i = 0; i < 16; i++) {
      resources.push({
        state,
        [Symbol.dispose]: new Function('if (this.state.throwOnDispose) throw new Error("dispose ' + i + '");'),
      });
    }
    function run(resource, bodyShouldThrow) {
      try {
        {
          using r = resource;
          if (bodyShouldThrow) throw new Error("body");
        }
      } catch (e) {
        return e;
      }
      return null;
    }
    for (let i = 0; i < 2000; i++) {
      const error = run(resources[i % resources.length], i & 1);
      if ((error === null) !== !(i & 1)) throw new Error("warmup: unexpected result at " + i);
    }
    state.throwOnDispose = true;
    const error = run(resources[0], 1);
    console.log(error.name, "|", error.error?.message, "|", error.suppressed?.message);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    // Compile on the main thread so the tier-up point does not depend on scheduling.
    env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("SuppressedError | dispose 0 | body\n");
  expect(exitCode).toBe(0);
});
