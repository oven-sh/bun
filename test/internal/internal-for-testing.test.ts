// test/harness.ts requires bun:internal-for-testing from every test file (via
// test/preload.ts), so loading the module itself has to stay cheap: the node
// internals it exposes for `--expose-internals` tests must only be evaluated
// when a test asks for them.
import { exposedInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const names = Object.keys(exposedInternals);

test("every exposedInternals entry is a getter", () => {
  expect(names).not.toBeEmpty();
  const eager = names.filter(
    name => typeof Object.getOwnPropertyDescriptor(exposedInternals, name)?.get !== "function",
  );
  expect(eager).toEqual([]);
});

test("every exposedInternals entry loads and is the same object on each access", () => {
  const broken = names.filter(name => {
    const first = exposedInternals[name];
    return first === undefined || exposedInternals[name] !== first;
  });
  expect(broken).toEqual([]);
});

// harness.ts loads the module with require(); test files usually import it.
test.concurrent.each([
  ["require", `require("bun:internal-for-testing")`],
  ["import", `await import("bun:internal-for-testing")`],
])("loading bun:internal-for-testing via %s does not evaluate the exposed internals", async (_, load) => {
  // internal/util/colors, a dependency of the exposed internal/assert/myers_diff,
  // reads FORCE_COLOR once, when it is evaluated. Setting the variable after
  // loading bun:internal-for-testing and only then requiring colors therefore
  // shows whether loading bun:internal-for-testing had already evaluated it:
  // hasColors is false if it did, true if colors is first evaluated here.
  const env = { ...bunEnv };
  // With either of these set, FORCE_COLOR also prints an "is ignored" warning to stderr.
  delete env.NO_COLOR;
  delete env.NODE_DISABLE_COLORS;
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--expose-internals",
      "-e",
      `
        ${load};
        process.env.FORCE_COLOR = "1";
        console.log(require("internal/util/colors").hasColors);
      `,
    ],
    env,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "true", stderr: "", exitCode: 0 });
});
