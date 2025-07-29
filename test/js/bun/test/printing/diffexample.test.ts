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

    @@ -99,7 +99,7 @@
      line 98
      line 99
      line 100
    - line 101 - INSERTED
      line 101
      line 102
      line 103
    @@ -499,7 +499,7 @@
      line 497
      line 498
      line 499
    - line 500 - CHANGED
    + line 500
      line 501
      line 502
      line 503
    @@ -750,7 +750,7 @@
      line 748
      line 749
      line 750
    - line 751 - MODIFIED
    + line 751
      line 752
      line 753
      line 754
    @@ -900,7 +900,7 @@
      line 898
      line 899
      line 900
    - line 901 - DIFFERENT
    + line 901
      line 902
      line 903
      line 904

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

    @@ -99,7 +99,7 @@
      line 97
      line 98
      line 99
    - line 100
    + line 100 - inserted
      line 101
      line 102
      line 103
    @@ -199,7 +199,7 @@
      line 197
      line 198
      line 199
    - line 200 - deleted
    + line 200
      line 201
      line 202
      line 203
    @@ -299,7 +299,7 @@
      line 297
      line 298
      line 299
    - modified - line 300
    + line 300 - modified
      line 301
      line 302
      line 303
    @@ -400,7 +400,7 @@
      line 398
      line 399
      line 400
    + extra line!
      line 401
      line 402
      line 403

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

    Expected: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa... (999901 bytes truncated) ...aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    Received: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa... (999901 bytes truncated) ...aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


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

     1 pass
     1 todo
     18 fail
     19 expect() calls
    Ran 20 tests across 1 file.
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


    "
  `);
  expect(spawn.exitCode).toBe(0);
});

/*
issue:
in inline snapshot diffing, it is printing the color codes
*/
