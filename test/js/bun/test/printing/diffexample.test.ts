import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function cleanOutput(output: string) {
  return output
    .replaceAll(/\[[0-9\.]+ms\]/g, "[DURATION]")
    .replaceAll(/at <anonymous> \(.*\)/g, "at <anonymous> (FILE:LINE)");
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

    - Received
    + Expected

      "a
    -  b
    +  d
       c
    -   d
    +  d
       e"



          at <anonymous> (FILE:LINE)
    (fail) example 1 [DURATION]
     6 | test("example 2", () => {
     7 |   expect({
     8 |     object1: "a",
     9 |     object2: "b",
    10 |     object3: "c\\nd\\ne",
    11 |   }).toEqual({
              ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

      {
        object1: a,
    -   object2: b,
    +   object2:  b,
        object3: "c
    -    d
    -    e",
    +    d",
      }



          at <anonymous> (FILE:LINE)
    (fail) example 2 [DURATION]
    26 |   expectedLines[750] = "line 751 - MODIFIED"; // Change line 751
    27 |   expectedLines[900] = "line 901 - DIFFERENT"; // Change line 901
    28 |   expectedLines.splice(100, 0, "line 101 - INSERTED");
    29 |   const expectedString = expectedLines.join("\\n");
    30 | 
    31 |   expect(originalString).toEqual(expectedString);
                                  ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

    @@ -98,7 +98,7 @@
       line 98
       line 99
       line 100
    +  line 101 - INSERTED
       line 101
       line 102
       line 103
    @@ -498,7 +498,7 @@
       line 497
       line 498
       line 499
    -  line 500
    +  line 500 - CHANGED
       line 501
       line 502
       line 503
    @@ -749,7 +749,7 @@
       line 748
       line 749
       line 750
    -  line 751
    +  line 751 - MODIFIED
       line 752
       line 753
       line 754
    @@ -899,7 +899,7 @@
       line 898
       line 899
       line 900
    -  line 901
    +  line 901 - DIFFERENT
       line 902
       line 903
       line 904



          at <anonymous> (FILE:LINE)
    (fail) example 3 - very long string with few changes [DURATION]
    30 | 
    31 |   expect(originalString).toEqual(expectedString);
    32 | });
    33 | 
    34 | test("example 4 - ansi colors don't get printed to console", () => {
    35 |   expect("\\x1b[31mhello\\x1b[0m").toEqual("\\x1b[32mhello\\x1b[0m");
                                          ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

    - \\u001B[31mhello\\u001B[0m
    + \\u001B[32mhello\\u001B[0m



          at <anonymous> (FILE:LINE)
    (fail) example 4 - ansi colors don't get printed to console [DURATION]
    34 | test("example 4 - ansi colors don't get printed to console", () => {
    35 |   expect("\\x1b[31mhello\\x1b[0m").toEqual("\\x1b[32mhello\\x1b[0m");
    36 | });
    37 | 
    38 | test("example 5 - Unicode characters", () => {
    39 |   expect("Hello 👋 世界 🌍").toEqual("Hello 👋 世界 🌎");
                                   ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

    - Hello \\uD83D\\uDC4B 世界 \\uD83C\\uDF0D
    + Hello \\uD83D\\uDC4B 世界 \\uD83C\\uDF0E



          at <anonymous> (FILE:LINE)
    (fail) example 5 - Unicode characters [DURATION]
    38 | test("example 5 - Unicode characters", () => {
    39 |   expect("Hello 👋 世界 🌍").toEqual("Hello 👋 世界 🌎");
    40 | });
    41 | 
    42 | test("example 6 - Unicode with line breaks", () => {
    43 |   expect("Line 1: 你好\\nLine 2: مرحبا\\nLine 3: Здравствуйте").toEqual("Line 1: 你好\\nLine 2: مرحبا\\nLine 3: Привет");
                                                                    ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

      "Line 1: 你好
       Line 2: مرحبا
    -  Line 3: Здравствуйте"
    +  Line 3: Привет"



          at <anonymous> (FILE:LINE)
    (fail) example 6 - Unicode with line breaks [DURATION]
    47 |   expect({
    48 |     emoji: "🔥💧🌊",
    49 |     chinese: "测试字符串",
    50 |     arabic: "اختبار",
    51 |     mixed: "Hello 世界 🌍",
    52 |   }).toEqual({
              ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

      {
        arabic: اختبار,
    -   chinese: 测试字符串,
    +   chinese: 测试文本,
        emoji: \\uD83D\\uDD25\\uD83D\\uDCA7\\uD83C\\uDF0A,
    -   mixed: Hello 世界 \\uD83C\\uDF0D,
    +   mixed: Hello 世界 \\uD83C\\uDF0E,
      }



          at <anonymous> (FILE:LINE)
    (fail) example 7 - Mixed Unicode in objects [DURATION]
    56 |     mixed: "Hello 世界 🌎",
    57 |   });
    58 | });
    59 | 
    60 | test("example 8 - Latin-1 characters", () => {
    61 |   expect("café résumé naïve").toEqual("café resumé naive");
                                      ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

    - café résumé naïve
    + café resumé naive



          at <anonymous> (FILE:LINE)
    (fail) example 8 - Latin-1 characters [DURATION]
    (pass) example 9 - Latin-1 extended characters [DURATION]
    64 | test("example 9 - Latin-1 extended characters", () => {
    65 |   expect("© ® ™ £ € ¥ § ¶").toEqual("© ® ™ £ € ¥ § ¶");
    66 | });
    67 | 
    68 | test("example 10 - Latin-1 with line breaks", () => {
    69 |   expect("Línea 1: ñoño\\nLínea 2: àèìòù\\nLínea 3: äëïöü").toEqual("Línea 1: ñoño\\nLínea 2: àèìòù\\nLínea 3: aeiou");
                                                                  ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

      "Línea 1: ñoño
       Línea 2: àèìòù
    -  Línea 3: äëïöü"
    +  Línea 3: aeiou"



          at <anonymous> (FILE:LINE)
    (fail) example 10 - Latin-1 with line breaks [DURATION]
    72 | test("example 11 - Latin-1 in objects", () => {
    73 |   expect({
    74 |     french: "crème brûlée",
    75 |     spanish: "niño español",
    76 |     special: "½ ¼ ¾ ± × ÷",
    77 |   }).toEqual({
              ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

      {
    -   french: crème brûlée,
    +   french: crème brulée,
        spanish: niño español,
        special: ½ ¼ ¾ ± × ÷,
      }



          at <anonymous> (FILE:LINE)
    (fail) example 11 - Latin-1 in objects [DURATION]
    157 | line 35
    158 | line 36
    159 | line 37
    160 | line 38
    161 | line 39\`;
    162 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

    @@ -1,12 +1,12 @@
      "line one
       line two
    -  line three!
    +  line three
       line four
       line five
    -  !-!six
    +  line six
       line seven
       line eight
    +  line nine (inserted only)
       line ten
       line 11
       line 12
    @@ -25,7 +25,7 @@
       line 25
       line 26
       line 27
    -  line 28!
    +  line 28
       line 29
       line 30
       line 31



          at <anonymous> (FILE:LINE)
    (fail) example 12 - zig large multiline diff [DURATION]
    240 | line six
    241 | line seven
    242 | 
    243 | === has newline at end vs doesn't ===
    244 | \`;
    245 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

      "=== diffdiff ===
       line one
    -  line two!
    +  line two
    +  line three
    +  line four
    +  line five
       line six
       line seven
       
       === each line changed ===
    -  line one?
    -  line two
    -  line three?
    -  line four?
    +  line one
    +  line two!
    +  line three
    +  line four!
       
       === deleted ===
       line one
       line two
    -  line three
    -  line four
    -  line five
       line six
       line seven
       
       === inserted ===
       line one
       line two
    +  line three
    +  line four
    +  line five
       line six
       line seven
       
       === inserted newline ===
       line one
       line two
    +  
       line three
       line four
       line five
       line six
       line seven
       
    -  === has newline at end vs doesn't ==="
    +  === has newline at end vs doesn't ===
    +  "



          at <anonymous> (FILE:LINE)
    (fail) example 13 - zig simple multiline diff with sections [DURATION]
    246 | });
    247 | 
    248 | test("example 14 - zig single line diff", () => {
    249 |   const received = \`"¡hello, world"\`;
    250 |   const expected = \`"hello, world!"\`;
    251 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

    - \\"¡hello, world\\"
    + \\"hello, world!\\"



          at <anonymous> (FILE:LINE)
    (fail) example 14 - zig single line diff [DURATION]
    252 | });
    253 | 
    254 | test("example 15 - zig unicode char diff", () => {
    255 |   const received = \`Hello 👋 世界 🌎!\`;
    256 |   const expected = \`Hello 👋 世界 🌍!\`;
    257 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

    - Hello \\uD83D\\uDC4B 世界 \\uD83C\\uDF0E!
    + Hello \\uD83D\\uDC4B 世界 \\uD83C\\uDF0D!



          at <anonymous> (FILE:LINE)
    (fail) example 15 - zig unicode char diff [DURATION]
    266 | }\`;
    267 |   const expected = \`function main() {
    268 |     print("Hello, world!");
    269 |     print("Goodbye, world!");
    270 | }\`;
    271 |   expect(received).toEqual(expected);
                             ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

      "function main() {
    -      if (true) {
    -          print(\\"Hello, world!\\");
    -          print(\\"Goodbye, world!\\");
    -      }
    +      print(\\"Hello, world!\\");
    +      print(\\"Goodbye, world!\\");
       }"



          at <anonymous> (FILE:LINE)
    (fail) example 16 - zig indentation change diff [DURATION]
    302 |   }
    303 | 
    304 |   // The Zig code adds a trailing newline to each string.
    305 |   const receivedString = receivedLines.join("\\n") + "\\n";
    306 |   const expectedString = expectedLines.join("\\n") + "\\n";
    307 |   expect(receivedString).toEqual(expectedString);
                                   ^
    error: expect(received).toEqual(expected)

    - Received
    + Expected

    @@ -98,7 +98,7 @@
       line 97
       line 98
       line 99
    -  line 100 - inserted
    +  line 100
       line 101
       line 102
       line 103
    @@ -198,7 +198,7 @@
       line 197
       line 198
       line 199
    -  line 200
    +  line 200 - deleted
       line 201
       line 202
       line 203
    @@ -298,7 +298,7 @@
       line 297
       line 298
       line 299
    -  line 300 - modified
    +  modified - line 300
       line 301
       line 302
       line 303
    @@ -399,7 +399,7 @@
       line 398
       line 399
       line 400
    -  extra line!
       line 401
       line 402
       line 403



          at <anonymous> (FILE:LINE)
    (fail) example 17 - zig very long string [DURATION]

     1 pass
     16 fail
     17 expect() calls
    Ran 17 tests across 1 file. [DURATION]
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
  let stderr = await spawn.stderr.text();
  stderr = stderr.split("a\\nd\\nc\\nd\\ne")[1];
  const split = stderr.split("\n\n");
  split.pop();
  stderr = split.join("\n\n");

  expect(stderr).toMatchInlineSnapshot(`
    ""\x1B[0m)\x1B[0m\x1B[2m;\x1B[0m
                                 \x1B[31m\x1B[1m^\x1B[0m
    \x1B[0m\x1B[31merror\x1B[0m\x1B[2m:\x1B[0m \x1B[1m\x1B[2mexpect(\x1B[0m\x1B[31mreceived\x1B[0m\x1B[2m).\x1B[0mtoEqual\x1B[2m(\x1B[0m\x1B[32mexpected\x1B[0m\x1B[2m)\x1B[0m

    \x1B[31m- Received\x1B[0m
    \x1B[32m+ Expected\x1B[0m

      \x1B[0m\x1B[2m"a\x1B[0m
    \x1B[31m- \x1B[0m\x1B[31m \x1B[0m\x1B[41mb\x1B[0m
    \x1B[32m+ \x1B[0m\x1B[32m \x1B[0m\x1B[42md\x1B[0m
      \x1B[0m\x1B[2m c\x1B[0m
    \x1B[31m- \x1B[0m\x1B[41m \x1B[0m\x1B[31m d\x1B[0m
    \x1B[32m+ \x1B[0m\x1B[32m d\x1B[0m
      \x1B[0m\x1B[2m e"\x1B[0m"
  `);
  expect(await spawn.stdout.text()).toMatchInlineSnapshot(`""`);
  expect(spawn.exitCode).toBe(1);
});

/*
issue:
in inline snapshot diffing, it is printing the color codes
*/
