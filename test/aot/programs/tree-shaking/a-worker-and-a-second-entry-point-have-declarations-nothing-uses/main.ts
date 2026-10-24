// start.ts is the program and starts this file as a Worker. Both files, and a file they share, have constants, classes and enums at the top level: some used by one thread only, some by both, some by none, some exported by an entry point and imported by nobody.
import { sharedTable, forWorker } from "./shared";

const unusedInWorker = { a: 1 };
const table = { double: (n: number) => n * 2 };
class Formatter { format(n: number) { return "worker says " + n; } }
enum Mode { Fast = "fast" }
export const exportedByTheWorker = { nobody: "imports this" };
export class ExportedClass {}

declare var self: Worker;
self.onmessage = event => {
  postMessage([new Formatter().format(table.double(event.data)), Mode.Fast, sharedTable.both, forWorker.text].join(", "));
};
