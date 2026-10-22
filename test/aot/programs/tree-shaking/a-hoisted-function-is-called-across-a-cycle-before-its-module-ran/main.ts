// main imports early.ts, which imports main back and calls its hoisted function while main has not run a single statement. The function calls another one of main.
import { result } from "./early";

export function hoisted(): string {
  return "hoisted, " + alsoHoisted();
}

function alsoHoisted(): string {
  return "also hoisted";
}

console.log(result);
