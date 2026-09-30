// A command that does not know the flag: it runs every operand, as a runtime does.
import { resolve } from "node:path";

for (const operand of process.argv.slice(2)) {
  if (operand.startsWith("-")) continue;
  await import(resolve(operand));
}
