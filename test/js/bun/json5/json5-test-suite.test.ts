// Tests generated from json5/json5-tests official test suite
// Expected values verified against json5@2.2.3 reference implementation
import { JSON5 } from "bun";
import { describe, expect, test } from "bun:test";

describe("arrays", () => {
  test("empty array", () => {
    const input: string = "[]";
    const parsed = JSON5.parse(input);
    const expected: any = [];
    expect(parsed).toEqual(expected);
  });

  test("leading comma array (throws)", () => {
    const input: string = "[\n    ,null\n]";
    expect(() => JSON5.parse(input)).toThrow("Unexpected token");
  });

  test("lone trailing comma array (throws)", () => {
    const input: string = "[\n    ,\n]";
    expect(() => JSON5.parse(input)).toThrow("Unexpected token");
  });

  test("no comma array (throws)", () => {
    const input: string = "[\n    true\n    false\n]";
    expect(() => JSON5.parse(input)).toThrow("Expected ','");
  });

  test("regular array", () => {
    const input: string = "[\n    true,\n    false,\n    null\n]";
    const parsed = JSON5.parse(input);
    const expected: any = [true, false, null];
    expect(parsed).toEqual(expected);
  });

  test("trailing comma array", () => {
    const input: string = "[\n    null,\n]";
    const parsed = JSON5.parse(input);
    const expected: any = [null];
    expect(parsed).toEqual(expected);
  });
});

describe("comments", () => {
  test("block comment following array element", () => {
    const input: string = "[\n    false\n    /*\n        true\n    */\n]";
    const parsed = JSON5.parse(input);
    const expected: any = [false];
    expect(parsed).toEqual(expected);
  });

  test("block comment following top level value", () => {
    const input: string = "null\n/*\n    Some non-comment top-level value is needed;\n    we use null above.\n*/";
    const parsed = JSON5.parse(input);
    const expected: any = null;
    expect(parsed).toEqual(expected);
  });

  test("block comment in string", () => {
    const input: string = '"This /* block comment */ isn\'t really a block comment."';
    const parsed = JSON5.parse(input);
    const expected: any = "This /* block comment */ isn't really a block comment.";
    expect(parsed).toEqual(expected);
  });

  test("block comment preceding top level value", () => {
    const input: string = "/*\n    Some non-comment top-level value is needed;\n    we use null below.\n*/\nnull";
    const parsed = JSON5.parse(input);
    const expected: any = null;
    expect(parsed).toEqual(expected);
  });

  test("block comment with asterisks", () => {
    const input: string =
      "/**\n * This is a JavaDoc-like block comment.\n * It contains asterisks inside of it.\n * It might also be closed with multiple asterisks.\n * Like this:\n **/\ntrue";
    const parsed = JSON5.parse(input);
    const expected: any = true;
    expect(parsed).toEqual(expected);
  });

  test("inline comment following array element", () => {
    const input: string = "[\n    false   // true\n]";
    const parsed = JSON5.parse(input);
    const expected: any = [false];
    expect(parsed).toEqual(expected);
  });

  test("inline comment following top level value", () => {
    const input: string = "null // Some non-comment top-level value is needed; we use null here.";
    const parsed = JSON5.parse(input);
    const expected: any = null;
    expect(parsed).toEqual(expected);
  });

  test("inline comment in string", () => {
    const input: string = '"This inline comment // isn\'t really an inline comment."';
    const parsed = JSON5.parse(input);
    const expected: any = "This inline comment // isn't really an inline comment.";
    expect(parsed).toEqual(expected);
  });

  test("inline comment preceding top level value", () => {
    const input: string = "// Some non-comment top-level value is needed; we use null below.\nnull";
    const parsed = JSON5.parse(input);
    const expected: any = null;
    expect(parsed).toEqual(expected);
  });

  test("top level block comment (throws)", () => {
    const input: string = "/*\n    This should fail;\n    comments cannot be the only top-level value.\n*/";
    expect(() => JSON5.parse(input)).toThrow("Unexpected end of input");
  });

  test("top level inline comment (throws)", () => {
    const input: string = "// This should fail; comments cannot be the only top-level value.";
    expect(() => JSON5.parse(input)).toThrow("Unexpected end of input");
  });

  test("unterminated block comment (throws)", () => {
    const input: string =
      "true\n/*\n    This block comment doesn't terminate.\n    There was a legitimate value before this,\n    but this is still invalid JS/JSON5.\n";
    expect(() => JSON5.parse(input)).toThrow("Unterminated multi-line comment");
  });
});

