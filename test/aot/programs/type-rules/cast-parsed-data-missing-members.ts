// Parsed JSON is cast to an interface: complete, without required members, with an unknown enumeration value, with one member more.
declare const console: { log(...values: unknown[]): void };
// An interface that the program ALSO makes by a literal somewhere (so it is not taken for data from outside), and casts from JSON elsewhere.
// (1) complete JSON (2) JSON that lacks required members the program never reads (3) an enumeration's value the type does not know yet.
interface Ctx { cwd: string }
interface Session { type: 'session'; id: string; title: string | null; status: 'idle' | 'running'; created: string; ctx: Ctx; tags?: string[] }
function fresh(id: string): Session { return { type: 'session', id, title: null, status: 'idle', created: 'now', ctx: { cwd: '/' } } }
function unwrap(data: unknown): Session | undefined { return data as Session | undefined }
function idOf(text: string): string { try { return String(unwrap(JSON.parse(text))?.id) } catch (e) { return 'THROWN: ' + (e as Error).message } }
console.log(fresh('a').id)
console.log('complete:', idOf('{"type":"session","id":"x","title":null,"status":"idle","created":"c","ctx":{"cwd":"/"}}'))
console.log('partial:', idOf('{"id":"y"}'))
console.log('new enum value:', idOf('{"type":"session","id":"z","title":null,"status":"paused","created":"c","ctx":{"cwd":"/"}}'))
console.log('one member more:', idOf('{"type":"session","id":"w","title":null,"status":"idle","created":"c","ctx":{"cwd":"/"},"extra":1}'))
