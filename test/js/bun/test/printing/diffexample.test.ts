import { expect, mock, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import vm from "node:vm";

function cleanOutput(output: string) {
  return output
    .replaceAll(/ \[[0-9\.]+m?s\]/g, "")
    .replaceAll(/at <anonymous> \(.*\)/g, "at <anonymous> (FILE:LINE)")
    .replaceAll(
      "test\\js\\bun\\test\\printing\\diffexample.fixture.ts:",
      "test/js/bun/test/printing/diffexample.fixture.ts:",
    );
}
function cleanAnsiEscapes(output: string) {
  return output.replaceAll(/\x1B\[[0-9;]*m/g, "");
}

test.concurrent("no color", async () => {
  const noColorSpawn = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/diffexample.fixture.ts"],
    stdio: ["inherit", "ignore", "pipe"],
    env: {
      ...bunEnv,
      FORCE_COLOR: "0",
    },
  });
  const [noColorStderrRaw] = await Promise.all([noColorSpawn.stderr.text(), noColorSpawn.exited]);
  const noColorStderr = cleanOutput(noColorStderrRaw);
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

    @@ -96,11 +96,10 @@
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
    @@ -496,11 +495,11 @@
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
    @@ -747,11 +746,11 @@
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
    @@ -897,11 +896,11 @@
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
    @@ -397,10 +397,11 @@
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

    @@ -1,7 +1,6 @@
      Float64Array [
    -   0,
        1,
        2,
        3,
        4,
        5,
    @@ -9997,6 +9996,7 @@
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
});

function getDiffPart(stderr: string): string {
  stderr = stderr.split("a\\nd\\nc\\nd\\ne")[1];
  const split = stderr.split("\n\n");
  split.pop();
  stderr = split.join("\n\n");
  return stderr;
}

test.concurrent("color", async () => {
  const spawnFixture = (FORCE_COLOR: string) =>
    Bun.spawn({
      cmd: [bunExe(), import.meta.dir + "/diffexample-color.fixture.ts"],
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...bunEnv,
        FORCE_COLOR,
      },
    });
  const spawn = spawnFixture("1");
  const plainSpawn = spawnFixture("0");
  const [stdout, stderr] = await Promise.all([spawn.stdout.text(), spawn.stderr.text(), spawn.exited]);
  const [plainStdout] = await Promise.all([plainSpawn.stdout.text(), plainSpawn.stderr.text(), plainSpawn.exited]);

  // Colour only ever adds escape sequences; the text underneath must be what
  // the uncoloured renderer prints.
  expect(cleanAnsiEscapes(stdout)).toEqual(plainStdout);

  expect(stderr).toMatchInlineSnapshot(`""`);
  expect(stdout).toMatchInlineSnapshot(`
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

    \x1B[33m@@ -1,7 +1,6 @@\x1B[0m
      \x1B[0m\x1B[2mInt32Array [\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m  0,\x1B[0m
      \x1B[0m\x1B[2m  1,\x1B[0m
      \x1B[0m\x1B[2m  2,\x1B[0m
      \x1B[0m\x1B[2m  3,\x1B[0m
      \x1B[0m\x1B[2m  4,\x1B[0m
      \x1B[0m\x1B[2m  5,\x1B[0m
    \x1B[33m@@ -99997,6 +99996,7 @@\x1B[0m
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

    Expected: \x1B[0m\x1B[32m"Hello 👋 世界 \x1B[0m\x1B[32m🌎\x1B[0m\x1B[32m"\x1B[0m
    Received: \x1B[0m\x1B[31m"Hello 👋 世界 \x1B[0m\x1B[31m🌍\x1B[0m\x1B[31m"\x1B[0m

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
    \x1B[32m- \x1B[0m\x1B[32m  "mixed": "Hello 世界 \x1B[0m\x1B[32m🌎\x1B[0m\x1B[32m",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m  "mixed": "Hello 世界 \x1B[0m\x1B[31m🌍\x1B[0m\x1B[31m",\x1B[0m
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

test("large diffs are exact rather than abandoned part-way", () => {
  // Every 7th element differs. It must report exactly the changed elements
  // instead of giving up part-way and dumping both arrays wholesale as one
  // giant -/+ block.
  const length = 50_000;
  const expected = Array.from({ length }, (_, i) => i);
  const received = expected.map((x, i) => (i % 7 === 0 ? x + 1 : x));
  const changed = Math.ceil(length / 7);

  let message = "";
  try {
    expect(received).toEqual(expected);
  } catch (e) {
    message = cleanAnsiEscapes((e as Error).message);
  }
  // (slice so a failure doesn't print the whole ~1 MB message)
  expect(message.slice(0, 120)).toContain("\n  [\n-   0,\n+   1,\n    1,\n");
  expect(message.slice(-400)).toContain("\n-   49994,\n+   49995,\n    49995,\n");
  expect(message.slice(-120).trimEnd()).toEndWith(`\n\n- Expected  - ${changed}\n+ Received  + ${changed}`);
});

test("prints a Response once", () => {
  let message = "";
  try {
    expect<unknown>({ response: new Response("") }).toEqual({ response: 1 });
  } catch (e) {
    message = cleanAnsiEscapes((e as Error).message);
  }
  expect(message).toContain(`
  {
-   "response": 1,
+   "response": Response (0 KB) {
+     ok: true,
+     url: "",
+     status: 200,
+     statusText: "",
+     headers: Headers {},
+     redirected: false,
+     bodyUsed: false
+   },
  }
`);
});

test("prints a React 19 element as JSX, without the fiber in its _owner", () => {
  const element = (type: string, props: object) => ({
    $$typeof: Symbol.for("react.transitional.element"),
    type,
    key: null,
    props,
    _owner: { fiber: "not printed" },
    _store: {},
  });
  let message = "";
  try {
    expect<unknown>({ icon: element("b", { children: ["icon ", element("i", { children: "in" })] }) }).toEqual({
      icon: 1,
    });
  } catch (e) {
    message = cleanAnsiEscapes((e as Error).message);
  }
  expect(message).toContain(`
  {
-   "icon": 1,
+   "icon": <b>
+     icon 
+     <i>in</i>
+   </b>,
  }
`);
});

test("stops printing deeper once a value has printed 1,000,000 characters", () => {
  // Each level has the next one three times, so printed in full it would have 3 ** 40 leaves.
  let value: object = { leaf: true };
  for (let level = 0; level < 40; level++) value = { left: value, right: value, list: [value] };
  let message = "";
  try {
    expect(value).toEqual({});
  } catch (e) {
    message = cleanAnsiEscapes((e as Error).message);
  }
  expect(message).toStartWith("expect(received).toEqual(expected)");
  expect(message).toContain(`"leaf": true`);
  expect(message).toContain(`"list": [Array],\n`);
  expect(message).toContain(`"right": [Object],\n`);
  expect(message.length).toBeWithin(1_000_000, 1_500_000);
});

// A native Event, CustomEvent, MessageEvent, ErrorEvent or CloseEvent. toEqual reads every name that is enumerable on
// the event or on one of its prototypes: for a new event those are accessors of the prototypes. The diff of a failure
// message printed `isTrusted` alone, so it did not show the attribute that differs.
// The lines that the diff prints for a value: the received side of a matcher that fails for every line.
function printedInFailure(value: unknown) {
  let message = "";
  try {
    expect(value).toEqual(Symbol());
  } catch (e) {
    message = cleanAnsiEscapes((e as Error).message);
  }
  const received = message.split("\n").filter(line => line.startsWith("+ "));
  expect(received.pop()).toStartWith("+ Received ");
  return received.map(line => line.slice(2));
}
function messageOfFailure(fails: () => void) {
  try {
    fails();
  } catch (e) {
    return cleanAnsiEscapes((e as Error).message);
  }
  throw new Error("the matcher did not fail");
}
// The lines of the diff that differ, without their indentation.
function differing(fails: () => void) {
  return messageOfFailure(fails)
    .split("\n")
    .filter(line => /^[-+]   /.test(line))
    .map(line => line.replace(/ +/, " "));
}

test("prints what toEqual reads of an event: its own properties and the accessors it inherits", () => {
  expect(printedInFailure(new CustomEvent("a", { detail: { id: 1 } }))).toEqual([
    "CustomEvent ",
    "CustomEvent {",
    '  "bubbles": false,',
    '  "cancelBubble": false,',
    '  "cancelable": false,',
    '  "composed": false,',
    '  "currentTarget": null,',
    '  "defaultPrevented": false,',
    '  "detail": {',
    '    "id": 1,',
    "  },",
    '  "eventPhase": 0,',
    '  "isTrusted": false,',
    '  "returnValue": true,',
    '  "srcElement": null,',
    '  "target": null,',
    '  "timeStamp": 0,',
    '  "type": "a",',
    "}",
  ]);

  const names = (event: Event) =>
    printedInFailure(event)
      .slice(2, -1)
      .map(line => /^  "(\w+)": /.exec(line)?.[1]);
  // prettier-ignore
  const ofEvent = [
    "bubbles", "cancelBubble", "cancelable", "composed", "currentTarget", "defaultPrevented", "eventPhase", "isTrusted",
    "returnValue", "srcElement", "target", "timeStamp", "type",
  ];
  expect(names(new Event("a"))).toEqual(ofEvent);
  expect(names(new CustomEvent("a"))).toEqual([...ofEvent, "detail"].sort());
  expect(names(new MessageEvent("a"))).toEqual([...ofEvent, "data", "lastEventId", "origin", "ports", "source"].sort());
  expect(names(new ErrorEvent("a"))).toEqual([...ofEvent, "colno", "error", "filename", "lineno", "message"].sort());
  expect(names(new CloseEvent("a"))).toEqual([...ofEvent, "code", "reason", "wasClean"].sort());

  // Every event class of the global object. For a new event the names that toEqual reads are those of for-in. The
  // methods and the constants of the prototypes stay out.
  const classes: (typeof Event)[] = Object.getOwnPropertyNames(globalThis)
    .filter(name => /^([A-Z]\w*)?Event$/.test(name))
    .map(name => (globalThis as any)[name]);
  expect(classes.length).toBeGreaterThanOrEqual(5);
  for (const constructor of classes) {
    const event = new constructor("a");
    const read: string[] = [];
    for (const name in event) {
      let holder: object = event;
      while (!Object.hasOwn(holder, name)) holder = Object.getPrototypeOf(holder);
      if (holder === event || Object.getOwnPropertyDescriptor(holder, name)!.get) read.push(name);
    }
    expect(names(event)).toEqual(read.sort());
  }
});

test("the diff of a failing matcher shows the attribute of an event that differs", () => {
  expect(differing(() => expect(new Event("a")).toEqual(new Event("b")))).toEqual(['- "type": "b",', '+ "type": "a",']);
  expect(
    differing(() => expect(new MessageEvent("a", { data: 1 })).toStrictEqual(new MessageEvent("a", { data: 2 }))),
  ).toEqual(['- "data": 2,', '+ "data": 1,']);
  expect(
    differing(() => expect(new MessageEvent("a", { origin: "a" })).toEqual(new MessageEvent("a", { origin: "b" }))),
  ).toEqual(['- "origin": "b",', '+ "origin": "a",']);
  expect(
    differing(() => expect(new ErrorEvent("e", { message: "a" })).toEqual(new ErrorEvent("e", { message: "b" }))),
  ).toEqual(['- "message": "b",', '+ "message": "a",']);
  expect(
    differing(() => expect(new CloseEvent("c", { code: 1000 })).toEqual(new CloseEvent("c", { code: 1001 }))),
  ).toEqual(['- "code": 1001,', '+ "code": 1000,']);

  // Every matcher that prints a diff.
  const one = () => new CustomEvent("a", { detail: 1 });
  const two = () => new CustomEvent("a", { detail: 2 });
  const called = mock();
  called(one());
  expect.extend({
    toFailWithTheDiffOf(received: unknown, expected: unknown) {
      return { pass: false, message: () => this.utils.diff(expected, received)! };
    },
  });
  const diffs: Record<string, () => void> = {
    toEqual: () => expect(one()).toEqual(two()),
    toStrictEqual: () => expect(one()).toStrictEqual(two()),
    toMatchObject: () => expect({ event: one() }).toMatchObject({ event: two() }),
    toHaveProperty: () => expect({ event: one() }).toHaveProperty("event", two()),
    toHaveBeenCalledWith: () => expect(called).toHaveBeenCalledWith(two()),
    toHaveBeenLastCalledWith: () => expect(called).toHaveBeenLastCalledWith(two()),
    toHaveBeenNthCalledWith: () => expect(called).toHaveBeenNthCalledWith(1, two()),
    toHaveBeenCalledExactlyOnceWith: () => expect(called).toHaveBeenCalledExactlyOnceWith(two()),
    "this.utils.diff": () => (expect(one()) as any).toFailWithTheDiffOf(two()),
  };
  for (const [matcher, fails] of Object.entries(diffs)) {
    expect([matcher, differing(fails)]).toEqual([matcher, ['- "detail": 2,', '+ "detail": 1,']]);
  }

  // A value on a prototype that the program made. toEqual reads it as it reads the accessors.
  const withKind = (kind: number) =>
    Object.setPrototypeOf(new Event("a"), Object.assign(Object.create(Event.prototype), { kind }));
  expect(differing(() => expect(withKind(1)).toEqual(withKind(2)))).toEqual(['- "kind": 2,', '+ "kind": 1,']);
  // A symbol on such a prototype. for-in does not give it, and toEqual reads it.
  const kind = Symbol("kind");
  const withSymbol = (value: number) =>
    Object.setPrototypeOf(new Event("a"), Object.assign(Object.create(Event.prototype), { [kind]: value }));
  expect(differing(() => expect(withSymbol(1)).toEqual(withSymbol(2)))).toEqual([
    "- [Symbol(kind)]: 2,",
    "+ [Symbol(kind)]: 1,",
  ]);
  // An own property that is not enumerable, under a name that is enumerable on a prototype. for-in does not give it,
  // and toEqual reads it.
  const withTarget = (value: number) => Object.defineProperty(new Event("a"), "target", { value });
  expect(differing(() => expect(withTarget(1)).toEqual(withTarget(2)))).toEqual(['- "target": 2,', '+ "target": 1,']);
  // A getter that the program put on a native prototype.
  Object.defineProperty(Event.prototype, "twice", {
    get() {
      return this.type + this.type;
    },
    enumerable: true,
    configurable: true,
  });
  try {
    expect(differing(() => expect(new Event("a")).toEqual(new Event("b")))).toEqual([
      '- "twice": "bb",',
      '- "type": "b",',
      '+ "twice": "aa",',
      '+ "type": "a",',
    ]);
  } finally {
    delete (Event.prototype as any).twice;
  }
});

test("prints an event by its class, with its own properties, also for the types message and error", () => {
  class Tagged extends Event {
    constructor(
      type: string,
      public tag: string,
    ) {
      super(type);
    }
  }
  const tagged = printedInFailure(Object.assign(new Tagged("message", "x"), { own: 1 }));
  expect(tagged.slice(0, 2)).toEqual(["Event ", "Tagged {"]);
  expect(tagged.filter(line => /"(own|tag|type)"/.test(line))).toEqual([
    '  "own": 1,',
    '  "tag": "x",',
    '  "type": "message",',
  ]);
  // A CloseEvent with the type "error" printed as `ErrorEvent {\n  type: "error",\n}`.
  const close = printedInFailure({ event: new CloseEvent("error", { code: 1000 }) });
  expect(close.slice(0, 2)).toEqual(["{", '  "event": CloseEvent CloseEvent {']);
  expect(close).toContain('    "code": 1000,');
  expect(printedInFailure(expect.objectContaining(new CloseEvent("close", { code: 1000 })))).toContain(
    '  "code": 1000,',
  );

  // `data`, `message` and `error` printed for these two types also where they are getters of a class, which are not
  // enumerable. toMatchObject reads them.
  class Message extends Event {
    #data: number;
    constructor(data: number) {
      super("message");
      this.#data = data;
    }
    get data() {
      return this.#data;
    }
  }
  class Failure extends Event {
    constructor() {
      super("error");
    }
    get message() {
      return "m";
    }
    get error() {
      return 1;
    }
  }
  expect(differing(() => expect(new Message(1)).toMatchObject({ data: 2 }))).toContain('+ "data": 1,');
  expect(printedInFailure(new Failure()).filter(line => /^  "(error|message)"/.test(line))).toEqual([
    '  "error": 1,',
    '  "message": "m",',
  ]);
  // For another type the getter is not called: toEqual does not read it, and a snapshot does not show it.
  let calls = 0;
  class Tick extends Event {
    get message() {
      calls++;
      return "m";
    }
  }
  expect(printedInFailure(new Tick("tick")).filter(line => /^  "(message|type)"/.test(line))).toEqual([
    '  "type": "tick",',
  ]);
  expect(calls).toBe(0);
});

test("prints an event that holds itself once, and a getter of an event that throws as [native code]", () => {
  const holder: { event?: Event } = {};
  const event = new CustomEvent("a", { detail: holder });
  holder.event = event;
  expect(printedInFailure(event).filter(line => /detail|Circular|^  \}/.test(line))).toEqual([
    '  "detail": {',
    '    "event": [Circular],',
    "  },",
  ]);

  class Throws extends Event {
    get type(): string {
      throw new Error("from the getter of type");
    }
    get target(): EventTarget {
      throw new Error("from the getter of target");
    }
  }
  expect(printedInFailure(new Throws("a")).filter(line => /"(target|type)"/.test(line))).toEqual([
    '  "target": [native code],',
    '  "type": [native code],',
  ]);

  class TargetsItself extends Event {
    get target() {
      return this;
    }
  }
  expect(printedInFailure(new TargetsItself("a")).filter(line => /"(target|type)"/.test(line))).toEqual([
    '  "target": [Circular],',
    '  "type": "a",',
  ]);
});

test("prints the object that dispatched an event one level deep", () => {
  // An event that was dispatched is not equal to a new one: it has a target.
  const target = new EventTarget();
  const listener = mock();
  target.addEventListener("a", listener);
  target.dispatchEvent(new CustomEvent("a", { detail: 1 }));
  expect(differing(() => expect(listener.mock.calls[0][0]).toEqual(new CustomEvent("a", { detail: 1 })))).toEqual([
    '- "srcElement": null,',
    '- "target": null,',
    '+ "srcElement": EventTarget {},',
    '+ "target": EventTarget {},',
  ]);

  class Socket extends EventTarget {
    received = new Uint8Array(4096);
    constructor(public id: number) {
      super();
    }
  }
  const dispatch = (socket: Socket, data: unknown) => {
    let event: Event | undefined;
    let inTheListener: string[] = [];
    socket.addEventListener("message", received => {
      event = received;
      inTheListener = printedInFailure(received);
    });
    socket.dispatchEvent(new MessageEvent("message", { data }));
    return { event, inTheListener };
  };
  const socket = new Socket(1);
  // `currentTarget`, `srcElement` and `target` are the same object. In full it has 4,101 lines.
  const { inTheListener } = dispatch(socket, { socket });
  expect(inTheListener.filter(line => /Socket|"id"|"received"|^ +\},/.test(line))).toEqual([
    '  "currentTarget": EventTarget Socket {',
    '    "id": 1,',
    '    "received": [Uint8Array],',
    "  },",
    '    "socket": EventTarget Socket {',
    '      "id": 1,',
    '      "received": [Uint8Array],',
    "    },",
    "  },",
    '  "srcElement": EventTarget Socket {',
    '    "id": 1,',
    '    "received": [Uint8Array],',
    "  },",
    '  "target": EventTarget Socket {',
    '    "id": 1,',
    '    "received": [Uint8Array],',
    "  },",
  ]);
  // toEqual compares the two objects that dispatched the events.
  expect(differing(() => expect(dispatch(socket, 1).event).toEqual(dispatch(new Socket(2), 1).event))).toEqual([
    '- "id": 2,',
    '+ "id": 1,',
    '- "id": 2,',
    '+ "id": 1,',
  ]);
  // Where no event holds it, it prints in full.
  expect(printedInFailure({ socket })).toHaveLength(4103);

  // A function and an error take one line, so they print as they do elsewhere.
  class Hub extends EventTarget {
    failure = new Error("e");
    handler = () => {};
    self = this;
  }
  const hub = new Hub();
  hub.addEventListener("a", listener);
  hub.dispatchEvent(new Event("a"));
  expect(printedInFailure(listener.mock.calls[1][0]).slice(-8, -3)).toEqual([
    '  "target": EventTarget Hub {',
    '    "failure": [Error: e],',
    '    "handler": [Function],',
    '    "self": [Hub],',
    "  },",
  ]);
});

test("does not print the accessors of a value that is not a native event", () => {
  let calls = 0;
  class Inherits {
    get type() {
      calls++;
      return "t";
    }
    get data() {
      calls++;
      return 1;
    }
  }
  using listener = Bun.listen({ hostname: "127.0.0.1", port: 0, data: { a: 1 }, socket: { data() {} } });
  expect(
    printedInFailure([
      AbortSignal.abort("why"), // reason
      performance.mark("m", { detail: 1 }), // detail
      new Inherits(),
      Object.create(Event.prototype), // the accessors of an event without its cell
      listener, // data, on a native object that prints through the same arm as an event
    ]),
  ).toEqual([
    "[",
    "  AbortSignal {},",
    "  PerformanceMark {},",
    "  Inherits {},",
    "  Event {},",
    "  Listener {},",
    "]",
  ]);
  expect(calls).toBe(0);
});

test("prints an event that inherits through a Proxy with every enumerable name, or its own where a trap throws", () => {
  const event: MessageEvent = Object.setPrototypeOf(
    new MessageEvent("message", { data: 1 }),
    new Proxy(MessageEvent.prototype, {}),
  );
  const printed = printedInFailure(event);
  // The Proxy hides which names are methods and constants, so those print too.
  const names: string[] = [];
  for (const name in event) names.push(name);
  expect(printed.slice(2, -1).map(line => /^  "(\w+)": /.exec(line)?.[1])).toEqual(names.sort());
  expect(printed).toContain('  "data": 1,');
  expect(printed).toContain('  "type": "message",');
  expect(printed).toContain('  "NONE": 0,');

  const throws = Object.setPrototypeOf(
    new Event("a"),
    new Proxy(Event.prototype, {
      ownKeys() {
        throw new Error("from ownKeys");
      },
    }),
  );
  const message = messageOfFailure(() => expect(throws).toStrictEqual({ a: 1 }));
  expect(message).toStartWith("expect(received).toStrictEqual(expected)");
  expect(message).toContain('\n+ Event {\n+   "isTrusted": false,\n  }\n');
});

test("prints the global object as [Global Object] in the diff of a failure message", () => {
  let event: Event | undefined;
  const listener = (received: Event) => {
    event = received;
  };
  // The global object holds `process.env`.
  process.env.IN_THE_GLOBAL_OBJECT = "value of a variable of the environment";
  globalThis.addEventListener("on-the-global-object", listener);
  try {
    globalThis.dispatchEvent(new CustomEvent("on-the-global-object", { detail: { global: globalThis } }));
    const printed = printedInFailure(event);
    expect(printed.filter(line => line.includes("Global Object"))).toEqual([
      '    "global": [Global Object],',
      '  "srcElement": [Global Object],',
      '  "target": [Global Object],',
    ]);
    expect(printed).toHaveLength(19);
    expect(printed.join("\n")).not.toContain("value of a variable of the environment");
    // Also where another value holds it. By itself it prints in full.
    expect(printedInFailure({ global: globalThis })).toEqual(["{", '  "global": [Global Object],', "}"]);
    expect(printedInFailure([new Map([[1, globalThis]])])).toContain("    1 => [Global Object],");
    expect(printedInFailure(globalThis).length).toBeGreaterThan(100);
    // The global object of a `node:vm` context prints in full: toEqual compares it by its properties.
    const inContext = (x: number) => new MessageEvent("message", { data: vm.runInNewContext("globalThis", { x }) });
    expect(differing(() => expect(inContext(1)).toEqual(inContext(2)))).toEqual(['- "x": 2,', '+ "x": 1,']);
  } finally {
    globalThis.removeEventListener("on-the-global-object", listener);
    delete process.env.IN_THE_GLOBAL_OBJECT;
  }
});

test("a value that cannot be printed fails the diff of an event as it fails the diff of an object", () => {
  // JSON.stringify throws for this Proxy.
  const unprintable = () => new Proxy({ big: 1n }, {});
  const firstLine = (fails: () => void) => messageOfFailure(fails).split("\n")[0];
  expect(
    firstLine(() =>
      expect(new CustomEvent("a", { detail: unprintable() })).toEqual(new CustomEvent("a", { detail: 2 })),
    ),
  ).toBe(firstLine(() => expect({ detail: unprintable() }).toEqual({ detail: 2 })));
});

test("keeps the text of an event in a snapshot", () => {
  expect([
    new Event("foo"),
    new MessageEvent("message", { data: { a: 1 } }),
    new ErrorEvent("error", { message: "m", error: new Error("e") }),
  ]).toMatchInlineSnapshot(`
    [
      Event Event {
        "isTrusted": false,
      },
      MessageEvent {
        type: "message",
        data: {
          "a": 1,
        }, 
      },
      ErrorEvent {
        type: "error",
        message: "m", 
        error: [Error: e]
      },
    ]
  `);
});
