import { $ } from "bun";
import { TestBuilder } from "../test_builder";
import { beforeAll, describe, test, expect } from "bun:test";
import { sortedShellOutput } from "../util";

describe("bunshell cp", async () => {
  TestBuilder.command`cat ${import.meta.filename} > lmao.txt; cp -v lmao.txt lmao2.txt`
    .stdout("$TEMP_DIR/lmao.txt -> $TEMP_DIR/lmao2.txt\n")
    .ensureTempDir()
    .fileEquals("lmao2.txt", await $`cat ${import.meta.filename}`.text())
    .runAsTest('file -> file');

  TestBuilder.command`cat ${import.meta.filename} > lmao.txt; touch lmao2.txt; cp -v lmao.txt lmao2.txt`
    .stdout("$TEMP_DIR/lmao.txt -> $TEMP_DIR/lmao2.txt\n")
    .ensureTempDir()
    .fileEquals("lmao2.txt", await $`cat ${import.meta.filename}`.text())
    .runAsTest('file -> existing file replaces contents');

  TestBuilder.command`cat ${import.meta.filename} > lmao.txt; mkdir lmao2; cp -v lmao.txt lmao2`
    .ensureTempDir()
    .stdout("$TEMP_DIR/lmao.txt -> $TEMP_DIR/lmao2/lmao.txt\n")
    .fileEquals("lmao2/lmao.txt", await $`cat ${import.meta.filename}`.text())
    .runAsTest('file -> dir');

  TestBuilder.command`cat ${import.meta.filename} > lmao.txt; cp -v lmao.txt lmao2/`
    .ensureTempDir()
    .stderr('cp: $TEMP_DIR/lmao2/ is not a directory\n')
    .exitCode(1)
    .runAsTest('file -> non-existent dir fails');

  TestBuilder.command`cat ${import.meta.filename} > lmao.txt; cat ${import.meta.filename} > lmao2.txt; mkdir lmao3; cp -v lmao.txt lmao2.txt lmao3`
    .ensureTempDir()
    .stdout(expectSortedOutput("$TEMP_DIR/lmao.txt -> $TEMP_DIR/lmao3/lmao.txt\n$TEMP_DIR/lmao2.txt -> $TEMP_DIR/lmao3/lmao2.txt\n"))
    .fileEquals("lmao3/lmao.txt", await $`cat ${import.meta.filename}`.text())
    .fileEquals("lmao3/lmao2.txt", await $`cat ${import.meta.filename}`.text())
    .runAsTest('file+ -> dir');

  TestBuilder.command`mkdir lmao; mkdir lmao2; cp -v lmao lmao2 lmao3`
    .ensureTempDir()
    .stderr(expectSortedOutput('cp: $TEMP_DIR/lmao is a directory (not copied)\ncp: $TEMP_DIR/lmao2 is a directory (not copied)\n'))
    .exitCode(1)
    .runAsTest('dir -> ? fails without -R');
});

function expectSortedOutput(expected: string) {
  return (stdout: string, tempdir: string) => expect(sortedShellOutput(stdout).join('\n')).toEqual(sortedShellOutput(expected).join('\n').replaceAll("$TEMP_DIR", tempdir))
}
