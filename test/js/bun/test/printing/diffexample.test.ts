import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function cleanOutput(output: string) {
  return output
    .replaceAll(/ \[[0-9\.]+ms\]/g, "")
    .replaceAll(/at <anonymous> \(.*\)/g, "at <anonymous> (FILE:LINE)")
    .replaceAll(
      "test\\js\\bun\\test\\printing\\diffexample.fixture.ts:",
      "test/js/bun/test/printing/diffexample.fixture.ts:",
    );
}
function cleanAnsiEscapes(output: string) {
  return output.replaceAll(/\x1B\[[0-9;]*m/g, "");
}

test("no color", async () => {
  const noColorSpawn = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/diffexample.fixture.ts"],
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...bunEnv,
      FORCE_COLOR: "0",
    },
  });
  await noColorSpawn.exited;
  const noColorStderr = cleanOutput(await noColorSpawn.stderr.text());
  const noColorStdout = await noColorSpawn.stdout.text();
  expect(noColorStderr).toMatchInlineSnapshot(`
    "
    test/js/bun/test/printing/diffexample.fixture.ts:
    10 |     .replaceAll("\\\\", "/")
    11 |     .replaceAll(process.cwd(), "<cwd>");
    12 | }
    13 | 
    14 | test("example 1", () => {
    15 |   expect("a\\nb\\nc\\n d\\ne").toEqual("a\\nd\\nc\\nd\\ne");
                                    ^
    error: expect(received).toEqual(expected)

      "a
    - d
    + b
      c
    - d
    +  d
      e"

    - Expected  - 2
    + Received  + 2

          at <anonymous> (FILE:LINE)
    (fail) example 1
    17 | test("example 2", () => {
    18 |   expect({
    19 |     object1: "a",
    20 |     object2: "b",
    21 |     object3: "c\\nd\\ne",
    22 |   }).toEqual({
              ^
    error: expect(received).toEqual(expected)

      {
        "object1": "a",
    -   "object2": " b",
    +   "object2": "b",
        "object3": 
      "c
    - d"
    + d
    + e"
      ,
      }

    - Expected  - 2
    + Received  + 3

          at <anonymous> (FILE:LINE)
    (fail) example 2
    37 |   expectedLines[750] = "line 751 - MODIFIED"; // Change line 751
    38 |   expectedLines[900] = "line 901 - DIFFERENT"; // Change line 901
    39 |   expectedLines.splice(100, 0, "line 101 - INSERTED");
    40 |   const expectedString = expectedLines.join("\\n");
    41 | 
    42 |   expect(originalString).toEqual(expectedString);
                                  ^
    error: expect(received).toEqual(expected)

    @@ -96,11 +96,11 @@
      line 96
      line 97
      line 98
      line 99
      line 100
    - line 101 - INSERTED
      line 101
      line 102
      line 103
      line 104
      line 105
    @@ -496,11 +496,11 @@
      line 495
      line 496
      line 497
      line 498
      line 499
    - line 500 - CHANGED
    + line 500
      line 501
      line 502
      line 503
      line 504
      line 505
    @@ -747,11 +747,11 @@
      line 746
      line 747
      line 748
      line 749
      line 750
    - line 751 - MODIFIED
    + line 751
      line 752
      line 753
      line 754
      line 755
      line 756
    @@ -897,11 +897,11 @@
      line 896
      line 897
      line 898
      line 899
      line 900
    - line 901 - DIFFERENT
    + line 901
      line 902
      line 903
      line 904
      line 905
      line 906

    - Expected  - 4
    + Received  + 3

          at <anonymous> (FILE:LINE)
    (fail) example 3 - very long string with few changes
    (todo) example 4 - ansi colors don't get printed to console
    122 | line 35
    123 | line 36
    124 | line 37
    125 | line 38
    126 | line 39\`;
    127 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

      "line one
      line two
    - line three
    + line three!
      line four
      line five
    - line six
    + !-!six
      line seven
      line eight
    - line nine (inserted only)
      line ten
      line 11
      line 12
      line 13
      line 14
      line 15
      line 16
      line 17
      line 18
      line 19
      line 20
      line 21
      line 22
      line 23
      line 24
      line 25
      line 26
      line 27
    - line 28
    + line 28!
      line 29
      line 30
      line 31
      line 32
      line 33
      line 34
      line 35
      line 36
      line 37
      line 38
      line 39"

    - Expected  - 4
    + Received  + 3

          at <anonymous> (FILE:LINE)
    (fail) example 12 - large multiline diff
    205 | line six
    206 | line seven
    207 | 
    208 | === has newline at end vs doesn't ===
    209 | \`;
    210 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

      "=== diffdiff ===
      line one
    - line two
    - line three
    - line four
    - line five
    + line two!
      line six
      line seven
      
      === each line changed ===
    - line one
    - line two!
    - line three
    - line four!
    + line one?
    + line two
    + line three?
    + line four?
      
      === deleted ===
      line one
      line two
    + line three
    + line four
    + line five
      line six
      line seven
      
      === inserted ===
      line one
      line two
    - line three
    - line four
    - line five
      line six
      line seven
      
      === inserted newline ===
      line one
      line two
    - 
      line three
      line four
      line five
      line six
      line seven
      
    - === has newline at end vs doesn't ===
    - "
    + === has newline at end vs doesn't ==="

    - Expected  - 14
    + Received  + 9

          at <anonymous> (FILE:LINE)
    (fail) example 13 - simple multiline diff with sections
    211 | });
    212 | 
    213 | test("example 14 - single line diff", () => {
    214 |   const received = \`"¡hello, world"\`;
    215 |   const expected = \`"hello, world!"\`;
    216 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

    Expected: ""hello, world!""
    Received: ""¡hello, world""

          at <anonymous> (FILE:LINE)
    (fail) example 14 - single line diff
    217 | });
    218 | 
    219 | test("example 15 - unicode char diff", () => {
    220 |   const received = \`Hello 👋 世界 🌎!\`;
    221 |   const expected = \`Hello 👋 世界 🌍!\`;
    222 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

    Expected: "Hello 👋 世界 🌍!"
    Received: "Hello 👋 世界 🌎!"

          at <anonymous> (FILE:LINE)
    (fail) example 15 - unicode char diff
    231 | }\`;
    232 |   const expected = \`function main() {
    233 |     print("Hello, world!");
    234 |     print("Goodbye, world!");
    235 | }\`;
    236 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

      "function main() {
    -     print("Hello, world!");
    -     print("Goodbye, world!");
    +     if (true) {
    +         print("Hello, world!");
    +         print("Goodbye, world!");
    +     }
      }"

    - Expected  - 2
    + Received  + 4

          at <anonymous> (FILE:LINE)
    (fail) example 16 - indentation change diff
    267 |   }
    268 | 
    269 |   // The Zig code adds a trailing newline to each string.
    270 |   const receivedString = receivedLines.join("\\n") + "\\n";
    271 |   const expectedString = expectedLines.join("\\n") + "\\n";
    272 |   expect(receivedString).toEqual(expectedString);
                                   ^
    error: expect(received).toEqual(expected)

    @@ -96,11 +96,11 @@
      line 95
      line 96
      line 97
      line 98
      line 99
    - line 100
    + line 100 - inserted
      line 101
      line 102
      line 103
      line 104
      line 105
    @@ -196,11 +196,11 @@
      line 195
      line 196
      line 197
      line 198
      line 199
    - line 200 - deleted
    + line 200
      line 201
      line 202
      line 203
      line 204
      line 205
    @@ -296,11 +296,11 @@
      line 295
      line 296
      line 297
      line 298
      line 299
    - modified - line 300
    + line 300 - modified
      line 301
      line 302
      line 303
      line 304
      line 305
    @@ -397,11 +397,11 @@
      line 396
      line 397
      line 398
      line 399
      line 400
    + extra line!
      line 401
      line 402
      line 403
      line 404
      line 405

    - Expected  - 3
    + Received  + 4

          at <anonymous> (FILE:LINE)
    (fail) example 17 - very long string
    273 | });
    274 | 
    275 | test("example 18 - very long single line string", () => {
    276 |   const expected = "a".repeat(1000000);
    277 |   const received = "a".repeat(1000001);
    278 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

    Expected: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa... (999801 bytes truncated) ...aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    Received: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa... (999801 bytes truncated) ...aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

          at <anonymous> (FILE:LINE)
    (fail) example 18 - very long single line string
    277 |   const received = "a".repeat(1000001);
    278 |   expect(received).toEqual(expected);
    279 | });
    280 | 
    281 | test("not", () => {
    282 |   expect("Hello, World!").not.toEqual("Hello, World!");
                                        ^
    error: expect(received).not.toEqual(expected)

    Expected: not "Hello, World!"

          at <anonymous> (FILE:LINE)
    (fail) not
    281 | test("not", () => {
    282 |   expect("Hello, World!").not.toEqual("Hello, World!");
    283 | });
    284 | 
    285 | test("has end newline vs doesn't", () => {
    286 |   expect("Hello, World!\\n").toEqual("Hello, World!");
                                      ^
    error: expect(received).toEqual(expected)

    - "Hello, World!"
    + "Hello, World!
    + "

    - Expected  - 1
    + Received  + 2

          at <anonymous> (FILE:LINE)
    (fail) has end newline vs doesn't
    292 |   const received = new Float64Array(length);
    293 |   for (let i = 0; i < length; i++) {
    294 |     expected[i] = i;
    295 |     received[i] = i + 1;
    296 |   }
    297 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

    @@ -1,7 +1,7 @@
      Float64Array [
    -   0,
        1,
        2,
        3,
        4,
        5,
    @@ -9997,7 +9997,7 @@
        9995,
        9996,
        9997,
        9998,
        9999,
    +   10000,
      ]

    - Expected  - 1
    + Received  + 1

          at <anonymous> (FILE:LINE)
    (fail) extremely float64array
    303 |   const received = new Int32Array(length);
    304 |   for (let i = 0; i < length; i++) {
    305 |     expected[i] = i;
    306 |     received[i] = length - i - 1;
    307 |   }
    308 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

      Int32Array [
    -   0,
    -   1,
    -   2,
    -   3,
    -   4,
    -   5,
    -   6,
    -   7,
    -   8,
    -   9,
    -   10,
    -   11,
    -   12,
    -   13,
    -   14,
    -   15,
    -   16,
    -   17,
    -   18,
    -   19,
    -   20,
    -   21,
    -   22,
    -   23,
    -   24,
    -   25,
    -   26,
    -   27,
    -   28,
    -   29,
    -   30,
    -   31,
    -   32,
    -   33,
    -   34,
    -   35,
    -   36,
    -   37,
    -   38,
    -   39,
    -   40,
    -   41,
    -   42,
    -   43,
    -   44,
    -   45,
    -   46,
    -   47,
    -   48,
    -   49,
    -   50,
    -   51,
    -   52,
    -   53,
    -   54,
    -   55,
    -   56,
    -   57,
    -   58,
    -   59,
    -   60,
    -   61,
    -   62,
    -   63,
    -   64,
    -   65,
    -   66,
    -   67,
    -   68,
    -   69,
    -   70,
    -   71,
    -   72,
    -   73,
    -   74,
    -   75,
    -   76,
    -   77,
    -   78,
    -   79,
    -   80,
    -   81,
    -   82,
    -   83,
    -   84,
    -   85,
    -   86,
    -   87,
    -   88,
    -   89,
    -   90,
    -   91,
    -   92,
    -   93,
    -   94,
    -   95,
    -   96,
    -   97,
    -   98,
        99,
    +   98,
    +   97,
    +   96,
    +   95,
    +   94,
    +   93,
    +   92,
    +   91,
    +   90,
    +   89,
    +   88,
    +   87,
    +   86,
    +   85,
    +   84,
    +   83,
    +   82,
    +   81,
    +   80,
    +   79,
    +   78,
    +   77,
    +   76,
    +   75,
    +   74,
    +   73,
    +   72,
    +   71,
    +   70,
    +   69,
    +   68,
    +   67,
    +   66,
    +   65,
    +   64,
    +   63,
    +   62,
    +   61,
    +   60,
    +   59,
    +   58,
    +   57,
    +   56,
    +   55,
    +   54,
    +   53,
    +   52,
    +   51,
    +   50,
    +   49,
    +   48,
    +   47,
    +   46,
    +   45,
    +   44,
    +   43,
    +   42,
    +   41,
    +   40,
    +   39,
    +   38,
    +   37,
    +   36,
    +   35,
    +   34,
    +   33,
    +   32,
    +   31,
    +   30,
    +   29,
    +   28,
    +   27,
    +   26,
    +   25,
    +   24,
    +   23,
    +   22,
    +   21,
    +   20,
    +   19,
    +   18,
    +   17,
    +   16,
    +   15,
    +   14,
    +   13,
    +   12,
    +   11,
    +   10,
    +   9,
    +   8,
    +   7,
    +   6,
    +   5,
    +   4,
    +   3,
    +   2,
    +   1,
    +   0,
      ]

    - Expected  - 99
    + Received  + 99

          at <anonymous> (FILE:LINE)
    (fail) completely different long value does not truncate
    307 |   }
    308 |   expect(received).toEqual(expected);
    309 | });
    310 | 
    311 | test("whitespace-only difference", () => {
    312 |   expect("hello\\nworld ").toEqual("hello\\nworld");
                                    ^
    error: expect(received).toEqual(expected)

      "hello
    - world"
    + world "

    - Expected  - 1
    + Received  + 1

          at <anonymous> (FILE:LINE)
    (fail) whitespace-only difference
    (skip) whitespace-only difference (ANSI)
    331 |     \`);
    332 |   }
    333 | });
    334 | 
    335 | test("mix of whitespace-only and non-whitespace-only differences", () => {
    336 |   expect("hello\\nworld ").toEqual("Hello\\nworld ");
                                    ^
    error: expect(received).toEqual(expected)

    - "Hello
    + "hello
      world "

    - Expected  - 1
    + Received  + 1

          at <anonymous> (FILE:LINE)
    (fail) mix of whitespace-only and non-whitespace-only differences
    (skip) mix of whitespace-only and non-whitespace-only differences (ANSI)

     0 pass
     2 skip
     1 todo
     16 fail
     16 expect() calls
    Ran 19 tests across 1 file.
    "
  `);
  expect(noColorSpawn.exitCode).toBe(1);

  const colorSpawn = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/diffexample.fixture.ts"],
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...bunEnv,
      FORCE_COLOR: "0",
    },
  });
  await colorSpawn.exited;
  const colorStderr = cleanOutput(cleanAnsiEscapes(await colorSpawn.stderr.text()));
  const colorStdout = cleanAnsiEscapes(await colorSpawn.stdout.text());
  expect(colorStderr).toEqual(noColorStderr);
  expect(colorStdout).toEqual(noColorStdout);
});