describe("misc", () => {
  test("empty (throws)", () => {
    const input: string = "";
    expect(() => JSON5.parse(input)).toThrow("Unexpected end of input");
  });

  test("npm package", () => {
    const input: string =
      '{\n  "name": "npm",\n  "publishConfig": {\n    "proprietary-attribs": false\n  },\n  "description": "A package manager for node",\n  "keywords": [\n    "package manager",\n    "modules",\n    "install",\n    "package.json"\n  ],\n  "version": "1.1.22",\n  "preferGlobal": true,\n  "config": {\n    "publishtest": false\n  },\n  "homepage": "http://npmjs.org/",\n  "author": "Isaac Z. Schlueter <i@izs.me> (http://blog.izs.me)",\n  "repository": {\n    "type": "git",\n    "url": "https://github.com/isaacs/npm"\n  },\n  "bugs": {\n    "email": "npm-@googlegroups.com",\n    "url": "http://github.com/isaacs/npm/issues"\n  },\n  "directories": {\n    "doc": "./doc",\n    "man": "./man",\n    "lib": "./lib",\n    "bin": "./bin"\n  },\n  "main": "./lib/npm.js",\n  "bin": "./bin/npm-cli.js",\n  "dependencies": {\n    "semver": "~1.0.14",\n    "ini": "1",\n    "slide": "1",\n    "abbrev": "1",\n    "graceful-fs": "~1.1.1",\n    "minimatch": "~0.2",\n    "nopt": "1",\n    "node-uuid": "~1.3",\n    "proto-list": "1",\n    "rimraf": "2",\n    "request": "~2.9",\n    "which": "1",\n    "tar": "~0.1.12",\n    "fstream": "~0.1.17",\n    "block-stream": "*",\n    "inherits": "1",\n    "mkdirp": "0.3",\n    "read": "0",\n    "lru-cache": "1",\n    "node-gyp": "~0.4.1",\n    "fstream-npm": "0 >=0.0.5",\n    "uid-number": "0",\n    "archy": "0",\n    "chownr": "0"\n  },\n  "bundleDependencies": [\n    "slide",\n    "ini",\n    "semver",\n    "abbrev",\n    "graceful-fs",\n    "minimatch",\n    "nopt",\n    "node-uuid",\n    "rimraf",\n    "request",\n    "proto-list",\n    "which",\n    "tar",\n    "fstream",\n    "block-stream",\n    "inherits",\n    "mkdirp",\n    "read",\n    "lru-cache",\n    "node-gyp",\n    "fstream-npm",\n    "uid-number",\n    "archy",\n    "chownr"\n  ],\n  "devDependencies": {\n    "ronn": "https://github.com/isaacs/ronnjs/tarball/master"\n  },\n  "engines": {\n    "node": "0.6 || 0.7 || 0.8",\n    "npm": "1"\n  },\n  "scripts": {\n    "test": "node ./test/run.js",\n    "prepublish": "npm prune; rm -rf node_modules/*/{test,example,bench}*; make -j4 doc",\n    "dumpconf": "env | grep npm | sort | uniq"\n  },\n  "licenses": [\n    {\n      "type": "MIT +no-false-attribs",\n      "url": "http://github.com/isaacs/npm/raw/master/LICENSE"\n    }\n  ]\n}\n';
    const parsed = JSON5.parse(input);
    const expected: any = {
      name: "npm",
      publishConfig: { "proprietary-attribs": false },
      description: "A package manager for node",
      keywords: ["package manager", "modules", "install", "package.json"],
      version: "1.1.22",
      preferGlobal: true,
      config: { publishtest: false },
      homepage: "http://npmjs.org/",
      author: "Isaac Z. Schlueter <i@izs.me> (http://blog.izs.me)",
      repository: { type: "git", url: "https://github.com/isaacs/npm" },
      bugs: { email: "npm-@googlegroups.com", url: "http://github.com/isaacs/npm/issues" },
      directories: { doc: "./doc", man: "./man", lib: "./lib", bin: "./bin" },
      main: "./lib/npm.js",
      bin: "./bin/npm-cli.js",
      dependencies: {
        semver: "~1.0.14",
        ini: "1",
        slide: "1",
        abbrev: "1",
        "graceful-fs": "~1.1.1",
        minimatch: "~0.2",
        nopt: "1",
        "node-uuid": "~1.3",
        "proto-list": "1",
        rimraf: "2",
        request: "~2.9",
        which: "1",
        tar: "~0.1.12",
        fstream: "~0.1.17",
        "block-stream": "*",
        inherits: "1",
        mkdirp: "0.3",
        read: "0",
        "lru-cache": "1",
        "node-gyp": "~0.4.1",
        "fstream-npm": "0 >=0.0.5",
        "uid-number": "0",
        archy: "0",
        chownr: "0",
      },
      bundleDependencies: [
        "slide",
        "ini",
        "semver",
        "abbrev",
        "graceful-fs",
        "minimatch",
        "nopt",
        "node-uuid",
        "rimraf",
        "request",
        "proto-list",
        "which",
        "tar",
        "fstream",
        "block-stream",
        "inherits",
        "mkdirp",
        "read",
        "lru-cache",
        "node-gyp",
        "fstream-npm",
        "uid-number",
        "archy",
        "chownr",
      ],
      devDependencies: { ronn: "https://github.com/isaacs/ronnjs/tarball/master" },
      engines: { node: "0.6 || 0.7 || 0.8", npm: "1" },
      scripts: {
        test: "node ./test/run.js",
        prepublish: "npm prune; rm -rf node_modules/*/{test,example,bench}*; make -j4 doc",
        dumpconf: "env | grep npm | sort | uniq",
      },
      licenses: [
        {
          type: "MIT +no-false-attribs",
          url: "http://github.com/isaacs/npm/raw/master/LICENSE",
        },
      ],
    };
    expect(parsed).toEqual(expected);
  });

  test("npm package", () => {
    const input: string =
      "{\n  name: 'npm',\n  publishConfig: {\n    'proprietary-attribs': false,\n  },\n  description: 'A package manager for node',\n  keywords: [\n    'package manager',\n    'modules',\n    'install',\n    'package.json',\n  ],\n  version: '1.1.22',\n  preferGlobal: true,\n  config: {\n    publishtest: false,\n  },\n  homepage: 'http://npmjs.org/',\n  author: 'Isaac Z. Schlueter <i@izs.me> (http://blog.izs.me)',\n  repository: {\n    type: 'git',\n    url: 'https://github.com/isaacs/npm',\n  },\n  bugs: {\n    email: 'npm-@googlegroups.com',\n    url: 'http://github.com/isaacs/npm/issues',\n  },\n  directories: {\n    doc: './doc',\n    man: './man',\n    lib: './lib',\n    bin: './bin',\n  },\n  main: './lib/npm.js',\n  bin: './bin/npm-cli.js',\n  dependencies: {\n    semver: '~1.0.14',\n    ini: '1',\n    slide: '1',\n    abbrev: '1',\n    'graceful-fs': '~1.1.1',\n    minimatch: '~0.2',\n    nopt: '1',\n    'node-uuid': '~1.3',\n    'proto-list': '1',\n    rimraf: '2',\n    request: '~2.9',\n    which: '1',\n    tar: '~0.1.12',\n    fstream: '~0.1.17',\n    'block-stream': '*',\n    inherits: '1',\n    mkdirp: '0.3',\n    read: '0',\n    'lru-cache': '1',\n    'node-gyp': '~0.4.1',\n    'fstream-npm': '0 >=0.0.5',\n    'uid-number': '0',\n    archy: '0',\n    chownr: '0',\n  },\n  bundleDependencies: [\n    'slide',\n    'ini',\n    'semver',\n    'abbrev',\n    'graceful-fs',\n    'minimatch',\n    'nopt',\n    'node-uuid',\n    'rimraf',\n    'request',\n    'proto-list',\n    'which',\n    'tar',\n    'fstream',\n    'block-stream',\n    'inherits',\n    'mkdirp',\n    'read',\n    'lru-cache',\n    'node-gyp',\n    'fstream-npm',\n    'uid-number',\n    'archy',\n    'chownr',\n  ],\n  devDependencies: {\n    ronn: 'https://github.com/isaacs/ronnjs/tarball/master',\n  },\n  engines: {\n    node: '0.6 || 0.7 || 0.8',\n    npm: '1',\n  },\n  scripts: {\n    test: 'node ./test/run.js',\n    prepublish: 'npm prune; rm -rf node_modules/*/{test,example,bench}*; make -j4 doc',\n    dumpconf: 'env | grep npm | sort | uniq',\n  },\n  licenses: [\n    {\n      type: 'MIT +no-false-attribs',\n      url: 'http://github.com/isaacs/npm/raw/master/LICENSE',\n    },\n  ],\n}\n";
    const parsed = JSON5.parse(input);
    const expected: any = {
      name: "npm",
      publishConfig: { "proprietary-attribs": false },
      description: "A package manager for node",
      keywords: ["package manager", "modules", "install", "package.json"],
      version: "1.1.22",
      preferGlobal: true,
      config: { publishtest: false },
      homepage: "http://npmjs.org/",
      author: "Isaac Z. Schlueter <i@izs.me> (http://blog.izs.me)",
      repository: { type: "git", url: "https://github.com/isaacs/npm" },
      bugs: { email: "npm-@googlegroups.com", url: "http://github.com/isaacs/npm/issues" },
      directories: { doc: "./doc", man: "./man", lib: "./lib", bin: "./bin" },
      main: "./lib/npm.js",
      bin: "./bin/npm-cli.js",
      dependencies: {
        semver: "~1.0.14",
        ini: "1",
        slide: "1",
        abbrev: "1",
        "graceful-fs": "~1.1.1",
        minimatch: "~0.2",
        nopt: "1",
        "node-uuid": "~1.3",
        "proto-list": "1",
        rimraf: "2",
        request: "~2.9",
        which: "1",
        tar: "~0.1.12",
        fstream: "~0.1.17",
        "block-stream": "*",
        inherits: "1",
        mkdirp: "0.3",
        read: "0",
        "lru-cache": "1",
        "node-gyp": "~0.4.1",
        "fstream-npm": "0 >=0.0.5",
        "uid-number": "0",
        archy: "0",
        chownr: "0",
      },
      bundleDependencies: [
        "slide",
        "ini",
        "semver",
        "abbrev",
        "graceful-fs",
        "minimatch",
        "nopt",
        "node-uuid",
        "rimraf",
        "request",
        "proto-list",
        "which",
        "tar",
        "fstream",
        "block-stream",
        "inherits",
        "mkdirp",
        "read",
        "lru-cache",
        "node-gyp",
        "fstream-npm",
        "uid-number",
        "archy",
        "chownr",
      ],
      devDependencies: { ronn: "https://github.com/isaacs/ronnjs/tarball/master" },
      engines: { node: "0.6 || 0.7 || 0.8", npm: "1" },
      scripts: {
        test: "node ./test/run.js",
        prepublish: "npm prune; rm -rf node_modules/*/{test,example,bench}*; make -j4 doc",
        dumpconf: "env | grep npm | sort | uniq",
      },
      licenses: [
        {
          type: "MIT +no-false-attribs",
          url: "http://github.com/isaacs/npm/raw/master/LICENSE",
        },
      ],
    };
    expect(parsed).toEqual(expected);
  });

  test("readme example", () => {
    const input: string =
      "{\n    foo: 'bar',\n    while: true,\n\n    this: 'is a \\\nmulti-line string',\n\n    // this is an inline comment\n    here: 'is another', // inline comment\n\n    /* this is a block comment\n       that continues on another line */\n\n    hex: 0xDEADbeef,\n    half: .5,\n    delta: +10,\n    to: Infinity,   // and beyond!\n\n    finally: 'a trailing comma',\n    oh: [\n        \"we shouldn't forget\",\n        'arrays can have',\n        'trailing commas too',\n    ],\n}\n";
    const parsed = JSON5.parse(input);
    const expected: any = {
      foo: "bar",
      while: true,
      this: "is a multi-line string",
      here: "is another",
      hex: 3735928559,
      half: 0.5,
      delta: 10,
      to: Infinity,
      finally: "a trailing comma",
      oh: ["we shouldn't forget", "arrays can have", "trailing commas too"],
    };
    expect(parsed).toEqual(expected);
  });

  test("valid whitespace", () => {
    const input: string =
      '{\n \f   // An invalid form feed character (\\x0c) has been entered before this comment.\n    // Be careful not to delete it.\n  "a": true\n}\n';
    const parsed = JSON5.parse(input);
    const expected: any = { a: true };
    expect(parsed).toEqual(expected);
  });
});

