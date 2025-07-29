import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function cleanOutput(output: string) {
  return output.replaceAll(/ \[[0-9\.]+ms\]/g, "").replaceAll(/at <anonymous> \(.*\)/g, "at <anonymous> (FILE:LINE)");
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
    1 | import { test, expect } from "bun:test";
    2 | 
    3 | test("example 1", () => {
    4 |   expect("a\\nb\\nc\\n d\\ne").toEqual("a\\nd\\nc\\nd\\ne");
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
     6 | test("example 2", () => {
     7 |   expect({
     8 |     object1: "a",
     9 |     object2: "b",
    10 |     object3: "c\\nd\\ne",
    11 |   }).toEqual({
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
    26 |   expectedLines[750] = "line 751 - MODIFIED"; // Change line 751
    27 |   expectedLines[900] = "line 901 - DIFFERENT"; // Change line 901
    28 |   expectedLines.splice(100, 0, "line 101 - INSERTED");
    29 |   const expectedString = expectedLines.join("\\n");
    30 | 
    31 |   expect(originalString).toEqual(expectedString);
                                  ^
    error: expect(received).toEqual(expected)

    @@ -97,11 +97,11 @@
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
    @@ -497,11 +497,11 @@
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
    @@ -748,11 +748,11 @@
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
    @@ -898,11 +898,11 @@
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
    34 | test.todo("example 4 - ansi colors don't get printed to console", () => {
    35 |   expect("\\x1b[31mhello\\x1b[0m").toEqual("\\x1b[32mhello\\x1b[0m");
    36 | });
    37 | 
    38 | test("example 5 - Unicode characters", () => {
    39 |   expect("Hello 👋 世界 🌍").toEqual("Hello 👋 世界 🌎");
                                   ^
    error: expect(received).toEqual(expected)

    Expected: "Hello 👋 世界 🌎"
    Received: "Hello 👋 世界 🌍"


          at <anonymous> (FILE:LINE)
    (fail) example 5 - Unicode characters
    38 | test("example 5 - Unicode characters", () => {
    39 |   expect("Hello 👋 世界 🌍").toEqual("Hello 👋 世界 🌎");
    40 | });
    41 | 
    42 | test("example 6 - Unicode with line breaks", () => {
    43 |   expect("Line 1: 你好\\nLine 2: مرحبا\\nLine 3: Здравствуйте").toEqual("Line 1: 你好\\nLine 2: مرحبا\\nLine 3: Привет");
                                                                    ^
    error: expect(received).toEqual(expected)

      
      "Line 1: 你好
      Line 2: مرحبا
    - Line 3: Привет"
    - 
    + Line 3: Здравствуйте"
    + 

    - Expected  - 2
    + Received  + 2


          at <anonymous> (FILE:LINE)
    (fail) example 6 - Unicode with line breaks
    47 |   expect({
    48 |     emoji: "🔥💧🌊",
    49 |     chinese: "测试字符串",
    50 |     arabic: "اختبار",
    51 |     mixed: "Hello 世界 🌍",
    52 |   }).toEqual({
              ^
    error: expect(received).toEqual(expected)

      
      {
        "arabic": "اختبار",
    -   "chinese": "测试文本",
    +   "chinese": "测试字符串",
        "emoji": "🔥💧🌊",
    -   "mixed": "Hello 世界 🌎",
    +   "mixed": "Hello 世界 🌍",
      }
      

    - Expected  - 2
    + Received  + 2


          at <anonymous> (FILE:LINE)
    (fail) example 7 - Mixed Unicode in objects
    56 |     mixed: "Hello 世界 🌎",
    57 |   });
    58 | });
    59 | 
    60 | test("example 8 - Latin-1 characters", () => {
    61 |   expect("café résumé naïve").toEqual("café resumé naive");
                                      ^
    error: expect(received).toEqual(expected)

    Expected: "café resumé naive"
    Received: "café résumé naïve"


          at <anonymous> (FILE:LINE)
    (fail) example 8 - Latin-1 characters
    (pass) example 9 - Latin-1 extended characters
    64 | test("example 9 - Latin-1 extended characters", () => {
    65 |   expect("© ® ™ £ € ¥ § ¶").toEqual("© ® ™ £ € ¥ § ¶");
    66 | });
    67 | 
    68 | test("example 10 - Latin-1 with line breaks", () => {
    69 |   expect("Línea 1: ñoño\\nLínea 2: àèìòù\\nLínea 3: äëïöü").toEqual("Línea 1: ñoño\\nLínea 2: àèìòù\\nLínea 3: aeiou");
                                                                  ^
    error: expect(received).toEqual(expected)

      
      "Línea 1: ñoño
      Línea 2: àèìòù
    - Línea 3: aeiou"
    - 
    + Línea 3: äëïöü"
    + 

    - Expected  - 2
    + Received  + 2


          at <anonymous> (FILE:LINE)
    (fail) example 10 - Latin-1 with line breaks
    72 | test("example 11 - Latin-1 in objects", () => {
    73 |   expect({
    74 |     french: "crème brûlée",
    75 |     spanish: "niño español",
    76 |     special: "½ ¼ ¾ ± × ÷",
    77 |   }).toEqual({
              ^
    error: expect(received).toEqual(expected)

      
      {
    -   "french": "crème brulée",
    +   "french": "crème brûlée",
        "spanish": "niño español",
        "special": "½ ¼ ¾ ± × ÷",
      }
      

    - Expected  - 1
    + Received  + 1


          at <anonymous> (FILE:LINE)
    (fail) example 11 - Latin-1 in objects
    157 | line 35
    158 | line 36
    159 | line 37
    160 | line 38
    161 | line 39\`;
    162 |   expect(received).toEqual(expected);
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
    240 | line six
    241 | line seven
    242 | 
    243 | === has newline at end vs doesn't ===
    244 | \`;
    245 |   expect(received).toEqual(expected);
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
    - 
    + === has newline at end vs doesn't ==="
    + 

    - Expected  - 15
    + Received  + 10


          at <anonymous> (FILE:LINE)
    (fail) example 13 - simple multiline diff with sections
    246 | });
    247 | 
    248 | test("example 14 - single line diff", () => {
    249 |   const received = \`"¡hello, world"\`;
    250 |   const expected = \`"hello, world!"\`;
    251 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

    Expected: ""hello, world!""
    Received: ""¡hello, world""


          at <anonymous> (FILE:LINE)
    (fail) example 14 - single line diff
    252 | });
    253 | 
    254 | test("example 15 - unicode char diff", () => {
    255 |   const received = \`Hello 👋 世界 🌎!\`;
    256 |   const expected = \`Hello 👋 世界 🌍!\`;
    257 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

    Expected: "Hello 👋 世界 🌍!"
    Received: "Hello 👋 世界 🌎!"


          at <anonymous> (FILE:LINE)
    (fail) example 15 - unicode char diff
    266 | }\`;
    267 |   const expected = \`function main() {
    268 |     print("Hello, world!");
    269 |     print("Goodbye, world!");
    270 | }\`;
    271 |   expect(received).toEqual(expected);
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
    302 |   }
    303 | 
    304 |   // The Zig code adds a trailing newline to each string.
    305 |   const receivedString = receivedLines.join("\\n") + "\\n";
    306 |   const expectedString = expectedLines.join("\\n") + "\\n";
    307 |   expect(receivedString).toEqual(expectedString);
                                   ^
    error: expect(received).toEqual(expected)

    @@ -97,11 +97,11 @@
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
    @@ -197,11 +197,11 @@
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
    @@ -297,11 +297,11 @@
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
    @@ -398,11 +398,11 @@
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
    308 | });
    309 | 
    310 | test("example 18 - very long single line string", () => {
    311 |   const expected = "a".repeat(1000000);
    312 |   const received = "a".repeat(1000001);
    313 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

    Expected: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa... (999801 bytes truncated) ...aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    Received: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa... (999801 bytes truncated) ...aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


          at <anonymous> (FILE:LINE)
    (fail) example 18 - very long single line string
    312 |   const received = "a".repeat(1000001);
    313 |   expect(received).toEqual(expected);
    314 | });
    315 | 
    316 | test("not", () => {
    317 |   expect("Hello, World!").not.toEqual("Hello, World!");
                                        ^
    error: expect(received).not.toEqual(expected)

    Expected: not "Hello, World!"

          at <anonymous> (FILE:LINE)
    (fail) not
    316 | test("not", () => {
    317 |   expect("Hello, World!").not.toEqual("Hello, World!");
    318 | });
    319 | 
    320 | test("has end newline vs doesn't", () => {
    321 |   expect("Hello, World!\\n").toEqual("Hello, World!");
                                      ^
    error: expect(received).toEqual(expected)

    - "Hello, World!"
    + 
    + "Hello, World!
    + "
    + 

    - Expected  - 1
    + Received  + 4


          at <anonymous> (FILE:LINE)
    (fail) has end newline vs doesn't
    327 |   const received = new Float64Array(length);
    328 |   for (let i = 0; i < length; i++) {
    329 |     expected[i] = i;
    330 |     received[i] = i + 1;
    331 |   }
    332 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

    @@ -1,8 +1,8 @@
      
      Float64Array [
    -   0,
        1,
        2,
        3,
        4,
        5,
    @@ -9998,8 +9998,8 @@
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
    338 |   const received = new Int32Array(length);
    339 |   for (let i = 0; i < length; i++) {
    340 |     expected[i] = i;
    341 |     received[i] = length - i - 1;
    342 |   }
    343 |   expect(received).toEqual(expected);
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

     1 pass
     1 todo
     20 fail
     21 expect() calls
    Ran 22 tests across 1 file.
    "
  `);
  expect(noColorSpawn.exitCode).toBe(1);
  expect(noColorStdout).toMatchInlineSnapshot(`
    "bun test v1.2.19 (4dff2c0f)
    "
  `);

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

      \x1B[0m\x1B[2m\x1B[0m
      \x1B[0m\x1B[2m"a\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m\x1B[7md\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m\x1B[7mb\x1B[0m
      \x1B[0m\x1B[2mc\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32md\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m\x1B[7m \x1B[0m\x1B[31md\x1B[0m
      \x1B[0m\x1B[2me"\x1B[0m
      \x1B[0m\x1B[2m\x1B[0m

    \x1B[32m- Expected  - 2\x1B[0m
    \x1B[31m+ Received  + 2\x1B[0m


    \x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

      \x1B[0m\x1B[2m\x1B[0m
      \x1B[0m\x1B[2m{\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m  "age": \x1B[0m\x1B[32m\x1B[7m30\x1B[0m\x1B[32m,\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m  "age": \x1B[0m\x1B[31m\x1B[7m25\x1B[0m\x1B[31m,\x1B[0m
      \x1B[0m\x1B[2m  "logs": [\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m    "\x1B[0m\x1B[32m\x1B[7mLogged into system",\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m\x1B[7m    "Accessed dashboard",\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m\x1B[7m    "Reviewed daily reports",\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m\x1B[7m    "Updated project status",\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m\x1B[7m    "Sent status email to team",\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m\x1B[7m    "Scheduled follow-up meeting\x1B[0m\x1B[32m",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m    "\x1B[0m\x1B[31m\x1B[7mEntered the building",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m\x1B[7m    "Checked in at reception",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m\x1B[7m    "Took elevator to floor 3",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m\x1B[7m    "Attended morning meeting",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m\x1B[7m    "Started working on project\x1B[0m\x1B[31m",\x1B[0m
      \x1B[0m\x1B[2m  ],\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m  "name": "\x1B[0m\x1B[32m\x1B[7mBob\x1B[0m\x1B[32m",\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m  "name": "\x1B[0m\x1B[31m\x1B[7mAlice\x1B[0m\x1B[31m",\x1B[0m
      \x1B[0m\x1B[2m}\x1B[0m
      \x1B[0m\x1B[2m\x1B[0m

    \x1B[32m- Expected  - 8\x1B[0m
    \x1B[31m+ Received  + 7\x1B[0m


    \x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

    \x1B[36m@@ -1,8 +1,8 @@\x1B[0m
      \x1B[0m\x1B[2m\x1B[0m
      \x1B[0m\x1B[2mInt32Array [\x1B[0m
    \x1B[32m- \x1B[0m\x1B[32m\x1B[7m  0,\x1B[0m
      \x1B[0m\x1B[2m  1,\x1B[0m
      \x1B[0m\x1B[2m  2,\x1B[0m
      \x1B[0m\x1B[2m  3,\x1B[0m
      \x1B[0m\x1B[2m  4,\x1B[0m
      \x1B[0m\x1B[2m  5,\x1B[0m
    \x1B[36m@@ -99998,8 +99998,8 @@\x1B[0m
      \x1B[0m\x1B[2m  99995,\x1B[0m
      \x1B[0m\x1B[2m  99996,\x1B[0m
      \x1B[0m\x1B[2m  99997,\x1B[0m
      \x1B[0m\x1B[2m  99998,\x1B[0m
      \x1B[0m\x1B[2m  99999,\x1B[0m
    \x1B[31m+ \x1B[0m\x1B[31m\x1B[7m  100000,\x1B[0m
      \x1B[0m\x1B[2m]\x1B[0m
      \x1B[0m\x1B[2m\x1B[0m

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