function getDiffPart(stderr: string): string {
  stderr = stderr.split("a\\nd\\nc\\nd\\ne")[1];
  const split = stderr.split("\n\n");
  split.pop();
  stderr = split.join("\n\n");
  return stderr;
}

test("color", async () => {
  const spawn = Bun.spawn({
    cmd: [bunExe(), import.meta.dir + "/diffexample-color.fixture.ts"],
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...bunEnv,
      FORCE_COLOR: "1",
    },
  });
  await spawn.exited;
  const stderr = await spawn.stderr.text();

  expect(stderr).toMatchInlineSnapshot(`""`);
  expect(await spawn.stdout.text()).toMatchInlineSnapshot(`
    "\x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

      \x1B[0m\x1B[2m"a\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32md\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31mb\x1B[0m
      \x1B[0m\x1B[2mc\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32md\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m\x1B[7m \x1B[0m\x1B[31md\x1B[0m
      \x1B[0m\x1B[2me"\x1B[0m

    \x1B[32m- Expected  - 2\x1B[0m
    \x1B[31m+ Received  + 2\x1B[0m

    \x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

      \x1B[0m\x1B[2m{\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m  "age": \x1B[0m\x1B[32m30\x1B[0m\x1B[32m,\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m  "age": \x1B[0m\x1B[31m25\x1B[0m\x1B[31m,\x1B[0m
      \x1B[0m\x1B[2m  "logs": [\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m    "Logged into system",\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m    "Accessed dashboard",\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m    "Reviewed daily reports",\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m    "Updated project status",\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m    "Sent status email to team",\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m    "Scheduled follow-up meeting",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m    "Entered the building",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m    "Checked in at reception",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m    "Took elevator to floor 3",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m    "Attended morning meeting",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m    "Started working on project",\x1B[0m
      \x1B[0m\x1B[2m  ],\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m  "name": "\x1B[0m\x1B[32mBob\x1B[0m\x1B[32m",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m  "name": "\x1B[0m\x1B[31mAlice\x1B[0m\x1B[31m",\x1B[0m
      \x1B[0m\x1B[2m}\x1B[0m

    \x1B[32m- Expected  - 8\x1B[0m
    \x1B[31m+ Received  + 7\x1B[0m

    \x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

    \x1B[33m@@ -1,7 +1,7 @@\x1B[0m
      \x1B[0m\x1B[2mInt32Array [\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m  0,\x1B[0m
      \x1B[0m\x1B[2m  1,\x1B[0m
      \x1B[0m\x1B[2m  2,\x1B[0m
      \x1B[0m\x1B[2m  3,\x1B[0m
      \x1B[0m\x1B[2m  4,\x1B[0m
      \x1B[0m\x1B[2m  5,\x1B[0m
    \x1B[33m@@ -99997,7 +99997,7 @@\x1B[0m
      \x1B[0m\x1B[2m  99995,\x1B[0m
      \x1B[0m\x1B[2m  99996,\x1B[0m
      \x1B[0m\x1B[2m  99997,\x1B[0m
      \x1B[0m\x1B[2m  99998,\x1B[0m
      \x1B[0m\x1B[2m  99999,\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m  100000,\x1B[0m
      \x1B[0m\x1B[2m]\x1B[0m

    \x1B[32m- Expected  - 1\x1B[0m
    \x1B[31m+ Received  + 1\x1B[0m

    \x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

    Expected: \x1B[0m\x1B[32m"Hello 👋 世界 🌎"\x1B[0m
    Received: \x1B[0m\x1B[31m"Hello 👋 世界 🌍"\x1B[0m

    \x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

      \x1B[0m\x1B[2m"Line 1: 你好\x1B[0m
      \x1B[0m\x1B[2mLine 2: مرحبا\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32mLine 3: Привет"\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31mLine 3: Здравствуйте"\x1B[0m

    \x1B[32m- Expected  - 1\x1B[0m
    \x1B[31m+ Received  + 1\x1B[0m

    \x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

      \x1B[0m\x1B[2m{\x1B[0m
      \x1B[0m\x1B[2m  "arabic": "اختبار",\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m  "chinese": "测试\x1B[0m\x1B[32m文本\x1B[0m\x1B[32m",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m  "chinese": "测试\x1B[0m\x1B[31m字符串\x1B[0m\x1B[31m",\x1B[0m
      \x1B[0m\x1B[2m  "emoji": "🔥💧🌊",\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m  "mixed": "Hello 世界 🌎",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m  "mixed": "Hello 世界 🌍",\x1B[0m
      \x1B[0m\x1B[2m}\x1B[0m

    \x1B[32m- Expected  - 2\x1B[0m
    \x1B[31m+ Received  + 2\x1B[0m

    \x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

    Expected: \x1B[0m\x1B[32m"café r\x1B[0m\x1B[32me\x1B[0m\x1B[32msumé na\x1B[0m\x1B[32mi\x1B[0m\x1B[32mve"\x1B[0m
    Received: \x1B[0m\x1B[31m"café r\x1B[0m\x1B[31mé\x1B[0m\x1B[31msumé na\x1B[0m\x1B[31mï\x1B[0m\x1B[31mve"\x1B[0m

    \x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

      \x1B[0m\x1B[2m"Línea 1: ñoño\x1B[0m
      \x1B[0m\x1B[2mLínea 2: àèìòù\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32mLínea 3: \x1B[0m\x1B[32maeiou\x1B[0m\x1B[32m"\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31mLínea 3: \x1B[0m\x1B[31mäëïöü\x1B[0m\x1B[31m"\x1B[0m

    \x1B[32m- Expected  - 1\x1B[0m
    \x1B[31m+ Received  + 1\x1B[0m

    \x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

      \x1B[0m\x1B[2m{\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m  "french": "crème br\x1B[0m\x1B[32mu\x1B[0m\x1B[32mlée",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m  "french": "crème br\x1B[0m\x1B[31mû\x1B[0m\x1B[31mlée",\x1B[0m
      \x1B[0m\x1B[2m  "spanish": "niño español",\x1B[0m
      \x1B[0m\x1B[2m  "special": "½ ¼ ¾ ± × ÷",\x1B[0m
      \x1B[0m\x1B[2m}\x1B[0m

    \x1B[32m- Expected  - 1\x1B[0m
    \x1B[31m+ Received  + 1\x1B[0m

    "
  `);
  expect(spawn.exitCode).toBe(0);
});

/*
issue:
in inline snapshot diffing, it is printing the color codes
*/