describe("new-lines", () => {
  test("comment cr", () => {
    const input: string = "{\r    // This comment is terminated with `\\r`.\r}\r";
    const parsed = JSON5.parse(input);
    const expected: any = {};
    expect(parsed).toEqual(expected);
  });

  test("comment crlf", () => {
    const input: string = "{\r\n    // This comment is terminated with `\\r\\n`.\r\n}\r\n";
    const parsed = JSON5.parse(input);
    const expected: any = {};
    expect(parsed).toEqual(expected);
  });

  test("comment lf", () => {
    const input: string = "{\n    // This comment is terminated with `\\n`.\n}\n";
    const parsed = JSON5.parse(input);
    const expected: any = {};
    expect(parsed).toEqual(expected);
  });

  test("escaped cr", () => {
    const input: string = "{\r    // the following string contains an escaped `\\r`\r    a: 'line 1 \\\rline 2'\r}\r";
    const parsed = JSON5.parse(input);
    const expected: any = { a: "line 1 line 2" };
    expect(parsed).toEqual(expected);
  });

  test("escaped crlf", () => {
    const input: string =
      "{\r\n    // the following string contains an escaped `\\r\\n`\r\n    a: 'line 1 \\\r\nline 2'\r\n}\r\n";
    const parsed = JSON5.parse(input);
    const expected: any = { a: "line 1 line 2" };
    expect(parsed).toEqual(expected);
  });

  test("escaped lf", () => {
    const input: string = "{\n    // the following string contains an escaped `\\n`\n    a: 'line 1 \\\nline 2'\n}\n";
    const parsed = JSON5.parse(input);
    const expected: any = { a: "line 1 line 2" };
    expect(parsed).toEqual(expected);
  });
});

