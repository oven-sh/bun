import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("no color", async () => {
  const spawn = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/diffexample.fixture.ts"],
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...bunEnv,
      FORCE_COLOR: "0",
    },
  });
  await spawn.exited;
  expect(
    (await spawn.stderr.text())
      .replaceAll(/\[[0-9\.]+ms\]/g, "[DURATION]")
      .replaceAll(/at <anonymous> \(.*\)/g, "at <anonymous> (FILE:LINE)"),
  ).toMatchInlineSnapshot(`
    "
    test/js/bun/test/printing/diffexample.fixture.ts:
    1 | import { test, expect } from "bun:test";
    2 | 
    3 | test("example 1", () => {
    4 |   expect("a\\nb\\nc\\n d\\ne").toEqual("a\\nd\\nc\\nd\\ne");
                                   ^
    error: expect(received).toEqual(expected)

    Difference:

    - Received
    + Expected

    @@ -1,5 +1,5 @@
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

    Difference:

    - Received
    + Expected

    @@ -1,7 +1,7 @@
      {
        object1: a,
    -   object2: b,
    +   object2:  b,
        object3: "c
         d
    -    e",
    + ",
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

    Difference:

    - Received
    + Expected

    @@ -96,11 +96,12 @@
       line 96
       line 97
       line 98
       line 99
       line 100
    -  line 101
    +  line 101 - INSERTED
    +  line 101
       line 102
       line 103
       line 104
       line 105
       line 106
    @@ -495,11 +496,11 @@
       line 495
       line 496
       line 497
       line 498
       line 499
    -  line 500
    +  line 500 - CHANGED
       line 501
       line 502
       line 503
       line 504
       line 505
    @@ -746,11 +747,11 @@
       line 746
       line 747
       line 748
       line 749
       line 750
    -  line 751
    +  line 751 - MODIFIED
       line 752
       line 753
       line 754
       line 755
       line 756
    @@ -896,11 +897,11 @@
       line 896
       line 897
       line 898
       line 899
       line 900
    -  line 901
    +  line 901 - DIFFERENT
       line 902
       line 903
       line 904
       line 905
       line 906


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

    Difference:

    - Received
    + Expected

    @@ -1 +1 @@
    - \\u001B[31mhello\\u001B[0m
    + \\u001B[32mhello\\u001B[0m


          at <anonymous> (FILE:LINE)
    (fail) example 4 - ansi colors don't get printed to console [DURATION]

     0 pass
     4 fail
     4 expect() calls
    Ran 4 tests across 1 file. [DURATION]
    "
  `);
  expect(spawn.exitCode).toBe(1);
  expect(await spawn.stdout.text()).toMatchInlineSnapshot(`
    "bun test v1.2.19 (4dff2c0f)
    "
  `);
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
  stderr = stderr.split("Difference:")[1];
  const split = stderr.split("\n\n");
  split.pop();
  stderr = split.join("\n\n");

  expect(stderr).toMatchInlineSnapshot(`
    "

    \x1B[31m- Received\x1B[0m
    \x1B[32m+ Expected\x1B[0m

    \x1B[36m@@ -1,5 +1,5 @@\x1B[0m
      \x1B[2m"a\x1B[0m
    \x1B[31m-\x1B[0m \x1B[2m \x1B[0m\x1B[41mb\x1B[0m
    \x1B[32m+\x1B[0m \x1B[2m \x1B[0m\x1B[42md\x1B[0m
      \x1B[2m c\x1B[0m
    \x1B[31m-\x1B[0m \x1B[41m \x1B[0m\x1B[2m d\x1B[0m
    \x1B[32m+\x1B[0m \x1B[2m d\x1B[0m
      \x1B[2m e"\x1B[0m"
  `);
  expect(await spawn.stdout.text()).toMatchInlineSnapshot(`""`);
  expect(spawn.exitCode).toBe(1);
});

/*
issue:
in inline snapshot diffing, it is printing the color codes
*/
