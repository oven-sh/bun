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

     0 pass
     3 fail
     3 expect() calls
    Ran 3 tests across 1 file. [DURATION]
    "
  `);
  expect(spawn.exitCode).toBe(1);
  expect(await spawn.stdout.text()).toMatchInlineSnapshot(`
    "bun test v1.2.19 (4dff2c0f)
    "
  `);
});