describe("numbers", () => {
  test("float leading decimal point", () => {
    const input: string = ".5\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0.5;
    expect(parsed).toEqual(expected);
  });

  test("float leading zero", () => {
    const input: string = "0.5\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0.5;
    expect(parsed).toEqual(expected);
  });

  test("float trailing decimal point with integer exponent", () => {
    const input: string = "5.e4\n";
    const parsed = JSON5.parse(input);
    const expected: any = 50000;
    expect(parsed).toEqual(expected);
  });

  test("float trailing decimal point", () => {
    const input: string = "5.\n";
    const parsed = JSON5.parse(input);
    const expected: any = 5;
    expect(parsed).toEqual(expected);
  });

  test("float with integer exponent", () => {
    const input: string = "1.2e3\n";
    const parsed = JSON5.parse(input);
    const expected: any = 1200;
    expect(parsed).toEqual(expected);
  });

  test("float", () => {
    const input: string = "1.2\n";
    const parsed = JSON5.parse(input);
    const expected: any = 1.2;
    expect(parsed).toEqual(expected);
  });

  test("hexadecimal empty (throws)", () => {
    const input: string = "0x\n";
    expect(() => JSON5.parse(input)).toThrow("Invalid hex number");
  });

  test("hexadecimal lowercase letter", () => {
    const input: string = "0xc8\n";
    const parsed = JSON5.parse(input);
    const expected: any = 200;
    expect(parsed).toEqual(expected);
  });

  test("hexadecimal uppercase x", () => {
    const input: string = "0XC8\n";
    const parsed = JSON5.parse(input);
    const expected: any = 200;
    expect(parsed).toEqual(expected);
  });

  test("hexadecimal with integer exponent", () => {
    const input: string = "0xc8e4\n";
    const parsed = JSON5.parse(input);
    const expected: any = 51428;
    expect(parsed).toEqual(expected);
  });

  test("hexadecimal", () => {
    const input: string = "0xC8\n";
    const parsed = JSON5.parse(input);
    const expected: any = 200;
    expect(parsed).toEqual(expected);
  });

  test("infinity", () => {
    const input: string = "Infinity\n";
    const parsed = JSON5.parse(input);
    const expected: any = Infinity;
    expect(parsed).toEqual(expected);
  });

  test("integer with float exponent (throws)", () => {
    const input: string = "1e2.3\n";
    expect(() => JSON5.parse(input)).toThrow("Unexpected token after JSON5 value");
  });

  test("integer with hexadecimal exponent (throws)", () => {
    const input: string = "1e0x4\n";
    expect(() => JSON5.parse(input)).toThrow("Unexpected token after JSON5 value");
  });

  test("integer with integer exponent", () => {
    const input: string = "2e23\n";
    const parsed = JSON5.parse(input);
    const expected: any = 2e23;
    expect(parsed).toEqual(expected);
  });

  test("integer with negative float exponent (throws)", () => {
    const input: string = "1e-2.3\n";
    expect(() => JSON5.parse(input)).toThrow("Unexpected token after JSON5 value");
  });

  test("integer with negative hexadecimal exponent (throws)", () => {
    const input: string = "1e-0x4\n";
    expect(() => JSON5.parse(input)).toThrow("Unexpected token after JSON5 value");
  });

  test("integer with negative integer exponent", () => {
    const input: string = "2e-23\n";
    const parsed = JSON5.parse(input);
    const expected: any = 2e-23;
    expect(parsed).toEqual(expected);
  });

  test("integer with negative zero integer exponent", () => {
    const input: string = "5e-0\n";
    const parsed = JSON5.parse(input);
    const expected: any = 5;
    expect(parsed).toEqual(expected);
  });

  test("integer with positive float exponent (throws)", () => {
    const input: string = "1e+2.3\n";
    expect(() => JSON5.parse(input)).toThrow("Unexpected token after JSON5 value");
  });

  test("integer with positive hexadecimal exponent (throws)", () => {
    const input: string = "1e+0x4\n";
    expect(() => JSON5.parse(input)).toThrow("Unexpected token after JSON5 value");
  });

  test("integer with positive integer exponent", () => {
    const input: string = "1e+2\n";
    const parsed = JSON5.parse(input);
    const expected: any = 100;
    expect(parsed).toEqual(expected);
  });

  test("integer with positive zero integer exponent", () => {
    const input: string = "5e+0\n";
    const parsed = JSON5.parse(input);
    const expected: any = 5;
    expect(parsed).toEqual(expected);
  });

  test("integer with zero integer exponent", () => {
    const input: string = "5e0\n";
    const parsed = JSON5.parse(input);
    const expected: any = 5;
    expect(parsed).toEqual(expected);
  });

  test("integer", () => {
    const input: string = "15\n";
    const parsed = JSON5.parse(input);
    const expected: any = 15;
    expect(parsed).toEqual(expected);
  });

  test("lone decimal point (throws)", () => {
    const input: string = ".\n";
    expect(() => JSON5.parse(input)).toThrow("Invalid number");
  });

  test("nan", () => {
    const input: string = "NaN\n";
    const parsed = JSON5.parse(input);
    expect(Number.isNaN(parsed)).toBe(true);
  });

  test("negative float leading decimal point", () => {
    const input: string = "-.5\n";
    const parsed = JSON5.parse(input);
    const expected: any = -0.5;
    expect(parsed).toEqual(expected);
  });

  test("negative float leading zero", () => {
    const input: string = "-0.5\n";
    const parsed = JSON5.parse(input);
    const expected: any = -0.5;
    expect(parsed).toEqual(expected);
  });

  test("negative float trailing decimal point", () => {
    const input: string = "-5.\n";
    const parsed = JSON5.parse(input);
    const expected: any = -5;
    expect(parsed).toEqual(expected);
  });

  test("negative float", () => {
    const input: string = "-1.2\n";
    const parsed = JSON5.parse(input);
    const expected: any = -1.2;
    expect(parsed).toEqual(expected);
  });

  test("negative hexadecimal", () => {
    const input: string = "-0xC8\n";
    const parsed = JSON5.parse(input);
    const expected: any = -200;
    expect(parsed).toEqual(expected);
  });

  test("negative infinity", () => {
    const input: string = "-Infinity\n";
    const parsed = JSON5.parse(input);
    const expected: any = -Infinity;
    expect(parsed).toEqual(expected);
  });

  test("negative integer", () => {
    const input: string = "-15\n";
    const parsed = JSON5.parse(input);
    const expected: any = -15;
    expect(parsed).toEqual(expected);
  });

  test("negative noctal (throws)", () => {
    const input: string = "-098\n";
    expect(() => JSON5.parse(input)).toThrow("Leading zeros are not allowed in JSON5");
  });

  test("negative octal (throws)", () => {
    const input: string = "-0123\n";
    expect(() => JSON5.parse(input)).toThrow("Leading zeros are not allowed in JSON5");
  });

  test("negative zero float leading decimal point", () => {
    const input: string = "-.0\n";
    const parsed = JSON5.parse(input);
    const expected: any = -0;
    expect(parsed).toEqual(expected);
  });

  test("negative zero float trailing decimal point", () => {
    const input: string = "-0.\n";
    const parsed = JSON5.parse(input);
    const expected: any = -0;
    expect(parsed).toEqual(expected);
  });

  test("negative zero float", () => {
    const input: string = "-0.0\n";
    const parsed = JSON5.parse(input);
    const expected: any = -0;
    expect(parsed).toEqual(expected);
  });

  test("negative zero hexadecimal", () => {
    const input: string = "-0x0\n";
    const parsed = JSON5.parse(input);
    const expected: any = -0;
    expect(parsed).toEqual(expected);
  });

  test("negative zero integer", () => {
    const input: string = "-0\n";
    const parsed = JSON5.parse(input);
    const expected: any = -0;
    expect(parsed).toEqual(expected);
  });

  test("negative zero octal (throws)", () => {
    const input: string = "-00\n";
    expect(() => JSON5.parse(input)).toThrow("Leading zeros are not allowed in JSON5");
  });

  test("noctal with leading octal digit (throws)", () => {
    const input: string = "0780\n";
    expect(() => JSON5.parse(input)).toThrow("Leading zeros are not allowed in JSON5");
  });

  test("noctal (throws)", () => {
    const input: string = "080\n";
    expect(() => JSON5.parse(input)).toThrow("Leading zeros are not allowed in JSON5");
  });

  test("octal (throws)", () => {
    const input: string = "010\n";
    expect(() => JSON5.parse(input)).toThrow("Leading zeros are not allowed in JSON5");
  });

  test("positive float leading decimal point", () => {
    const input: string = "+.5\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0.5;
    expect(parsed).toEqual(expected);
  });

  test("positive float leading zero", () => {
    const input: string = "+0.5\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0.5;
    expect(parsed).toEqual(expected);
  });

  test("positive float trailing decimal point", () => {
    const input: string = "+5.\n";
    const parsed = JSON5.parse(input);
    const expected: any = 5;
    expect(parsed).toEqual(expected);
  });

  test("positive float", () => {
    const input: string = "+1.2\n";
    const parsed = JSON5.parse(input);
    const expected: any = 1.2;
    expect(parsed).toEqual(expected);
  });

  test("positive hexadecimal", () => {
    const input: string = "+0xC8\n";
    const parsed = JSON5.parse(input);
    const expected: any = 200;
    expect(parsed).toEqual(expected);
  });

  test("positive infinity", () => {
    const input: string = "+Infinity\n";
    const parsed = JSON5.parse(input);
    const expected: any = Infinity;
    expect(parsed).toEqual(expected);
  });

  test("positive integer", () => {
    const input: string = "+15\n";
    const parsed = JSON5.parse(input);
    const expected: any = 15;
    expect(parsed).toEqual(expected);
  });

  test("positive noctal (throws)", () => {
    const input: string = "+098\n";
    expect(() => JSON5.parse(input)).toThrow("Leading zeros are not allowed in JSON5");
  });

  test("positive octal (throws)", () => {
    const input: string = "+0123\n";
    expect(() => JSON5.parse(input)).toThrow("Leading zeros are not allowed in JSON5");
  });

  test("positive zero float leading decimal point", () => {
    const input: string = "+.0\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0;
    expect(parsed).toEqual(expected);
  });

  test("positive zero float trailing decimal point", () => {
    const input: string = "+0.\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0;
    expect(parsed).toEqual(expected);
  });

  test("positive zero float", () => {
    const input: string = "+0.0\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0;
    expect(parsed).toEqual(expected);
  });

  test("positive zero hexadecimal", () => {
    const input: string = "+0x0\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0;
    expect(parsed).toEqual(expected);
  });

  test("positive zero integer", () => {
    const input: string = "+0\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0;
    expect(parsed).toEqual(expected);
  });

  test("positive zero octal (throws)", () => {
    const input: string = "+00\n";
    expect(() => JSON5.parse(input)).toThrow("Leading zeros are not allowed in JSON5");
  });

  test("zero float leading decimal point", () => {
    const input: string = ".0\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0;
    expect(parsed).toEqual(expected);
  });

  test("zero float trailing decimal point", () => {
    const input: string = "0.\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0;
    expect(parsed).toEqual(expected);
  });

  test("zero float", () => {
    const input: string = "0.0\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0;
    expect(parsed).toEqual(expected);
  });

  test("zero hexadecimal", () => {
    const input: string = "0x0\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0;
    expect(parsed).toEqual(expected);
  });

  test("zero integer with integer exponent", () => {
    const input: string = "0e23\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0;
    expect(parsed).toEqual(expected);
  });

  test("zero integer", () => {
    const input: string = "0\n";
    const parsed = JSON5.parse(input);
    const expected: any = 0;
    expect(parsed).toEqual(expected);
  });

  test("zero octal (throws)", () => {
    const input: string = "00\n";
    expect(() => JSON5.parse(input)).toThrow("Leading zeros are not allowed in JSON5");
  });
});

