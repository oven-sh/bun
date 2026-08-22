import { cssInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

const { cssModulesTest } = cssInternals as any;

describe("css_modules handle_composes", () => {
  test("local composes builds a Local reference", () => {
    const result = cssModulesTest(
      `.alpha { color: red; }
       .beta { composes: alpha; color: blue; }`,
    );
    expect(result.exports.beta).toEqual({
      name: expect.stringMatching(/^beta_/),
      composes: [{ type: "local", name: expect.stringMatching(/^alpha_/) }],
    });
    const hash = result.exports.beta.name.slice("beta_".length);
    expect(result.exports.beta.composes[0].name).toBe(`alpha_${hash}`);
  });

  test("global composes builds a Global reference", () => {
    const result = cssModulesTest(`.alpha { composes: globalName from global; color: red; }`);
    expect(result.exports.alpha.composes).toEqual([{ type: "global", name: "globalName" }]);
  });

  test("composes from file builds a Dependency reference", () => {
    const result = cssModulesTest(`.alpha { composes: other from "./other.module.css"; color: red; }`);
    expect(result.exports.alpha.composes).toEqual([
      { type: "dependency", name: "other", specifier: "./other.module.css" },
    ]);
  });

  test("multiple names and dedupe", () => {
    const result = cssModulesTest(
      `.a { color: red; }
       .b { color: blue; }
       .c { composes: a b; composes: a; color: green; }`,
    );
    expect(result.exports.c.composes).toEqual([
      { type: "local", name: expect.stringMatching(/^a_/) },
      { type: "local", name: expect.stringMatching(/^b_/) },
    ]);
  });

  test("invalid selector still errors", () => {
    expect(() => cssModulesTest(`.a .b { composes: x; color: red; }`)).toThrow(/composes.*class selector/i);
  });
});
