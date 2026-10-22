// Nothing in the program names what the entry point exports by a binding: a file it imports gets at them through import() of the entry point and through a namespace import.
import { viaImportCall, viaNamespace } from "./reader";

export function first() { return "first"; }
export const second = () => "second";
export class Third { name() { return "third"; } }
export default function () { return "the default"; }

console.log(viaNamespace());
viaImportCall().then(console.log);