describe("objects", () => {
  test("duplicate keys", () => {
    const input: string = '{\n    "a": true,\n    "a": false\n}\n';
    const parsed = JSON5.parse(input);
    const expected: any = { a: false };
    expect(parsed).toEqual(expected);
  });

  test("empty object", () => {
    const input: string = "{}";
    const parsed = JSON5.parse(input);
    const expected: any = {};
    expect(parsed).toEqual(expected);
  });

  test("illegal unquoted key number (throws)", () => {
    const input: string = '{\n    10twenty: "ten twenty"\n}';
    expect(() => JSON5.parse(input)).toThrow("Invalid identifier start character");
  });

  test("illegal unquoted key symbol (throws)", () => {
    const input: string = '{\n    multi-word: "multi-word"\n}';
    expect(() => JSON5.parse(input)).toThrow("Unexpected character");
  });

  test("leading comma object (throws)", () => {
    const input: string = '{\n    ,"foo": "bar"\n}';
    expect(() => JSON5.parse(input)).toThrow("Invalid identifier start character");
  });

  test("lone trailing comma object (throws)", () => {
    const input: string = "{\n    ,\n}";
    expect(() => JSON5.parse(input)).toThrow("Invalid identifier start character");
  });

  test("no comma object (throws)", () => {
    const input: string = '{\n    "foo": "bar"\n    "hello": "world"\n}';
    expect(() => JSON5.parse(input)).toThrow("Expected ','");
  });

  test("reserved unquoted key", () => {
    const input: string = "{\n    while: true\n}";
    const parsed = JSON5.parse(input);
    const expected: any = { while: true };
    expect(parsed).toEqual(expected);
  });

  test("single quoted key", () => {
    const input: string = "{\n    'hello': \"world\"\n}";
    const parsed = JSON5.parse(input);
    const expected: any = { hello: "world" };
    expect(parsed).toEqual(expected);
  });

  test("trailing comma object", () => {
    const input: string = '{\n    "foo": "bar",\n}';
    const parsed = JSON5.parse(input);
    const expected: any = { foo: "bar" };
    expect(parsed).toEqual(expected);
  });

  test("unquoted keys", () => {
    const input: string =
      '{\n    hello: "world",\n    _: "underscore",\n    $: "dollar sign",\n    one1: "numerals",\n    _$_: "multiple symbols",\n    $_$hello123world_$_: "mixed"\n}';
    const parsed = JSON5.parse(input);
    const expected: any = {
      hello: "world",
      _: "underscore",
      $: "dollar sign",
      one1: "numerals",
      _$_: "multiple symbols",
      $_$hello123world_$_: "mixed",
    };
    expect(parsed).toEqual(expected);
  });
});

