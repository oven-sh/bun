// What an engine was compiled with: the folder that src/codegen/builtins/index.ts takes as --prebuilt-generated.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { generateForEngine } from "../../../src/codegen/builtins/engine.ts";
import { engineDirectory } from "../../../src/codegen/engine-directory.ts";

export { engineDirectory };

const holdsEngineFiles = (directory: string | undefined): directory is string =>
  directory !== undefined && existsSync(join(directory, "AOTBuiltinEngineDeclarations.json"));

async function findEngineFiles(): Promise<string | undefined> {
  // A build says where its own lie (scripts/build/aot-paths.ts). A prebuilt WebKit brings them, and so does CI's aot-engine.
  const brought = [process.env.AOT_BUILTINS_GENERATED, join(engineDirectory, "builtins", "generated")];
  const found = brought.find(holdsEngineFiles);
  if (found !== undefined) return found;
  // A checkout has what they are made from.
  if (!existsSync(join(engineDirectory, "builtins", "AOTBuiltinTable.cmake"))) return undefined;
  const directory = mkdtempSync(join(tmpdir(), "engine-files-"));
  process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
  const { engine } = await generateForEngine(dirname(engineDirectory));
  for (const [name, text] of engine) writeFileSync(join(directory, name), text);
  return directory;
}

export const engineFiles: string | undefined = await findEngineFiles();
