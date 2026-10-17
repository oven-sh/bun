// `get<ArrayBuffer>(url)` of a client library: the type is a claim handed to a generic function, and it may be wrong: a view of bytes comes, or text. JavaScript does not mind: `byteLength` is there, or is undefined.
// The value goes through a record and a helper that are typed by the claim.
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
