import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { parse, print } from "@swc/core";
import type { ImportDeclaration, ExpressionStatement, CallExpression } from "@swc/core";
import imports from "../resources/imports.json";
import tests from "../resources/tests.json";
import baseUrl from "../resources/url.json";

// FIXME: https://github.com/oven-sh/bun/issues/2350
// import * as harness from "deno:harness";

for (const test of tests) {
  if (test.skip) {
    continue;
  }
  const path = join(import.meta.dir, "..", test.path);
  const url = new URL(test.remotePath, baseUrl);
  const response = await fetch(url);
  console.log(response.status, url.toString(), "->", test.path);
  if (!response.ok) {
    continue;
  }
  const src = await response.text();
  const dst = await visit(src, test);
  try {
    mkdirSync(dirname(path));
  } catch {}
  await Bun.write(path.replace(".test.", ".deno."), src);
  await Bun.write(path, dst);
}

async function visit(src: string, test: any): Promise<string> {
  const ast = await parse(src, {
    syntax: "typescript",
    target: "esnext",
    dynamicImport: true,
  });
  for (const item of ast.body) {
    if (item.type === "ImportDeclaration") {
      visitImport(item);
    }
    if (item.type === "ExpressionStatement") {
      visitExpression(item);
    }
  }
  const url = new URL(test.remotePath, baseUrl);
  const header = `// Copyright 2018+ the Deno authors. All rights reserved. MIT license.\n// ${url}\n`;
  const { code } = await print(ast, {
    isModule: true,
  });
  return header + code;
}

function visitImport(item: ImportDeclaration): void {
  const src = item.source.value;
  let match = false;
  for (const name of imports) {
    if (src.endsWith(name)) {
      match = true;
      break;
    }
  }
  if (!match) {
    console.warn("Unknown import:", src);
    return;
  }
  item.source.raw = '"deno:harness"';
  // FIXME: https://github.com/oven-sh/bun/issues/2350
  /*let missing = [];
  for (const specifier of item.specifiers) {
    const name = specifier.local.value;
    if (!(name in harness)) {
      missing.push(name);
    }
  }
  if (missing.length) {
    console.warn("Harness does not contain exports:", missing);
  }*/
}

function visitExpression(item: ExpressionStatement): void {
  if (
    item.expression.type === "CallExpression" &&
    item.expression.callee.type === "MemberExpression" &&
    item.expression.callee.object.type === "Identifier" &&
    item.expression.callee.object.value === "Deno"
  ) {
    if (item.expression.callee.property.type === "Identifier" && item.expression.callee.property.value === "test") {
      visitTest(item.expression);
    }
  }
}

function visitTest(item: CallExpression): void {
  for (const argument of item.arguments) {
    if (argument.expression.type === "FunctionExpression") {
      const fn = argument.expression.identifier?.value;
      if (fn) {
        const pattern = new RegExp(tests.flatMap((test) => test.skip ?? []).join("|"), "i");
        if (pattern.test(fn)) {
          // @ts-ignore
          item.callee.property.value = "test.ignore";
        }
      }
    }
  }
}
