function label(n: number) { return "item " + n; }
function* inner() { yield label(1); yield label(2); }
export function* outer() { yield* inner(); yield label(3); }

function pause() { return Promise.resolve(); }
async function step(n: number): Promise<string> { await pause(); return n === 0 ? "liftoff" : step(n - 1); }
export async function countdown(n: number) { return step(n); }

async function* source() { yield "raw"; }
const decorate = async (text: string) => "<" + text + ">";
export async function* pipeline() { for await (const value of source()) yield decorate(value); }

export function* neverStarted() { yield label(0); }
export async function neverAwaited() { await pause(); }