describe("strings", () => {
  test("escaped single quoted string", () => {
    const input: string = "'I can\\'t wait'";
    const parsed = JSON5.parse(input);
    const expected: any = "I can't wait";
    expect(parsed).toEqual(expected);
  });

  test("multi line string", () => {
    const input: string = "'hello\\\n world'";
    const parsed = JSON5.parse(input);
    const expected: any = "hello world";
    expect(parsed).toEqual(expected);
  });

  test("single quoted string", () => {
    const input: string = "'hello world'";
    const parsed = JSON5.parse(input);
    const expected: any = "hello world";
    expect(parsed).toEqual(expected);
  });

  test("unescaped multi line string (throws)", () => {
    const input: string = '"foo\nbar"\n';
    expect(() => JSON5.parse(input)).toThrow("Unterminated string");
  });
});

describe("todo", () => {
  test("unicode escaped unquoted key", () => {
    const input: string = '{\n    sig\\u03A3ma: "the sum of all things"\n}';
    const parsed = JSON5.parse(input);
    const expected: any = { "sigΣma": "the sum of all things" };
    expect(parsed).toEqual(expected);
  });

  test("unicode unquoted key", () => {
    const input: string = '{\n    ümlåût: "that\'s not really an ümlaüt, but this is"\n}';
    const parsed = JSON5.parse(input);
    const expected: any = { "ümlåût": "that's not really an ümlaüt, but this is" };
    expect(parsed).toEqual(expected);
  });
});
