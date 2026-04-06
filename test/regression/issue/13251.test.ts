import { expect, test } from "bun:test";

test("scanImports respects trimUnusedImports", () => {
  const transpiler = new Bun.Transpiler({
    trimUnusedImports: true,
    loader: "tsx",
  });

  // Unused named import should be trimmed
  expect(transpiler.scanImports(`import { Component } from "./Component";`)).toEqual([]);

  // Unused default import should be trimmed
  expect(transpiler.scanImports(`import Foo from "./Foo";`)).toEqual([]);

  // Unused namespace import should be trimmed
  expect(transpiler.scanImports(`import * as Utils from "./Utils";`)).toEqual([]);

  // Used named import should be kept
  expect(transpiler.scanImports(`import { Component } from "./Component"; console.log(Component);`)).toEqual([
    { path: "./Component", kind: "import-statement" },
  ]);

  // Bare/side-effect import should always be kept
  expect(transpiler.scanImports(`import "./side-effect";`)).toEqual([
    { path: "./side-effect", kind: "import-statement" },
  ]);

  // Type-only import should always be trimmed
  expect(transpiler.scanImports(`import type { Foo } from "./Foo";`)).toEqual([]);
});

test("scan respects trimUnusedImports", () => {
  const transpiler = new Bun.Transpiler({
    trimUnusedImports: true,
    loader: "tsx",
  });

  // Unused named import should be trimmed from scan result
  const unusedResult = transpiler.scan(`import { Component } from "./Component";`);
  expect(unusedResult.imports).toEqual([]);

  // Used named import should be kept in scan result
  const usedResult = transpiler.scan(`import { Component } from "./Component"; console.log(Component);`);
  expect(usedResult.imports).toEqual([{ path: "./Component", kind: "import-statement" }]);

  // Bare/side-effect import should always be kept
  const sideEffectResult = transpiler.scan(`import "./side-effect";`);
  expect(sideEffectResult.imports).toEqual([{ path: "./side-effect", kind: "import-statement" }]);
});

test("scanImports returns all imports when trimUnusedImports is false", () => {
  const transpiler = new Bun.Transpiler({
    trimUnusedImports: false,
    loader: "tsx",
  });

  // Unused named import should NOT be trimmed when option is false
  expect(transpiler.scanImports(`import { Component } from "./Component";`)).toEqual([
    { path: "./Component", kind: "import-statement" },
  ]);
});

test("scan returns all imports when trimUnusedImports is false", () => {
  const transpiler = new Bun.Transpiler({
    trimUnusedImports: false,
    loader: "tsx",
  });

  const result = transpiler.scan(`import { Component } from "./Component";`);
  expect(result.imports).toEqual([{ path: "./Component", kind: "import-statement" }]);
});
