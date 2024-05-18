import { describe, test, expect, it } from "bun:test";
import { patchInternals } from "bun:internal-for-testing";
const { parse } = patchInternals;

describe("parse", () => {
  test("works for a simple case", () => {
    expect(JSON.parse(parse(patch))).toEqual({
      "parts": {
        "items": [
          {
            "file_patch": {
              "path": "banana.ts",
              "hunks": {
                "items": [
                  {
                    "header": { "original": { "start": 1, "len": 5 }, "patched": { "start": 1, "len": 5 } },
                    "parts": {
                      "items": [
                        {
                          "type": "context",
                          "lines": { "items": ["this", "is", ""], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "deletion",
                          "lines": { "items": ["a"], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": { "items": [""], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "context",
                          "lines": { "items": ["file"], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                      ],
                      "capacity": 8,
                    },
                  },
                ],
                "capacity": 8,
              },
              "before_hash": "2de83dd",
              "after_hash": "842652c",
            },
          },
        ],
        "capacity": 8,
      },
    });
  });

  test("fails when the patch file has invalid headers", () => {
    expect(() => parse(invalidHeaders1)).toThrow();
    expect(() => parse(invalidHeaders2)).toThrow();
    expect(() => parse(invalidHeaders3)).toThrow();
    expect(() => parse(invalidHeaders4)).toThrow();
    expect(() => parse(invalidHeaders5)).toThrow();
  });

  test("is OK when blank lines are accidentally created", () => {
    expect(parse(accidentalBlankLine)).toEqual(parse(patch));
  });

  test(`can handle files with CRLF line breaks`, () => {
    expect(JSON.parse(parse(crlfLineBreaks))).toEqual({
      "parts": {
        "items": [
          {
            "file_creation": {
              "path": "banana.ts",
              "mode": "non_executable",
              "hunk": {
                "header": { "original": { "start": 1, "len": 0 }, "patched": { "start": 1, "len": 1 } },
                "parts": {
                  "items": [
                    {
                      "type": "insertion",
                      "lines": { "items": ["this is a new file\r"], "capacity": 8 },
                      "no_newline_at_end_of_file": false,
                    },
                  ],
                  "capacity": 8,
                },
              },
              "hash": "3e1267f",
            },
          },
        ],
        "capacity": 8,
      },
    });
  });

  test("works", () => {
    expect(JSON.parse(parse(modeChangeAndModifyAndRename))).toEqual({
      "parts": {
        "items": [
          { "file_rename": { "from_path": "numbers.txt", "to_path": "banana.txt" } },
          { "file_mode_change": { "path": "banana.txt", "old_mode": "non_executable", "new_mode": "executable" } },
          {
            "file_patch": {
              "path": "banana.txt",
              "hunks": {
                "items": [
                  {
                    "header": { "original": { "start": 1, "len": 4 }, "patched": { "start": 1, "len": 4 } },
                    "parts": {
                      "items": [
                        {
                          "type": "deletion",
                          "lines": { "items": ["one"], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": { "items": ["ne"], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "context",
                          "lines": { "items": ["", "two", ""], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                      ],
                      "capacity": 8,
                    },
                  },
                ],
                "capacity": 8,
              },
              "before_hash": "fbf1785",
              "after_hash": "92d2c5f",
            },
          },
        ],
        "capacity": 8,
      },
    });
  });

  test("parses old-style patches", () => {
    expect(JSON.parse(parse(oldStylePatch))).toEqual({
      "parts": {
        "items": [
          {
            "file_patch": {
              "path": "node_modules/graphql/utilities/assertValidName.js",
              "hunks": {
                "items": [
                  {
                    "header": { "original": { "start": 41, "len": 10 }, "patched": { "start": 41, "len": 11 } },
                    "parts": {
                      "items": [
                        {
                          "type": "context",
                          "lines": {
                            "items": [
                              " */",
                              "function isValidNameError(name, node) {",
                              "  !(typeof name === 'string') ? (0, _invariant2.default)(0, 'Expected string') : void 0;",
                            ],
                            "capacity": 8,
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "deletion",
                          "lines": {
                            "items": [
                              "  if (name.length > 1 && name[0] === '_' && name[1] === '_') {",
                              "    return new _GraphQLError.GraphQLError('Name \"' + name + '\" must not begin with \"__\", which is reserved by ' + 'GraphQL introspection.', node);",
                              "  }",
                            ],
                            "capacity": 8,
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": {
                            "items": [
                              "  // if (name.length > 1 && name[0] === '_' && name[1] === '_') {",
                              "  //   return new _GraphQLError.GraphQLError('Name \"' + name + '\" must not begin with \"__\", which is reserved by ' + 'GraphQL introspection.', node);",
                              "  // }",
                            ],
                            "capacity": 8,
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "context",
                          "lines": {
                            "items": [
                              "  if (!NAME_RX.test(name)) {",
                              "    return new _GraphQLError.GraphQLError('Names must match /^[_a-zA-Z][_a-zA-Z0-9]*$/ but \"' + name + '\" does not.', node);",
                              "  }",
                            ],
                            "capacity": 8,
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": { "items": [""], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "context",
                          "lines": { "items": ["}"], "capacity": 8 },
                          "no_newline_at_end_of_file": true,
                        },
                      ],
                      "capacity": 8,
                    },
                  },
                ],
                "capacity": 8,
              },
              "before_hash": null,
              "after_hash": null,
            },
          },
          {
            "file_patch": {
              "path": "node_modules/graphql/utilities/assertValidName.mjs",
              "hunks": {
                "items": [
                  {
                    "header": { "original": { "start": 29, "len": 9 }, "patched": { "start": 29, "len": 9 } },
                    "parts": {
                      "items": [
                        {
                          "type": "context",
                          "lines": {
                            "items": [
                              " */",
                              "export function isValidNameError(name, node) {",
                              "  !(typeof name === 'string') ? invariant(0, 'Expected string') : void 0;",
                            ],
                            "capacity": 8,
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "deletion",
                          "lines": {
                            "items": [
                              "  if (name.length > 1 && name[0] === '_' && name[1] === '_') {",
                              "    return new GraphQLError('Name \"' + name + '\" must not begin with \"__\", which is reserved by ' + 'GraphQL introspection.', node);",
                              "  }",
                            ],
                            "capacity": 8,
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": {
                            "items": [
                              "  // if (name.length > 1 && name[0] === '_' && name[1] === '_') {",
                              "  //   return new GraphQLError('Name \"' + name + '\" must not begin with \"__\", which is reserved by ' + 'GraphQL introspection.', node);",
                              "  // }",
                            ],
                            "capacity": 8,
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "context",
                          "lines": {
                            "items": [
                              "  if (!NAME_RX.test(name)) {",
                              "    return new GraphQLError('Names must match /^[_a-zA-Z][_a-zA-Z0-9]*$/ but \"' + name + '\" does not.', node);",
                              "  }",
                            ],
                            "capacity": 8,
                          },
                          "no_newline_at_end_of_file": false,
                        },
                      ],
                      "capacity": 8,
                    },
                  },
                ],
                "capacity": 8,
              },
              "before_hash": null,
              "after_hash": null,
            },
          },
        ],
        "capacity": 8,
      },
    });
  });
});

const patch = `diff --git a/banana.ts b/banana.ts\nindex 2de83dd..842652c 100644\n--- a/banana.ts\n+++ b/banana.ts\n@@ -1,5 +1,5 @@\n this\n is\n \n-a\n+\n file\n`;

const invalidHeaders1 = /* diff */ `diff --git a/banana.ts b/banana.ts
index 2de83dd..842652c 100644
--- a/banana.ts
+++ b/banana.ts
@@ -1,5 +1,4 @@
 this
 is

-a
+
 file
`;

const invalidHeaders2 = /* diff */ `diff --git a/banana.ts b/banana.ts
index 2de83dd..842652c 100644
--- a/banana.ts
+++ b/banana.ts
@@ -1,4 +1,5 @@
 this
 is

-a
+
 file
`;

const invalidHeaders3 = /* diff */ `diff --git a/banana.ts b/banana.ts
index 2de83dd..842652c 100644
--- a/banana.ts
+++ b/banana.ts
@@ -1,0 +1,5 @@
 this
 is

-a
+
 file
`;
const invalidHeaders4 = /* diff */ `diff --git a/banana.ts b/banana.ts
index 2de83dd..842652c 100644
--- a/banana.ts
+++ b/banana.ts
@@ -1,5 +1,0 @@
 this
 is

-a
+
 file
`;

const invalidHeaders5 = /* diff */ `diff --git a/banana.ts b/banana.ts
index 2de83dd..842652c 100644
--- a/banana.ts
+++ b/banana.ts
@@ -1,5 +1,5@@
 this
 is

-a
+
 file
`;

const accidentalBlankLine = /* diff */ `diff --git a/banana.ts b/banana.ts
index 2de83dd..842652c 100644
--- a/banana.ts
+++ b/banana.ts
@@ -1,5 +1,5 @@
 this
 is

-a
+
 file
`;

const crlfLineBreaks = /* diff */ `diff --git a/banana.ts b/banana.ts
new file mode 100644
index 0000000..3e1267f
--- /dev/null
+++ b/banana.ts
@@ -0,0 +1 @@
+this is a new file
`.replace(/\n/g, "\r\n");

const modeChangeAndModifyAndRename = /* diff */ `diff --git a/numbers.txt b/banana.txt
old mode 100644
new mode 100755
similarity index 96%
rename from numbers.txt
rename to banana.txt
index fbf1785..92d2c5f
--- a/numbers.txt
+++ b/banana.txt
@@ -1,4 +1,4 @@
-one
+ne

 two

`;

const oldStylePatch = /* diff */ `patch-package
--- a/node_modules/graphql/utilities/assertValidName.js
+++ b/node_modules/graphql/utilities/assertValidName.js
@@ -41,10 +41,11 @@ function assertValidName(name) {
  */
 function isValidNameError(name, node) {
   !(typeof name === 'string') ? (0, _invariant2.default)(0, 'Expected string') : void 0;
-  if (name.length > 1 && name[0] === '_' && name[1] === '_') {
-    return new _GraphQLError.GraphQLError('Name "' + name + '" must not begin with "__", which is reserved by ' + 'GraphQL introspection.', node);
-  }
+  // if (name.length > 1 && name[0] === '_' && name[1] === '_') {
+  //   return new _GraphQLError.GraphQLError('Name "' + name + '" must not begin with "__", which is reserved by ' + 'GraphQL introspection.', node);
+  // }
   if (!NAME_RX.test(name)) {
     return new _GraphQLError.GraphQLError('Names must match /^[_a-zA-Z][_a-zA-Z0-9]*$/ but "' + name + '" does not.', node);
   }
+
 }
\\ No newline at end of file
--- a/node_modules/graphql/utilities/assertValidName.mjs
+++ b/node_modules/graphql/utilities/assertValidName.mjs
@@ -29,9 +29,9 @@ export function assertValidName(name) {
  */
 export function isValidNameError(name, node) {
   !(typeof name === 'string') ? invariant(0, 'Expected string') : void 0;
-  if (name.length > 1 && name[0] === '_' && name[1] === '_') {
-    return new GraphQLError('Name "' + name + '" must not begin with "__", which is reserved by ' + 'GraphQL introspection.', node);
-  }
+  // if (name.length > 1 && name[0] === '_' && name[1] === '_') {
+  //   return new GraphQLError('Name "' + name + '" must not begin with "__", which is reserved by ' + 'GraphQL introspection.', node);
+  // }
   if (!NAME_RX.test(name)) {
     return new GraphQLError('Names must match /^[_a-zA-Z][_a-zA-Z0-9]*$/ but "' + name + '" does not.', node);
   }
`;
