import { rollup, type Plugin } from "rollup";
import { parseAst } from "rollup/parseAst";

test("it works", () => {
  expect(parseAst("const x = true")).toMatchSnapshot();
});

// Rollup assigns `code` of an error that a plugin throws, and keeps the code that the error had as `pluginCode`.
it.each(["buildStart", "resolveId", "load", "transform"] as const)(
  "reports a module that a %s hook fails to require",
  async hook => {
    const plugin: Plugin = {
      name: "requires-a-missing-module",
      resolveId: id => id,
      load: () => "export default 1;",
      [hook]() {
        require("./does-not-exist");
      },
    };
    const error = await rollup({ input: "virtual:entry", plugins: [plugin] }).then(
      () => undefined,
      error => error,
    );
    expect(error).toBeInstanceOf(ResolveMessage);
    expect({ code: error.code, pluginCode: error.pluginCode, plugin: error.plugin, hook: error.hook }).toEqual({
      code: "PLUGIN_ERROR",
      pluginCode: "MODULE_NOT_FOUND",
      plugin: "requires-a-missing-module",
      hook,
    });
  },
);
