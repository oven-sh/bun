// `get<ArrayBuffer>(url)` of a client library: the type is a claim handed to a generic function, and it may be wrong: a view of bytes comes, or text. `data as T` inside the generic function tests nothing.
// The value then goes through a record and a helper in which the program wrote `ArrayBuffer | undefined`: what is no ArrayBuffer throws a TypeError there, and undefined passes.
// VALIDATED compiles
interface Answer<T> { status: number; data: T }
function get<T>(kind: string): Answer<T> {
  const bytes = new Uint8Array([52, 48, 52]);
  const data: unknown = kind === "a buffer" ? bytes.buffer : kind === "a view of bytes" ? bytes : kind === "text" ? "404" : kind === "a number" ? 404 : kind === "a plain object" ? { byteLength: 3 } : undefined;
  return { status: 404, data: data as T };
}
function isShort(status: number, data: ArrayBuffer | undefined): boolean { return status === 404 && data !== undefined && data.byteLength <= 256 }
function read(kind: string): string {
  let held: { status: number; data: ArrayBuffer | undefined };
  const answer = get<ArrayBuffer>(kind);
  held = { status: answer.status, data: answer.data };
  return (isShort(held.status, held.data) ? "short" : "not short") + " " + typeof held.data + " " + String(held.data?.byteLength);
}
for (const kind of ["a buffer", "a view of bytes", "text", "a number", "a plain object", "nothing"]) {
  try { console.log(kind + ": " + read(kind)) } catch (e) { console.log(kind + ": throws " + (e as Error).name) }
}
