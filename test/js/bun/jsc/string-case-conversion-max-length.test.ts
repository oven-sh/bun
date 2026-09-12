import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import os from "node:os";

// Full case mapping can make a string longer: "ß" uppercases to "SS" and "İ"
// (U+0130) lowercases to "i" followed by U+0307. When the converted string
// would be longer than the maximum string length (2^31 - 1), the conversion
// has to throw. JavaScriptCore used to hand back the input string unchanged,
// with no exception, because WTF::StringImpl reported "too long" the same way
// it reports "nothing to convert". The language-sensitive locales ("tr", "az",
// "el", "lt") converted into a WTF::Vector instead, which cannot even hold
// 2^30 UTF-16 characters, and a longer result aborted the process.
//
// Each case runs in its own child so the multi-GiB peak stays out of the
// runner and a crash shows up as a signal in the assertion. Measured peaks:
// 2.1 GiB (2.4 GiB under ASAN) for a root-locale uppercase child, which holds
// a 1 GiB Latin-1 input plus a 1 GiB attempt at the result, and 4.5 GiB for
// the lowercase and the Turkish children, which are UTF-16 on both sides. The
// small children still fit an 8 GB CI agent, whose os.totalmem() is a little
// under 8 GiB. Inside a container os.totalmem() reports the host's RAM,
// process.constrainedMemory() the cgroup limit.
const GiB = 1024 ** 3;
const memory = Math.min(os.totalmem(), process.constrainedMemory() || Infinity);
const fitsSmallChild = memory >= 6 * GiB;
const fitsLargeChild = memory >= 12 * GiB;
// All five children at once peak near 17 GiB.
const describeCases = memory >= 32 * GiB ? describe.concurrent : describe;

async function run(source: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode };
}

function printed(line: string) {
  return { stdout: line, stderr: "", exitCode: 0, signalCode: null };
}

// Prints what the conversion threw, or the length of what came back and
// whether that is the input string itself.
function attempt(setup: string, expression: string) {
  return `
    ${setup}
    try {
      const result = ${expression};
      console.log("returned length " + result.length + (result === input ? ", the input itself" : ""));
    } catch (e) {
      console.log(e.name + ": " + e.message);
    }
  `;
}

// 2^30 sharp s characters uppercase to 2^31 "S", one more than fits.
const sharpS = `const input = "\\u00DF".repeat(2 ** 30);`;
// Each U+0130 lowercases to two code units, so 2^30 of them need 2^31.
const dottedI = `const input = "\\u0130".repeat(2 ** 30);`;

const threw = printed("RangeError: Out of memory");

// A debug build takes 30 to 60 seconds per child, ten times what a release
// build takes, hence the explicit timeouts.
describeCases("case conversion near the maximum string length", () => {
  test.skipIf(!fitsSmallChild)(
    "toUpperCase throws when the result is too long",
    async () => {
      expect(await run(attempt(sharpS, `input.toUpperCase()`))).toEqual(threw);
    },
    240_000,
  );

  test.skipIf(!fitsSmallChild)(
    "toLocaleUpperCase throws when the result is too long",
    async () => {
      // "de" has no language-sensitive mappings, so this is the root
      // conversion, the same one toUpperCase does.
      expect(await run(attempt(sharpS, `input.toLocaleUpperCase("de-DE")`))).toEqual(threw);
    },
    240_000,
  );

  test.skipIf(!fitsSmallChild)(
    "DFG ToUpperCase throws when the result is too long",
    async () => {
      // Warm the function up on short strings first so that the long one goes
      // through the DFG's ToUpperCase node, whose slow path is a separate
      // operation from the untiered builtin.
      const warmup = `
        function viaDFG(s) { return s.toUpperCase(); }
        for (let i = 0; i < 1e5; i++) {
          if (viaDFG("stra\\u00DFe" + (i & 7)) !== "STRASSE" + (i & 7)) throw new Error("bad warmup");
        }
        ${sharpS}
      `;
      expect(await run(attempt(warmup, `viaDFG(input)`))).toEqual(threw);
    },
    240_000,
  );

  test.skipIf(!fitsLargeChild)(
    "toLowerCase throws when the result is too long",
    async () => {
      expect(await run(attempt(dottedI, `input.toLowerCase()`))).toEqual(threw);
    },
    240_000,
  );

  test.skipIf(!fitsLargeChild)(
    "toLocaleUpperCase with a language-sensitive locale returns a result of more than 2^30 characters",
    async () => {
      // 2^29 sharp s uppercase to 2^30 "S" under Turkish rules too, and the
      // "i" becomes "İ" (U+0130). That many UTF-16 characters did not fit in
      // the Vector that the ICU path for "tr", "az", "el" and "lt" converted into.
      const source = `
        const input = "\\u00DF".repeat(2 ** 29) + "i";
        const result = input.toLocaleUpperCase("tr");
        const codes = [0, 12345, 2 ** 29, 2 ** 30 - 1, 2 ** 30].map(i => result.charCodeAt(i));
        console.log("returned length " + result.length + ", char codes " + JSON.stringify(codes));
      `;
      expect(await run(source)).toEqual(printed(`returned length ${2 ** 30 + 1}, char codes [83,83,83,83,304]`));
    },
    240_000,
  );

  test("control: the same conversions far below the limit", async () => {
    const source = `
      console.log(JSON.stringify([
        "\\u00DF\\u00DFa".toUpperCase(),
        "\\u00DFa".toLocaleUpperCase("de-DE"),
        "\\u00DFi".toLocaleUpperCase("tr"),
        "\\u0130I".toLowerCase(),
      ]));
    `;
    expect(await run(source)).toEqual(printed(JSON.stringify(["SSSSA", "SSA", "SS\u0130", "i\u0307i"])));
  });
});
