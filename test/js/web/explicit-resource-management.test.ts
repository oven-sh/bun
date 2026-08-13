import { describe, expect, test } from "bun:test";
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

// `using` / `await using` may not appear directly in a switch case or default clause, but a
// function nested in such a clause is a fresh statement list. JSC used to reject these at load
// time with "'using' declaration is not allowed directly in a switch case or default clause".
// The sync cases need a real resource: bun's transpiler folds `using a = null` into `let a = null`,
// and JSC would never see the declaration.
describe("using declarations in a function nested in a switch case clause", () => {
  const cases: [name: string, program: string][] = [
    [
      "await using in an async arrow called from a case clause",
      `const r = { [Symbol.asyncDispose]() { console.log("disposed"); } };
async function g() {
  switch (1) {
    case 1:
      await (async () => {
        await using a = r;
        console.log("body");
      })();
      console.log("after");
  }
}
await g();`,
    ],
    [
      "await using in an async function declared in a default clause",
      `const r = { [Symbol.asyncDispose]() { console.log("disposed"); } };
async function j() {
  switch (1) {
    default:
      async function inner() {
        await using a = r;
        console.log("body");
      }
      await inner();
      console.log("after");
  }
}
await j();`,
    ],
    [
      "using in an arrow called from a case clause",
      `const r = { [Symbol.dispose]() { console.log("disposed"); } };
switch (1) {
  case 1:
    (() => {
      using a = r;
      console.log("body");
    })();
    console.log("after");
}`,
    ],
    [
      "using in a function declared in a default clause",
      `const r = { [Symbol.dispose]() { console.log("disposed"); } };
switch (1) {
  default:
    function inner() {
      using a = r;
      console.log("body");
    }
    inner();
    console.log("after");
}`,
    ],
    [
      "using in a method of an object literal in a case clause",
      `const r = { [Symbol.dispose]() { console.log("disposed"); } };
switch (1) {
  case 1:
    ({
      m() {
        using a = r;
        console.log("body");
      },
    }).m();
    console.log("after");
}`,
    ],
  ];

  test.concurrent.each(cases)("%s", async (_name, program) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", program],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "body\ndisposed\nafter\n", stderr: "", exitCode: 0 });
  });
});
