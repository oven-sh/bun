// Downloads tests from Deno and does AST transformation to convert APIs
// like Deno.test() to use Bun's test() and expect() APIs.
//
// 2024-02-14:
// As of https://github.com/denoland/deno/pull/22402 (move all the tests)
// the data in resources.json is probably incorrect. Not aware of any time
// we re-generated deno tests.

import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { parse, print } from "@swc/core";
import type { ImportDeclaration, ExpressionStatement, CallExpression } from "@swc/core";
import resources from "../resources.json";

type Test = {
  path: string;
  remotePath: string;
  skip?: boolean;
  skipTests?: string[];
};

type ParsedTest = Test & {
  src: string;
  testCount: number;
  tests: string[];
};

async function downloadTest(test: Test): Promise<ParsedTest> {
  const path = join(import.meta.dir, "..", test.path);
  const url = new URL(test.remotePath, resources.baseUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status}: ${url}`);
  }
  const src = await response.text();
  if (test.skip) {
    return {
      ...test,
      tests: [],
      testCount: 0,
      src,
    };
  }
  const headers = [
    "// GENERATED - DO NOT EDIT",
    "// Copyright 2018+ the Deno authors. All rights reserved. MIT license.",
    `// ${url}`,
    `import { createDenoTest } from "deno:harness";`,
  ];
  const ast = await parse(src, {
    syntax: "typescript",
    target: "esnext",
    dynamicImport: true,
  });
  let tests: string[] = [];
  const harness = new Set(["test"]);
  for (const item of ast.body) {
    if (item.type === "ImportDeclaration") {
      const found = visitImport(item);
      if (found?.path === "deno:harness") {
        ast.body = ast.body.filter(i => i !== item);
        for (const specifier of found.specifiers) {
          harness.add(specifier);
        }
      } else if (found) {
        item.source.raw = `"${found.path}"`;
      }
    }
    if (item.type === "ExpressionStatement") {
      for (const name of visitExpression(item, test)) {
        tests.push(name);
      }
    }
  }
  headers.push(`const { ${Array.from(harness).join(", ")} } = createDenoTest(import.meta.path);`);
  const { code } = await print(ast, {
    isModule: true,
  });
  const dst = [...headers, code].join("\n");
  try {
    mkdirSync(dirname(path));
  } catch {}
  await Bun.write(path, dst);
  return {
    ...test,
    tests,
    testCount: tests.length,
    src: dst,
  };
}

type Import = {
  path: string;
  specifiers: string[];
};

function visitImport(item: ImportDeclaration): Import | null {
  const src = item.source.value;
  let dst = "";
  for (const [from, to] of Object.entries(resources.imports)) {
    if (src.endsWith(from)) {
      dst = to;
      break;
    }
  }
  if (!dst) {
    console.warn("Unknown import:", dst);
    return null;
  }
  return {
    path: dst,
    specifiers: item.specifiers.map(specifier => specifier.local.value),
  };
}

function* visitExpression(item: ExpressionStatement, test: Test): Generator<string> {
  if (
    item.expression.type === "CallExpression" &&
    item.expression.callee.type === "MemberExpression" &&
    item.expression.callee.object.type === "Identifier" &&
    item.expression.callee.object.value === "Deno"
  ) {
    if (item.expression.callee.property.type === "Identifier" && item.expression.callee.property.value === "test") {
      yield* visitTest(item.expression, test);
      item.expression.callee = item.expression.callee.property;
    }
  }
}

function* visitTest(item: CallExpression, test: Test): Generator<string> {
  for (const argument of item.arguments) {
    if (argument.expression.type === "FunctionExpression") {
      const fn = argument.expression.identifier?.value;
      if (fn && test.skipTests && test.skipTests.includes(fn)) {
        // @ts-ignore
        item.callee.property.value = "test.ignore";
      }
    }
  }
}

for (const test of resources.tests) {
  await downloadTest(test);
}
