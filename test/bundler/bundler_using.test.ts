import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { itBundled } from "./expectBundled";

// Where `using` / `await using` declarations may appear. `--target=bun` keeps
// the syntax and JavaScriptCore runs it natively. Other targets lower it, so the
// parser must give the same accept/reject verdict as the engines, and the
// accepted forms must run the same under every target and under `bun run`.

// `using` followed by `of` in a for-loop head is the identifier `using`.
const usingAsIdentifier = {
  source: /* js */ `
    var using, of = [1, 2], x = [3];
    for (using of x) console.log(using);
    for (using of of) console.log(using);
    async function g(s) { for await (using of s) console.log(using); }
    await g([4]);
    var of2 = [[9], [8], [7]];
    for (using of of2 [0, 1, 2]) console.log(using);
  `,
  stdout: "3\n1\n2\n4\n7",
};

// A classic for loop may declare `using` / `await using`, including one named `of`.
const usingInClassicForHead = {
  source: /* js */ `
    const out = [];
    function resource(name) {
      return { [Symbol.dispose]() { out.push("dispose " + name) } };
    }
    for (using a = resource("a"), b = resource("b"); out.length < 1;) out.push("body");
    out.push("after sync");
    for (using of = resource("of"); out.length < 5;) out.push("of body");
    async function main() {
      for (await using c = resource("c"); out.length < 7;) out.push("async body");
      out.push("after async");
    }
    await main();
    console.log(out.join());
  `,
  stdout: "body,dispose b,dispose a,after sync,of body,dispose of,async body,dispose c,after async",
};

const cases = {
  UsingIdentifierInForOfHead: usingAsIdentifier,
};

describe("bundler", () => {
  for (const [name, { source, stdout }] of Object.entries(cases)) {
    for (const target of ["bun", "node", "browser"] as const) {
      for (const bundling of [true, false]) {
        itBundled(`using/${name}/${target}${bundling ? "" : "-no-bundle"}`, {
          files: { "/entry.ts": source },
          target,
          bundling,
          run: { stdout },
        });
      }
    }
  }

  // Classic for-loop heads are not lowered yet, so only target=bun runs them.
  itBundled("using/UsingInClassicForHead/bun", {
    files: { "/entry.js": usingInClassicForHead.source },
    target: "bun",
    run: { stdout: usingInClassicForHead.stdout },
  });

  itBundled("using/UsingInClassicForHead/bun-no-bundle", {
    files: { "/entry.js": usingInClassicForHead.source },
    target: "bun",
    bundling: false,
    run: { stdout: usingInClassicForHead.stdout },
  });

  const invalidPlacements = {
    UsingInSwitchCase: {
      source: "switch (k) { case 0: using a = r(); break; }",
      errors: ['"using" declarations are not allowed in "case" or "default" clauses unless wrapped in a block'],
    },
    UsingInDefaultClause: {
      source: "switch (k) { default: using a = r(); }",
      errors: ['"using" declarations are not allowed in "case" or "default" clauses unless wrapped in a block'],
    },
    AwaitUsingInSwitchCase: {
      source: "async function f(k) { switch (k) { case 0: await using a = r(); break; } }",
      errors: ['"await using" declarations are not allowed in "case" or "default" clauses unless wrapped in a block'],
    },
    UsingInForIn: {
      source: "for (using b in o) ;",
      errors: ['Cannot use a "using" declaration in a for-in loop'],
    },
    AwaitUsingInForIn: {
      source: "async function h() { for (await using e in o) ; }",
      errors: ['Cannot use an "await using" declaration in a for-in loop'],
    },
    UsingInClassicForWithoutInitializer: {
      source: "for (using c;;) break;",
      errors: ['The declaration "c" must be initialized'],
    },
    AwaitUsingInClassicForWithoutInitializer: {
      source: "async function h() { for (await using d;;) break; }",
      errors: ['The declaration "d" must be initialized'],
    },
    UsingOfOfIdentifier: {
      source: "for (using of of xs) ;",
      errors: ['Expected ")" but found "xs"', "Unexpected )"],
    },
    // `await` then a newline awaits the identifier `using`; `a` on the same line as `using` is a syntax error.
    AwaitNewlineUsing: {
      source: "async function f() {\n  await\n  using a = r();\n}",
      errors: ['Expected ";" but found "a"', "Unexpected ="],
    },
  };

  for (const [name, { source, errors }] of Object.entries(invalidPlacements)) {
    itBundled(`using/Invalid${name}`, {
      files: { "/entry.js": source },
      target: "bun",
      bundleErrors: { "/entry.js": errors },
    });
  }
});

describe.concurrent("bun run", () => {
  for (const [name, { source, stdout }] of Object.entries({ ...cases, UsingInClassicForHead: usingInClassicForHead })) {
    test(name, async () => {
      using dir = tempDir("using-run", { "entry.ts": source });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).toBe("");
      expect(out.trim()).toBe(stdout);
      expect(exitCode).toBe(0);
    });
  }
});
