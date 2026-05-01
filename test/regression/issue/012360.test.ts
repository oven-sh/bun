// https://github.com/oven-sh/bun/issues/12360
import { fileURLToPath, pathToFileURL } from "bun";
import { expect, test } from "bun:test";
import { isWindows, tmpdirSync } from "harness";
import { join } from "path";

export async function validatePath(path: URL): Promise<URL | string> {
  const filePath = fileURLToPath(path);

  if (await Bun.file(filePath).exists()) {
    return pathToFileURL(filePath);
  } else {
    return "";
  }
}

test("validate executable given in the config using `validatePath`: invalid value", async () => {
  const dir = tmpdirSync();

  const filePath = join(dir, "./sample.exe");

  const newFilePath = await validatePath(pathToFileURL(filePath));

  expect(newFilePath).toBe("");
});

test("validate executable given in the config using `validatePath`: expected real implementation", async () => {
  const dir = tmpdirSync();
  const editorPath: URL | string = pathToFileURL(join(dir, "./metaeditor64.exe"));
  const terminalPath: URL | string = pathToFileURL(join(dir, "./terminal64.exe"));

  await Bun.write(isWindows ? editorPath.pathname.slice(1) : editorPath.pathname, "im a editor");
  await Bun.write(isWindows ? terminalPath.pathname.slice(1) : terminalPath.pathname, "im a terminal");

  const newEditorPath = <URL>await validatePath(editorPath);
  const newTerminalPath = <URL>await validatePath(terminalPath);

  expect(newEditorPath.pathname).toBe(editorPath.pathname);
  expect(newTerminalPath.pathname).toBe(terminalPath.pathname);
});
