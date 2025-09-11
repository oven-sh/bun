import { Database } from "bun:sqlite";
import { beforeEach, expect, it } from "bun:test";
import path from "path";

const empty_file_path = path.join(import.meta.dir, "empty-file");

// bun caches imports for performance, but we want to use different loaders for each test, so we need to clear it
beforeEach(() => {
  delete require.cache[require.resolve("./empty-file")];
});

// MARK: - text like

it("importing empty text file returns empty string", async () => {
  const empty_file_text = (await import("./empty-file", { with: { type: "text" } })).default;
  expect(empty_file_text).toEqual("");
});

it("importing empty file with type file returns it path", async () => {
  const empty_file_text = (await import("./empty-file", { with: { type: "file" } })).default;
  expect(empty_file_text).toEqual(empty_file_path);
});

// MARK: - web imports

it("importing empty css file returns its path", async () => {
  const empty_file_css = (await import("./empty-file", { with: { type: "css" } })).default;
  expect(empty_file_css).toEqual(empty_file_path);
});

it("importing empty html file returns HTMLBundle with its path", async () => {
  const empty_file_html = (await import("./empty-file", { with: { type: "html" } })).default;
  expect(empty_file_html.index).toEqual(empty_file_path);
});

// MARK: - js like

it("importing empty js like file returns empty module", async () => {
  const js_like = ["jsx", "js", "ts", "tsx"];

  for (const type of js_like) {
    delete require.cache[require.resolve(`./empty-file`)];

    const empty_file_js = await import("./empty-file", { with: { type } });
    expect(empty_file_js).toEqual({}); // Expect an empty module object
    expect(empty_file_js.default).toBeUndefined(); // Expect no default export
  }
});

// MARK: - json like

it("importing empty json file throws JSON Parse error", async () => {
  try {
    await import("./empty-file", { with: { type: "json" } });
    expect.unreachable("Importing empty json file should have thrown an error.");
  } catch (e) {
    expect(e.message).toMatch(/JSON Parse error: Unexpected EOF|Unexpected end of JSON input/i);
  }
});

it("importing empty jsonc/toml file returns module with empty object as default export", async () => {
  const types = ["jsonc", "yaml", "toml"];

  for (const type of types) {
    delete require.cache[require.resolve(`./empty-file`)];

    const empty_file_module = await import("./empty-file", { with: { type } });
    expect(empty_file_module.default).toEqual({});
  }
});

// MARK: - other types

it("importing empty file returns module with path as default export", async () => {
  const other_types = [
    "wasm",
    // "napi", // marked unreachable in src/bun.js/module_loader.zig:1956:22
    "base64",
    "dataurl",
  ];

  for (const type of other_types) {
    delete require.cache[require.resolve(`./empty-file`)];

    const empty_file_module = await import("./empty-file", { with: { type } });
    expect(empty_file_module.default).toEqual(empty_file_path);
  }
});

// MARK: - sqlite

it("importing empty sqlite files returns database object", async () => {
  const other_types = ["sqlite", "sqlite_embedded"];

  for (const type of other_types) {
    delete require.cache[require.resolve(`./empty-file`)];

    const empty_file_module = await import("./empty-file", { with: { type } });
    expect(empty_file_module.default).toBeInstanceOf(Database);
    expect(empty_file_module.db).toBeInstanceOf(Database);
  }
});
