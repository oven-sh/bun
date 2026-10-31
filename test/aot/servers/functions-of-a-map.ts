import { readFileSync } from "fs";

/** `file position name form bytes` of each function that is written in the server's files or in a package, with a number where several are alike. */
export function functionsOfProgram(mapPath: string): Set<string> {
  const seen = new Map<string, number>();
  const functions = new Set<string>();
  for (const row of readFileSync(mapPath, "latin1").split("\n")) {
    const columns = row.split("\t");
    const path = columns[10] ?? "";
    if (columns[0] !== "F" || path.includes(".test.ts")) continue;
    const inPackage = path.lastIndexOf("/node_modules/");
    const inApp = path.lastIndexOf("/app/");
    // An executable puts its files under a root of its own.
    const file =
      inPackage >= 0
        ? path.slice(inPackage)
        : inApp >= 0
          ? path.slice(inApp)
          : path.startsWith("/$bunfs/root/")
            ? "/app/" + path.slice(13)
            : "";
    if (!file) continue;
    const key = `${file} ${columns[11]} ${columns[7]} ${columns[8]}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    functions.add(`${key} #${count} ${columns[3]}`);
  }
  return functions;
}
