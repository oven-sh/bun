import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

test("use strict causes CommonJS", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), require.resolve("./use-strict-fixture.js")],
    env: bunEnv,
  });
  expect(stdout.toString()).toBe("function\n");
  expect(exitCode).toBe(0);
});

test("non-ascii regexp literals", () => {
  var str = "🔴11 54 / 10,000";
  expect(str.replace(/[🔵🔴,]+/g, "")).toBe("11 54 / 10000");
});

test("ascii regex with escapes", () => {
  expect(/^[-#!$@£%^&*()_+|~=`{}\[\]:";'<>?,.\/ ]$/).toBeInstanceOf(RegExp);
});

describe("// @bun", () => {
  beforeEach(() => {
    delete require.cache[require.resolve("./async-transpiler-entry")];
    delete require.cache[require.resolve("./async-transpiler-imported")];
  });

  test("async transpiler", async () => {
    const { default: value, hbs } = await import("./async-transpiler-entry");
    expect(value).toBe(42);
    expect(hbs).toBeString();
  });

  test("require()", async () => {
    const { default: value, hbs } = require("./async-transpiler-entry");
    expect(value).toBe(42);
    expect(hbs).toBeString();
  });

  test("synchronous", async () => {
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), require.resolve("./async-transpiler-imported")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });
    expect(stdout.toString()).toBe("Hello world!\n");
    expect(exitCode).toBe(0);
  });
});

describe("json imports", () => {
  test("require(*.json)", async () => {
    const {
      name,
      description,
      players,
      version,
      creator,
      default: defaultExport,
      ...other
    } = require("./runtime-transpiler-json-fixture.json");
    const obj = {
      "name": "Spiral 4v4 NS",
      "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
      "version": "1.0",
      "creator": "Grand Homie",
      "players": [8, 8],
      default: { a: 1 },
    };
    expect({
      name,
      description,
      players,
      version,
      creator,
      default: { a: 1 },
    }).toEqual(obj);
    expect(other).toEqual({});

    // This tests that importing and requiring when already in the cache keeps the state the same
    {
      const {
        name,
        description,
        players,
        version,
        creator,
        default: defaultExport,
        // @ts-ignore
      } = await import("./runtime-transpiler-json-fixture.json");
      const obj = {
        "name": "Spiral 4v4 NS",
        "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
        "version": "1.0",
        "creator": "Grand Homie",
        "players": [8, 8],
        default: { a: 1 },
      };
      expect({
        name,
        description,
        players,
        version,
        creator,
        default: { a: 1 },
      }).toEqual(obj);
      // They should be strictly equal
      expect(defaultExport.players).toBe(players);
      expect(defaultExport).toEqual(obj);
    }

    delete require.cache[require.resolve("./runtime-transpiler-json-fixture.json")];
  });

  test("import(*.json)", async () => {
    const {
      name,
      description,
      players,
      version,
      creator,
      default: defaultExport,
      // @ts-ignore
    } = await import("./runtime-transpiler-json-fixture.json");
    delete require.cache[require.resolve("./runtime-transpiler-json-fixture.json")];
    const obj = {
      "name": "Spiral 4v4 NS",
      "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
      "version": "1.0",
      "creator": "Grand Homie",
      "players": [8, 8],
      default: { a: 1 },
    };
    expect({
      name,
      description,
      players,
      version,
      creator,
      default: { a: 1 },
    }).toEqual(obj);
    // They should be strictly equal
    expect(defaultExport.players).toBe(players);
    expect(defaultExport).toEqual(obj);
  });

  test("should support comments in tsconfig.json", async () => {
    // @ts-ignore
    const { buildOptions, default: defaultExport } = await import("./tsconfig.with-commas.json");
    delete require.cache[require.resolve("./tsconfig.with-commas.json")];
    const obj = {
      "buildOptions": {
        "outDir": "dist",
        "baseUrl": ".",
        "paths": {
          "src/*": ["src/*"],
        },
      },
    };
    expect({
      buildOptions,
    }).toEqual(obj);
    // They should be strictly equal
    expect(defaultExport.buildOptions).toBe(buildOptions);
    expect(defaultExport).toEqual(obj);
  });

  test("should handle non-boecjts in tsconfig.json", async () => {
    // @ts-ignore
    const { default: num } = await import("./tsconfig.is-just-a-number.json");
    delete require.cache[require.resolve("./tsconfig.is-just-a-number.json")];
    expect(num).toBe(1);
  });

  test("should handle duplicate keys", async () => {
    // @ts-ignore
    expect((await import("./runtime-transpiler-fixture-duplicate-keys.json")).a).toBe("4");
  });
});

