import { $, spawnSync } from "bun";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("strict mode escape sequences", () => {
  tempDirWithFiles("07540", {});
  const cases = [
    { code: "\\7" },
    { code: "a\\x0q" },
    { code: "a\\xm" },
    { code: "a\\x1Be" },
    { code: "q\\7w" },
    { code: "q\\303a" },
    { code: "/\\7" },
    { code: "/\\9" },
  ];
  for (const c of cases) {
    const tagged_version = "String.raw`" + c.code + "`";
    const regular_version = "`" + c.code + "`";
    const string_version = "'" + c.code + "'";
    for (const version of [tagged_version, regular_version, string_version]) {
      let expected;
      try {
        expected = eval(version);
      } catch (e) {
        expected = e;
      }
      it.todoIf(expected instanceof Error)(version, () => {
        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), "-e", `console.log(${version})`],
          env: bunEnv,
        });
        if (expected instanceof Error) {
          expect({
            exitCode: exitCode,
            stdout: stdout.toString(),
          }).toEqual({
            exitCode: 0,
            stdout: "",
          });
          expect(exitCode).not.toBe(0);
        } else {
          expect({
            exitCode: exitCode,
            stdout: stdout.toString(),
          }).toEqual({
            exitCode: 0,
            stdout: expected + "\n",
          });
        }
      });
    }
  }
});
