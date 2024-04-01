import { describe } from "bun:test";
import { TestBuilder } from "./test_builder";
import { bunEnv } from "harness";

const BUN = process.argv0;

describe("bun exec", () => {
  TestBuilder.command`${BUN} exec ${"echo hi!"}`.env(bunEnv).stdout("hi!\n").runAsTest("it works");
  TestBuilder.command`${BUN} exec sldkfjslkdjflksdjflj`
    .env(bunEnv)
    .exitCode(1)
    .stderr("bun: command not found: sldkfjslkdjflksdjflj\n")
    .runAsTest("it works on command fail");

  TestBuilder.command`${BUN} exec`
    .env(bunEnv)
    .stdout(
      'Usage: bun exec <script>\n\nExecute a shell script directly from Bun.\n\nNote: If executing this from a shell, make sure to escape the string!\n\nExamples:\n  bunx exec "echo hi"\n  bunx exec "echo \\"hey friends\\"!"\n',
    )
    .runAsTest("no args prints help text");

  TestBuilder.command`${BUN} exec ${{ raw: Bun.$.escape(`echo 'hi "there bud"'`) }}`
    .stdout('hi "there bud"\n')
    .runAsTest("it works2");

  TestBuilder.command`${BUN} exec ${`echo ${Array(128 * 1024)
    .fill("a")
    .join("")}`}`
    .env(bunEnv)
    .stdout(
      `${Array(128 * 1024)
        .fill("a")
        .join("")}\n`,
    )
    .runAsTest("write a lot of data");
});
