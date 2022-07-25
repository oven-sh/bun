# wiptest tests

## To run these tests

Go back up to the main directory of this repo and run

```bash
make test-bun-wiptest
```

## Developing these tests

These tests are special. They test the test runner itself. Since we are testing the test runner, we unfortunately can't rely _on_ the test runner for these tests, since a bug in the runner could result in false passes. Instead this relies on a very small and very specialized test runner which processes the files in the `fixtures/` directory. The tests this runner actually performs are meta tests: it runs the `wiptest` runner on the file, and compares the output to what it expects to see. These expectations are given through special comment macros. All macros can be placed anywhere within the file, but MUST be preceded by `// ` (e.g. `// STATUS: PASS` is valid, but `//STATUS: PASS`, `/* STATUS: PASS */` and `# STATUS: PASS` are not).

| name          | description                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STATUS`      | The expected exit status of the `wiptest` command. Must be `PASS` or `FAIL`. May only be declared once per file.                                                                         |
| `EXPECT`      | Some text that must be in the output of the `wiptest` command.                                                                                                                           |
| `EXPECTNOT`   | Same as `EXPECT`, but the text must NOT appear in the output.                                                                                                                            |
| `TESTPATTERN` | Override the test pattern that will be passed to `wiptest`. It can be used for testing different types of file resolution, such as partial matching. May only be declared once per file. |

Each test file must contain a `STATUS` macro and at least one `EXPECT` and/or `EXPECTNOT`.

### Examples

#### Example 1

```js
// STATUS: FAIL
import { expect, it } from "bun:test";

it("should fail", () => {
  // EXPECT: Expected: 2
  // EXPECT: Received: 1
  // EXPECT: toBe.mismatch.test.js:8:2
  expect(1).toBe(2);
});

// EXPECT: 0 pass
// EXPECT: 1 fail
```

This will expect the test to fail (non-zero exit code), and the output must contain "Expected: 2", "Received: 1", "toBe.test.js:8:2", "0 pass", and "1 fail".

#### Example 2

```js
// STATUS: PASS
import { expect, it } from "bun:test";

it("should pass", () => {
  // EXPECTNOT: toBe.match.test.js:6:2
  expect(1).toBe(1);
});

// EXPECT: 1 pass
// EXPECT: 0 fail
```

This will expect the test to pass (exit code `0`), and the output must contain "1 pass", and "0 fail", and must NOT contain "toBe.test.js:6:2"

#### Example 3

```js
// EXPECT: 0 fail
import { expect, it } from "bun:test";

// STATUS: PASS
it("should pass", () => {
  expect(1).toBe(1);
});

// EXPECT: 1 pass
// EXPECTNOT: toBe.match.test.js:6:2
```

This results in the exact same test as Example 2. As you can see, the macros can be defined in any order. It's advised to place them next to the section of the code that generates the error, but they can be placed wherever makes the most sense for the test at hand.
