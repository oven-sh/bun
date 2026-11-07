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
 * `file position name form` of each such function, with a number where several are alike: how many bytes it has, and the operations that its
 * machine code was made of, each with how many values of it there are. A run leaves a map for each of its processes and for each image.
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
      } else if (columns[0] === "FO" && current) {
        // Behind the row `F` of its function. Three columns an entry, from the first on: an operation, whether its code is open, closed or generic,
        // and how many values of it are so.
        const counts = new Map<string, number>();
        for (let at = 1; at + 2 < columns.length; at += 3) {
          const [operation, , values] = columns.slice(at, at + 3);
          if (!forInstances.has(operation)) counts.set(operation, (counts.get(operation) ?? 0) + Number(values));
        }
        current.operations = [...counts]
          .map(([operation, count]) => `${operation} ${count}`)
          .sort()
          .join(",");
      }
    }
  }
  // Functions whose operations the build did not note would all count as made of the same ones.
  if (functions.size && ![...functions.values()].some(it => it.operations))
    throw new Error(`No row FO names an operation in ${mapPaths.join(", ")}`);
  return functions;
}
