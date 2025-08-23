import { bunEnv, bunExe, isCI, isLinux, isMacOS, tempDirWithFiles } from "harness";
import { readFileSync } from "fs";

let keychainPath: string = "";
let keychainToRestore: string = "";

export function setupMacOSKeychain({
  beforeAll,
  afterAll,
}: {
  beforeAll: typeof import("bun:test").beforeAll;
  afterAll: typeof import("bun:test").afterAll;
}) {
  if (isMacOS)
    beforeAll(() => {
      const tempdir = tempDirWithFiles("secrets-keychain", {
        "package.json": "",
      });

      keychainPath = `${tempdir}/temp.keychain`;

      // Create and setup temporary keychain
      const result = Bun.spawnSync({
        cmd: [
          "sh",
          "-c",
          `security default-keychain > ${tempdir}/default-keychain && ` +
            `security create-keychain -p '' "${keychainPath}" && ` +
            `security default-keychain -s "${keychainPath}" && ` +
            `security unlock-keychain -p '' "${keychainPath}"`,
        ],
        env: bunEnv,
        stderr: "inherit",
        stdout: "inherit",
      });

      if (result.exitCode !== 0) {
        throw new Error("Failed to create temporary keychain for tests");
      }
      keychainToRestore = JSON.parse(readFileSync(`${tempdir}/default-keychain`, "utf8").trim());
    });

  if (isMacOS && keychainPath && keychainToRestore)
    afterAll(() => {
      // Clean up temporary keychain
      Bun.spawnSync({
        cmd: [
          "sh",
          "-c",
          `security default-keychain -s "${keychainToRestore}" && security delete-keychain "${keychainPath}"`,
        ],
        env: bunEnv,
        stderr: "inherit",
        stdout: "inherit",
      });
    });
}
