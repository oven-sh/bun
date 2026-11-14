import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyOfEngine, generateAgainst, hasNoPrebuiltEngine, timeLimitOfOneRun } from "./prebuilt-engine.ts";

// What the generator tells the reader of a refusal to do.
const remedy =
  "this WebKit was compiled with another list of the built-ins that its own code names than the one this tree declares: " +
  "a change to an entry that the engine declares or that aot/builtins/host-roles.builtins.ts lists needs a build of WebKit. " +
  "Build with --webkit=local, or pin a release of WebKit that was built from this tree's declarations";

// The generator compares the engine's files after it has generated everything else, so this file takes the time of one whole run.
test.skipIf(hasNoPrebuiltEngine)(
  "an engine compiled with another position for one built-in that it names is refused by name",
  async () => {
    const { root, generatedCopy } = copyOfEngine();
    using _ = root;
    const ids = join(generatedCopy, "AOTBuiltinIDs.h");
    const text = readFileSync(ids, "utf8");
    const written = /inline constexpr NamedTableID<BuiltinID> ArrayPrototypePush \{ (\d+) \};/.exec(text)!;
    const compiledWith = written[0].replace(written[1], `${Number(written[1]) + 1}`);
    const lineNumber = text.slice(0, written.index).split("\n").length;
    writeFileSync(ids, text.replace(written[0], compiledWith));

    const { exitCode, errors, tableOfBuiltins } = await generateAgainst(generatedCopy);
    expect({
      errors: errors.split("\n").filter(line => line !== "" && !line.startsWith("builtins table:")),
      tableOfBuiltins,
      exitCode,
    }).toEqual({
      // The one file that differs, with its line on both sides, and then what to do about it. Nothing is said of the engine's other files.
      errors: [
        `error: ${ids}: line ${lineNumber} is \`${compiledWith}\`, and this tree writes \`${written[0]}\``,
        remedy,
      ],
      // Nothing is written for the build to compile.
      tableOfBuiltins: "",
      exitCode: 1,
    });
  },
  timeLimitOfOneRun,
);
