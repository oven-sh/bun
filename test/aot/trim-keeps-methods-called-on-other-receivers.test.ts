import { expect } from "bun:test";
import { bunExe } from "harness";
import { canTrim } from "../bundler/compile-trim-features";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";
import { describe, test } from "./supported";

// Each call takes a method or a getter from the prototype of a host class and calls it on an object that is not an instance.
// The program never creates an instance, and no two calls of a program are on classes of one feature, so the call is the only use of the feature that the build sees.
const programs = [
  [
    `Blob.prototype.text.call({})`,
    `Headers.prototype.get.call({}, "a")`,
    `TextDecoder.prototype.decode.call({})`,
    `Bun.Glob.prototype.match.call({}, "a")`,
    `MessagePort.prototype.ref.call({})`,
  ],
  [
    `Blob.prototype.slice.call({})`,
    `Reflect.apply(TextDecoder.prototype.decode, {}, [])`,
    `BroadcastChannel.prototype.postMessage.call({}, 1)`,
  ],
  [`Response.prototype.json.call({})`, `(0, TextDecoder.prototype.decode)()`],
  [`Object.getOwnPropertyDescriptor(TextDecoder.prototype, "encoding").get.call({})`],
];

if (!canTrim)
  console.error(
    "SKIPPED: trim-keeps-methods-called-on-other-receivers.test.ts: this build of Bun doesn't support --trim",
  );

describe.skipIf(!canTrim)("--trim keeps a host method that is called on another receiver", () => {
  const { folder, build } = sharedBuilds(
    "aot-trim-other-receivers",
    Object.fromEntries(
      programs.map((calls, index) => [
        `program${index}.js`,
        calls
          .map(
            call => `try {
  console.log("returns", typeof ${call});
} catch (error) {
  console.log("throws", error.name, error.code, error.message);
}
`,
          )
          .join(""),
      ]),
    ),
  );

  test.concurrent.each(programs.map((calls, index) => [calls.join(", "), index, calls.length] as const))(
    "%s",
    async (_, index, calls) => {
      const plain = await run([bunExe(), "run", `program${index}.js`], folder);
      expect(plain.stdout).toMatch(new RegExp(`^(throws TypeError .*\\n){${calls}}$`));
      const trimmed = await build(`program${index}.js`, "--aot", "--trim");
      expect(await run([trimmed.executable], folder)).toEqual({ ...plain, stderr: "", exitCode: 0 });
    },
  );
});
