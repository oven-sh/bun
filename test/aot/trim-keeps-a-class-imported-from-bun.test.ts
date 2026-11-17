import { expect } from "bun:test";
import { bunExe } from "harness";
import { canTrim } from "../bundler/compile-trim-features";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";
import { test } from "./supported";

// Each part asks something about the `Bun` object without reading a class of it, then imports the class from "bun" and uses it. No other part names the class.
const parts = [
  [`Object.hasOwn(Bun, "Glob")`, "Glob", `new Glob("*.js").match("a.js")`],
  [`Object.getOwnPropertyNames(Bun).includes("Cookie")`, "Cookie", `new Cookie("a", "b").name === "a"`],
  [`Object.seal(Bun) === Bun`, "CryptoHasher", `new CryptoHasher("sha1").update("a").digest("hex").length === 40`],
  [`["SH", "A256"].join("") in Bun`, "SHA256", `new SHA256().update("a").digest("hex").length === 64`],
];

if (!canTrim)
  console.error("SKIPPED: trim-keeps-a-class-imported-from-bun.test.ts: this build of Bun doesn't support --trim");

const { folder, build } = sharedBuilds("aot-trim-class-imported-from-bun", {
  "program.mjs": parts
    .map(
      ([question, name, use]) => `{
  console.log(${question});
  const { ${name} } = await import("bun");
  console.log(${use});
}
`,
    )
    .join(""),
});

test.skipIf(!canTrim)(
  `--trim keeps a class that the program imports from "bun" after ${parts.map(([question]) => question).join(", ")}`,
  async () => {
    const expected = { stdout: "true\n".repeat(2 * parts.length), stderr: "", exitCode: 0 };
    expect(await run([bunExe(), "run", "program.mjs"], folder)).toEqual(expected);
    expect(await run([(await build("program.mjs", "--aot", "--trim")).executable], folder)).toEqual(expected);
  },
);
