import { describe, test, expect } from "bun:test";
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
    console.log(parse(crlfLineBreaks));
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
});

const patch = `diff --git a/banana.ts b/banana.ts\nindex 2de83dd..842652c 100644\n--- a/banana.ts\n+++ b/banana.ts\n@@ -1,5 +1,5 @@\n this\n is\n \n-a\n+\n file\n`;

const invalidHeaders1 = `diff --git a/banana.ts b/banana.ts
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

const invalidHeaders2 = `diff --git a/banana.ts b/banana.ts
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

const invalidHeaders3 = `diff --git a/banana.ts b/banana.ts
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
const invalidHeaders4 = `diff --git a/banana.ts b/banana.ts
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

const invalidHeaders5 = `diff --git a/banana.ts b/banana.ts
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

const accidentalBlankLine = `diff --git a/banana.ts b/banana.ts
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

const crlfLineBreaks = `diff --git a/banana.ts b/banana.ts
new file mode 100644
index 0000000..3e1267f
--- /dev/null
+++ b/banana.ts
@@ -0,0 +1 @@
+this is a new file
`.replace(/\n/g, "\r\n");