describe("with statement", () => {
  // A name in the body of `with (object)` is looked up on the object first.
  // The lookup can run a proxy trap or a getter, so a read stays where nothing
  // uses its value. Each expected line is what Node.js prints for the same
  // file. A `.cjs` file runs in sloppy mode, which `with` needs.
  async function runSloppy(source: string) {
    using dir = tempDir("with-statement", { "index.cjs": source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("typeof of a name looks the name up on the object", async () => {
    const result = await runSloppy(/* js */ `
      // Every name from p1 to p30 is looked up once, in this order.
      const lookups = [];
      const scope = new Proxy({}, {
        has(target, key) {
          if (/^(p[0-9]+|undefined|NaN|require)$/.test(key)) lookups.push(key);
          return false;
        },
      });
      function use() {}
      var p30;
      with (scope) {
        typeof p1;
        typeof p2 === "undefined";
        typeof p3 == "undefined";
        typeof p4 < "u";
        void typeof p5;
        !typeof p6;
        typeof typeof p7;
        typeof p8, 0;
        [typeof p9];
        [typeof p10][0];
        ({ key: typeof p11 });
        typeof p12 ? 0 : 1;
        typeof p13 && 0;
        typeof p14 || 0;
        typeof p15 ?? 0;
        void (typeof p16 !== "undefined" && p16);
        if (typeof p17) {}
        if (!typeof p18) use();
        while (!typeof p19) {}
        label: typeof p20;
        use(!typeof p21);
        use(void typeof p22);
        use(typeof p23 ? 0 : 1);
        use((typeof p24, 0));
        use(void (typeof p25 !== "undefined" && p25));
        (function () { typeof p26; })();
        (() => { typeof p27; })();
        class Static { static { typeof p28; } }
        with ({}) { typeof p29; }
        typeof p30;
        typeof undefined;
        typeof NaN;
        typeof require;
      }
      typeof p31;
      console.log(lookups.join(" "));

      // The object has the name: the lookup reads Symbol.unscopables and the property.
      const reads = [];
      const holder = {
        get q1() { reads.push("q1"); return 1; },
        get q2() { reads.push("q2"); return 1; },
        get q3() { reads.push("q3"); return 1; },
        get q4() { reads.push("q4"); return 1; },
        q5: 1,
        get [Symbol.unscopables]() { reads.push("unscopables"); return { q5: true }; },
      };
      var negated, kind, hidden;
      with (holder) {
        typeof q1;
        void typeof q2;
        negated = !typeof q3;
        kind = typeof q4;
        hidden = typeof q5;
      }
      console.log(reads.join(" "), negated, kind, hidden);

      // A trap that throws ends the body.
      var thrown = "nothing", after = false;
      const throws = new Proxy({}, {
        has(target, key) {
          if (key === "q6") throw new RangeError("q6");
          return false;
        },
      });
      try {
        with (throws) {
          typeof q6;
          after = true;
        }
      } catch (error) {
        thrown = error.name;
      }
      console.log(thrown, after);
    `);
    expect(result).toEqual({
      stdout:
        "p1 p2 p3 p4 p5 p6 p7 p8 p9 p10 p11 p12 p13 p14 p15 p16 p17 p18 p19 p20 " +
        "p21 p22 p23 p24 p25 p26 p27 p28 p29 p30 undefined NaN require\n" +
        "unscopables q1 unscopables q2 unscopables q3 unscopables q4 unscopables false number undefined\n" +
        "RangeError false\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // A `var` is a variable of the function, also when a block of the body
  // declares it. So a read of it in the body asks the object first.
  test.concurrent("a read of a var that the body declares looks the name up on the object", async () => {
    const result = await runSloppy(/* js */ `
      const lookups = [];
      const scope = new Proxy({}, {
        has(target, key) {
          if (/^[vn][0-9]+$/.test(key)) lookups.push(key);
          return false;
        },
      });
      var v11;
      function v12() {}
      with (scope) {
        var v1; v1; typeof v1;
        { var v2; v2; typeof v2; }
        { { var v3; v3; typeof v3; } }
        for (var v4; ; ) { v4; typeof v4; break; }
        for (var v5 in { key: 0 }) { v5; typeof v5; }
        switch (0) { case 0: var v6; v6; typeof v6; }
        try { var v7; v7; typeof v7; } finally {}
        label: { var v8; v8; typeof v8; }
        { var v9; } { var v9; v9; typeof v9; }
        { var v10; (function () { v10; typeof v10; })(); }
        { var v11; v11; typeof v11; }
        { var v12; v12; typeof v12; }
        with (scope) { var v13; v13; typeof v13; }
        // A labeled statement declares the name.
        label: if (typeof v16) var v16 = 1;
        label: do var v17 = 1; while (v17, 0);
        // Six and ten names in one block: the scope stores them in a larger table.
        { var v20, v21, v22, v23, v24, v25; v20; typeof v25; }
        { var v30, v31, v32, v33, v34, v35, v36, v37, v38, v39; v30; v34; typeof v39; }
        { var v40; let n7; var v41; n7; typeof n7; v40; typeof v41; }
        // These names are bindings of the body. The object is not asked.
        { let n1; n1; typeof n1; }
        { function n2() {} n2; typeof n2; }
        try { throw 0; } catch (n3) { var n3; n3; typeof n3; }
        (function () { var n4; n4; typeof n4; })();
        class Static { static { var n5; n5; typeof n5; } }
      }
      (function (v14) { with (scope) { var v14; v14; typeof v14; } })();
      try { throw 0; } catch (v15) { with (scope) { var v15; v15; typeof v15; } }
      (function () { with (scope) { var n6; } n6; typeof n6; })();
      console.log(lookups.join(" "));
    `);
    expect(result).toEqual({
      stdout:
        "v1 v1 v2 v2 v3 v3 v4 v4 v5 v5 v5 v6 v6 v7 v7 v8 v8 v9 v9 v10 v10 v11 v11 v12 v12 " +
        "v13 v13 v13 v13 v16 v16 v17 v17 v20 v25 v30 v34 v39 v40 v41 v14 v14 v15 v15\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // `make()` gives the object a property `result`, so the statement after it
  // stores in the object. `var result = make()` looks `result` up before the
  // call and stores in the variable.
  test.concurrent("a store to a var that the body declares stays after the call before it", async () => {
    const result = await runSloppy(/* js */ `
      function make(object) {
        object.result = "property";
        return "made";
      }
      function assign(object) {
        with (object) {
          var result;
          const made = make(object);
          result = made;
        }
        return result;
      }
      function declare(object) {
        with (object) {
          const made = make(object);
          var result = made;
        }
        return result;
      }
      function declareInLoopHead(object) {
        with (object) {
          const made = make(object);
          for (var result = made in {});
        }
        return result;
      }
      const objects = [{}, {}, {}, {}];
      console.log(String(assign(objects[0])), objects[0].result);
      console.log(String(declare(objects[1])), objects[1].result);
      console.log(String(declareInLoopHead(objects[2])), objects[2].result);
      with (objects[3]) {
        const made = make(objects[3]);
        var result = made;
      }
      console.log(String(result), objects[3].result);
    `);
    expect(result).toEqual({
      stdout: "undefined made\nundefined made\nundefined made\nundefined made\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // The getter of `first` adds one to `count`. `second` takes `count` before
  // the getter runs.
  test.concurrent("a read stays before the lookup of a var that the body declares", async () => {
    const result = await runSloppy(/* js */ `
      function run(object) {
        with (object) {
          var first;
          let count = 1;
          object.bump = function () { count++; };
          const second = count;
          return [first, second];
        }
      }
      const object = {
        get first() {
          this.bump();
          return "got";
        },
      };
      console.log(run(object).join(" "));
    `);
    expect(result).toEqual({ stdout: "got 1\n", stderr: "", exitCode: 0 });
  });

  // The function of a `switch` clause is printed as a `let` of that clause
  // (#40839). A read from another clause that stays in the output throws.
  test.todo("typeof of a function that another switch clause declares", async () => {
    const result = await runSloppy(/* js */ `
      const lookups = [];
      const scope = new Proxy({}, {
        has(target, key) {
          if (key === "inClause") lookups.push(key);
          return false;
        },
      });
      switch (0) {
        case 0:
          with (scope) { typeof inClause; }
          break;
        case 1:
          function inClause() {}
      }
      console.log(lookups.join(" "));
    `);
    expect(result).toEqual({ stdout: "inClause\n", stderr: "", exitCode: 0 });
  });

  test("works", () => {
    const { exitCode } = Bun.spawnSync({
      cmd: [bunExe(), require.resolve("./with-statement-works.js")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
    });

    expect(exitCode).toBe(0);
  });
});

test("math.pow", () => {
  function foo1(foo) {
    return 10 ** (foo / 20);
  }

  function foo2(foo) {
    return foo ** -0.5;
  }

  expect(foo1(-1) + "").toEqual("0.8912509381337456");
  expect(10 ** (-1 / 20) + "").toEqual("0.8912509381337456");
  expect(foo2(20.4) + "").toEqual("0.22140372138502384");
  expect(20.4 ** -0.5 + "").toEqual("0.22140372138502384");
});

describe("unterminated string literals in large files", () => {
  test("reports an unterminated string literal at the end of a large JavaScript file", async () => {
    using dir = tempDir("transpiler-long-unterminated-js", {
      "index.js": `var s = "${Buffer.alloc(1 << 20, "a").toString()}`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("Unterminated string literal");
    expect(exitCode).toBe(1);
  });

  test("reports an unterminated string literal at the end of a large JSON file", async () => {
    using dir = tempDir("transpiler-long-unterminated-json", {
      "tsconfig.big.json": `{"name": "${Buffer.alloc(1 << 20, "a").toString()}`,
      "index.js": `require("./tsconfig.big.json");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("Unterminated string literal");
    expect(exitCode).toBe(1);
  });
});

// 2 GiB through the printer takes over 30 seconds on a debug or ASAN build.
test.skipIf(isDebug || isASAN)(
  "printing more than 2 GiB of modules in one process keeps the space after a keyword",
  async () => {
    using dir = tempDir("transpiler-printer-position", {
      "big.cjs": `module.exports = "${Buffer.alloc(1 << 20, "a").toString()}";`,
      "probe.cjs": `module.exports = function named() { return typeof named; };`,
      "index.cjs": `
        const big = require.resolve("./big.cjs");
        for (let i = 0; i < 2100; i++) {
          delete require.cache[big];
          module.children.length = 0;
          require(big);
          if (i % 50 === 0) Bun.gc(true);
        }
        console.log(require("./probe.cjs")());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("function\n");
    expect(exitCode).toBe(0);
  },
);
