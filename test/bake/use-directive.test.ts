import { scanUseDirective } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

// The bundler looks for "use client" and "use server" before it parses a file,
// because the directive picks the target the file is parsed for. The scan runs
// the lexer over the start of the file. The directive has to be the first
// statement. Comments and a hashbang can come before it.

/** The use directive of `source`, with the string literal the scan took it from. */
function scan(source: string) {
  const found = scanUseDirective(source);
  if (found === null) return null;
  const literal = Buffer.from(source).subarray(found.start, found.start + found.length);
  return `${found.directive} ${literal}`;
}

function expectScan(cases: [source: string, expected: string | null][]) {
  expect(cases.map(([source]) => [source, scan(source)])).toEqual(cases);
}

describe("use directive scan", () => {
  test("finds a directive that is the first statement", () => {
    expectScan([
      [`"use client";`, `client "use client"`],
      [`'use client'`, `client 'use client'`],
      [`"use server";\nexport async function save() {}`, `server "use server"`],
      [`"use client"\nexport {}`, `client "use client"`],
      [`  \n\t"use client";`, `client "use client"`],
      // Comments and a hashbang can come first.
      [`// Copyright (c) Example.\n"use client";`, `client "use client"`],
      [`/* eslint-disable */ "use client";`, `client "use client"`],
      [`/**\n * @license MIT\n */\n\n// @ts-nocheck\n'use client'\nimport "./a";`, `client 'use client'`],
      [`#!/usr/bin/env bun\n"use client";`, `client "use client"`],
      [`#!/usr/bin/env bun\r\n// banner\r\n"use server";\r\nexport {};\r\n`, `server "use server"`],
      [`"use client";\n"use server";`, `client "use client"`],
      // A comment can follow the string literal.
      [`"use client" // runs in the browser\nexport {}`, `client "use client"`],
      [`"use client" /* runs in the browser */;`, `client "use client"`],
      [`"use client" /*\n*/ export {}`, `client "use client"`],
      // White space and line breaks that are not ASCII.
      [`\uFEFF"use client";`, `client "use client"`],
      [`\u00A0"use client";`, `client "use client"`],
      [`// banner\u2028"use client";`, `client "use client"`],
      [`"use client"\u2029export {}`, `client "use client"`],
    ]);
  });

  test("ignores a string that is not a directive", () => {
    expectScan([
      [``, null],
      [`export {}`, null],
      [`"use clients";`, null],
      [`"use\\x20client";`, null],
      [`\`use client\`;`, null],
      [`("use client");`, null],
      // The string literal is only a part of the statement.
      [`"use client".length;`, null],
      [`"use client" + "";`, null],
      [`"use client" as const;`, null],
      [`"use client" export {}`, null],
      // Another directive comes first. Compilers emit this for CommonJS, and
      // the bundler cannot list the exports of a CommonJS client module.
      [`"use strict";\n"use client";`, null],
      [`'use strict'\n"use server"`, null],
      // A statement comes first.
      [`;"use client";`, null],
      [`import "./a";\n"use client";`, null],
      [`type A = 1;\n"use client";`, null],
      // The directive is inside a comment.
      [`// "use client";\nexport {}`, null],
      [`/* "use client"; */`, null],
      // The lexer rejects the source.
      [`/* "use client";`, null],
      [`"use client`, null],
      [`\n#!/usr/bin/env bun\n"use client";`, null],
    ]);
  });

  // No semicolon is inserted at a line break when the next token continues
  // the expression.
  test("follows automatic semicolon insertion after the string literal", () => {
    const nextStatements = [
      `import "./a";`,
      `export {};`,
      `const a = 1;`,
      `function f() {}`,
      `async function f() {}`,
      `class A {}`,
      `@decorator class A {}`,
      `interface A {}`,
      `{}`,
      `x();`,
      `index();`,
      `instance();`,
      `as;`,
      `satisfies;`,
      `new X();`,
      `void 0;`,
      `typeof x;`,
      `!function () {}();`,
      `~x;`,
      `++x;`,
      `--x;`,
      `.5;`,
      `0;`,
      `"use strict";`,
      `/* comment */ x;`,
    ];
    expectScan(nextStatements.map(next => [`"use client"\n${next}`, `client "use client"`]));

    const continuations = [
      `.length;`,
      `?.length;`,
      `(0);`,
      `[0];`,
      "`x`;",
      "`${x}`;",
      `, 0;`,
      `? 0 : 1;`,
      ...[`??`, `||`, `&&`, `|`, `^`, `&`, `<<`, `>>`, `>>>`, `+`, `-`, `*`, `/`, `%`, `**`].flatMap(operator => [
        `${operator} 0;`,
        `${operator}= 0;`,
      ]),
      ...[`=`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `in`, `instanceof`].map(operator => `${operator} x;`),
    ];
    expectScan(continuations.map(next => [`"use client"\n${next}`, null]));
    expectScan(continuations.map(next => [`"use client" /*\n*/ ${next}`, null]));
  });
});
