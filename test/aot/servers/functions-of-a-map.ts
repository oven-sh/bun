import { readFileSync } from "fs";

function fileOf(path: string) {
  const inPackage = path.lastIndexOf("/node_modules/");
  const inApp = path.lastIndexOf("/app/");
  // An executable puts its files under a root of its own.
  return inPackage >= 0
    ? path.slice(inPackage)
    : inApp >= 0
      ? path.slice(inApp)
      : path.startsWith("/$bunfs/root/")
        ? "/app/" + path.slice(13)
        : "";
}

/** `file position name form bytes` of each function that is written in the server's files or in a package, with a number where several are alike. */
export function functionsOfProgram(mapPath: string): Set<string> {
  const seen = new Map<string, number>();
  const functions = new Set<string>();
  for (const row of readFileSync(mapPath, "latin1").split("\n")) {
    const columns = row.split("\t");
    const path = columns[10] ?? "";
    if (columns[0] !== "F" || path.includes(".test.ts")) continue;
    const file = fileOf(path);
    if (!file) continue;
    const key = `${file} ${columns[11]} ${columns[7]} ${columns[8]}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    functions.add(`${key} #${count} ${columns[3]}`);
  }
  return functions;
}

/** What a program that runs more than once in a process needs besides. */
const forInstances = new Set(["BelongsToInstance", "BeginModuleEvaluation", "FinishModuleEvaluation"]);

/**
 * `file position name form` of each such function, with a number where several are alike: its bytes, and the operations that its machine code
 * was made of, each with how many values of it there are. A run in layers has a map for each of its programs.
 */
export function operationsOfProgram(mapPaths: string[]): Map<string, { bytes: string; operations: string }> {
  const functions = new Map<string, { bytes: string; operations: string }>();
  for (const mapPath of mapPaths) {
    const seen = new Map<string, number>();
    let current: { bytes: string; operations: string } | undefined;
    for (const row of readFileSync(mapPath, "latin1").split("\n")) {
      const columns = row.split("\t");
      if (columns[0] === "F") {
        current = undefined;
        const path = columns[10] ?? "";
        const file = path.includes(".test.ts") ? "" : fileOf(path);
        if (!file) continue;
        const key = `${file} ${columns[11]} ${columns[7]} ${columns[8]}`;
        const count = seen.get(key) ?? 0;
        seen.set(key, count + 1);
        if (functions.has(`${key} #${count}`)) continue;
        current = { bytes: columns[3], operations: "" };
        functions.set(`${key} #${count}`, current);
      } else if (columns[0] === "S" && current) {
        // Five columns a piece of machine code, from the first on: its operation, its value, and three more. A value may have several pieces.
        const values = new Set<string>();
        for (let at = 1; at + 4 < columns.length; at += 5)
          values.add(`${columns[at].replace(/[+*]+$/, "")} ${columns[at + 1]}`);
        const counts = new Map<string, number>();
        for (const value of values) {
          const operation = value.slice(0, value.indexOf(" "));
          if (!forInstances.has(operation)) counts.set(operation, (counts.get(operation) ?? 0) + 1);
        }
        current.operations = [...counts]
          .map(([operation, count]) => `${operation} ${count}`)
          .sort()
          .join(",");
      }
    }
  }
  return functions;
}
