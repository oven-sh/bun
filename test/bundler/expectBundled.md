# `bun build` tests using `expectBundled`

Most bundler tests were ported [from esbuild][1], located in `test/bundler/esbuild`. Our own tests are in `bundler_*.test.ts`. Not all esbuild tests were fully ported, check for `// GENERATED` to see which are missing.

[1]: https://github.com/evanw/esbuild/tree/main/internal/bundler_tests

## expectBundled

Call `expectBundled` within a test to test the bundler. The `id` passed as the first argument must be unique across the all tests, and generally uses the format `file/TestName`. The second parameter is an options object.

All bundle entry files, their outputs, and other helpful files are written to disk at: `$TEMP/bun-build-tests/{run_id}/{id}`. This can be used to inspect and debug bundles, as they are not deleted after runtime.

In addition to comparing the bundle outputs against snapshots, **most test cases execute the bundle and have additional checks to assert the intended logic is happening properly**. This allows the bundler to change exactly how it writes files (optimizations / variable renaming), and still have concrete tests that ensure what the bundler creates will function properly. Snapshots are also taken, but these are used to check for regressions and not necessarily check accuracy.

On top of `expectBundled`, there is also `itBundled` which wraps `expectBundled` and `it` together, which is what we mostly use in our tests.

These two functions have many options you can pass to it, check the examples below for some common use cases, then look at the `BundlerTestInput` for a complete set of options. Not all of the options are implemented; these tests get auto-skipped.

## Running tests

You can use `bun test` as normal, but `expectBundled` looks for these environment variables:

- `BUN_BUNDLER_TEST_USE_ESBUILD` - Use `esbuild` instead of `bun build`.
- `BUN_BUNDLER_TEST_DEBUG` - Write extra files to disk and log extra info.
- `BUN_BUNDLER_TEST_FILTER` - Set this to the exact id of a test to only run that test.
- `BUN_EXE` - Override the path to the `bun` executable.

There is also a helper CLI that sets these variables:

```sh
$ ./run-single-bundler-test.sh default/ExportMissingES6
$ ./run-single-bundler-test.sh default/ExportMissingES6 e
```

Passing the second argument at all will use `esbuild` instead of `bun build`. It also creates a symlink `./out` to the output directory, for faster inspection. I have this aliased to `tb` (test bun) in my shell for fast usage.

## Basic Examples and Common Patterns

At the start of test files, use `testForFile` instead of importing from `bun:test`:

```ts
import { itBundled, testForFile } from "./expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);
```

Basic example (this goes in a `describe`)

```ts
itBundled("default/SimpleES6", {
  files: {
    // Define one or more files. Strings are passed through `dedent`
    // First file is the entry file
    "/entry.js": /* js */ `
      import { fn } from './foo';
      console.log(fn());
    `,
    "/foo.js": /* js */ `
      export function fn() {
        return 123
      }
    `,
  },
  // outfile: "out.js", // Default is "out.js"

  // Passing `run` will run the bundle
  run: {
    stdout: "123",
    // file: "out.js", // Default is whatever `outfile` is
  },
});
```

Testing the exports of a module using `runtimeFiles`:

```ts
itBundled("importstar/ExportSelfES6", {
  files: {
    "/entry.js": /* js */ `
      export const foo = 123
      export * from './entry'
    `,
  },
  format: "esm",
  // `runtimeFiles` are only available after the bundle is created, which lets you
  // keep some files secret, like preventing externals from being bundled, etc.
  // It can also be used to provide a runtime entry point.
  runtimeFiles: {
    "/test.js": /* js */ `
      import * as foo from './out.js'
      // Try avoiding relying on Bun's object formatter, instead use JSON.stringify when possible
      // This will avoid any changes to how these objects are formatted.
      console.log(JSON.stringify(foo));
    `,
  },
  run: {
    file: "/test.js",
    // console.log is a great way to assert the proper values exist, but when needed you
    // can also reach for `import "assert"` and run that in the test.
    stdout: '{"foo":123}',
  },
});
```

You can use a `test.js` to define extra variables via `globalThis`:

```ts
itBundled("default/MinifiedBundleEndingWithImportantSemicolon", {
  files: {
    // foo() is not defined in this scope
    "/entry.js": `while(foo()); // This semicolon must not be stripped`,

    "/test.js": /* js */ `
      let i = 0;
      // let's define foo()
      globalThis.foo = () => {
        console.log(i++);
        return i === 1;
      };
      await import('./out.js')
    `,
  },
  minifyWhitespace: true,
  format: "iife",
  run: {
    file: "/test.js",
    stdout: "0\n1",
  },
});
```

## onAfterBundle

Since not every possible test case can be covered by `run` and the other options, you can pass a function `onAfterBundle` to add custom checks.

```ts
itBundled("default/ThisOutsideFunctionRenamedToExports", {
  files: {
    "/entry.js": /* js */ `
      console.log(this)
      console.log((x = this) => this)
      console.log({x: this})
      console.log(class extends this.foo {})
      console.log(class { [this.foo] })
      console.log(class { [this.foo]() {} })
      console.log(class { static [this.foo] })
      console.log(class { static [this.foo]() {} })
    `,
  },
  onAfterBundle(api) {
    if (api.readFile("/out.js").includes("this")) {
      throw new Error("All cases of `this` should have been rewritten to `exports`");
    }
  },
});
```

Check the `BundlerTestBundleAPI` typedef for all available methods. Note that `api.readFile` is cached so you can call it multiple times without worrying about anything.

This callback is run before `run`, so you can use tricks like `appendFile` to add extra data, useful when testing IIFE bundles in combination with `globalName`

```ts
itBundled("importstar/ReExportStarExternalIIFE", {
  files: {
    "/entry.js": `export * from "foo"`,
  },
  format: "iife",
  globalName: "mod",
  external: ["foo"],
  runtimeFiles: {
    "/node_modules/foo/index.js": /* js */ `
      export const foo = 'foo'
      export const bar = 'bar'
    `,
  },
  onAfterBundle(api) {
    api.appendFile("/out.js", "\nconsole.log(JSON.stringify(mod))");
  },
  run: {
    stdout: '{"bar":"bar","foo":"foo"}',
  },
});
```

## dce: true

This parameter checks the bundle for strings like `DROP`, `REMOVE`, and `FAIL` within the bundle, and will throw an error. This is handy for dead code elimination tests where you can just name variables that should be removed with one of those trigger words. In addition, `KEEP`, `PRESERVE`, and `KEEPME` is scanned in the source code and will throw an error if the count of those strings is not equal to the count of the corresponding trigger strings.

Places that are not required to be dce'd contain `POSSIBLE_REMOVAL` and do not trigger an error if not removed. These might be able to be optimized in the future.

## keepNames tricks

In `esbuild/default.test.ts`, test `default/KeepNamesTreeShaking`, we call the esbuild cli to minify identifiers, and then check the code for expected class names to survive the minification (keep names forcibily sets functions `.name`).

# capture

This lets you capture the exact js that is emitted by wrapping it in a function call `capture`. Like a partial snapshot.

```ts
itBundled("minify/TemplateStringFolding", {
  files: {
    "/entry.js": /* js */ `
      capture(\`😋📋👌\`.length)
      capture(\`😋📋👌\`.length === 6)
      capture(\`😋📋👌\`.length == 6)
      capture(\`😋📋👌\`.length === 2)
      capture(\`😋📋👌\`.length == 2)
    `,
  },
  minifySyntax: true,
  capture: ["6", "true", "true", "false", "false"],
});
```
