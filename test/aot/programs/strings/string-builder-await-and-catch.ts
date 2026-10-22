// A string that a loop appends to keeps its content when a part or the append itself throws, across await, yield and collections, when 16-bit text arrives, and at the length limit.
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
function show(label: string, text: string): void {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  console.log(label + ": " + text.length + " " + hash + " " + JSON.stringify(text.length <= 90 ? text : text.slice(0, 40) + ".." + text.slice(-40)));
}
function risky(i: number): string { if (i % 3 === 2) throw new Error("part " + i); return "p" + i; }
function partThrows(n: number): string { let s = "<"; for (let i = 0; i < n; i++) { try { s += "[" + i + ":" + risky(i) + "]"; } catch (error) { s += "(" + (error as Error).message + " at " + s.length + ")"; } } return s + ">"; }
function throwExitsLoop(n: number): string { let s = ""; try { for (let i = 0; i < n; i++) { s += i; s += risky(i); s += ","; } } catch { s += "!"; } finally { s += "."; } return s; }
function handlerReturnsOldState(n: number): string { let s = "kept"; try { for (let i = 0; i < n; i++) s += risky(i); } catch { return s; } return s + " all"; }
const throwingToString = { toString(): string { throw new Error("no text"); } };
const plainToString = { toString(): string { return "text"; } };
function conversionThrows(parts: any[]): string { let s = ""; for (const part of parts) { try { s += "<" + part + ">"; } catch (error) { s += "{" + (error as Error).name + "}"; } } return s; }
async function later<T>(value: T): Promise<T> { await null; return value; }
async function fails(i: number): Promise<string> { await null; throw new Error("awaited " + i); }
async function acrossAwait(n: number): Promise<string> { let s = "start"; for (let i = 0; i < n; i++) { s += ":" + i; await null; s += i % 2 ? "odd" : await later("even"); } return s; }
async function awaitInTry(n: number): Promise<string> { let s = ""; for (let i = 0; i < n; i++) { try { s += i; s += i === 1 ? await fails(i) : await later("ok"); } catch (error) { s += "(" + (error as Error).message + ")"; } finally { s += ";"; } } return s; }
async function twoAtOnce(): Promise<string> { const [a, b] = await Promise.all([acrossAwait(4), acrossAwait(3)]); return a + "|" + b; }
function* yieldsLengths(n: number): Generator<number, string> { let s = ""; for (let i = 0; i < n; i++) { s += "ab"; yield s.length; s += i; } return s; }
function drained(n: number): string { const lengths: number[] = []; const generator = yieldsLengths(n); for (;;) { const step = generator.next(); if (step.done) return lengths.join() + " " + step.value; lengths.push(step.value as number); } }
function wideText(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += i === 3 ? "\u65e5\u672c\u8a9e" : i === 5 ? "\u{1F600}" : i === 6 ? "\ud800" : i === 7 ? "\u00e9\u00ff" : i === 8 ? "\u0100" : "ab"; return s; }
function wideFromStart(n: number): string { let s = "\u8a9e"; for (let i = 0; i < n; i++) s += i + "\u00e9"; return s; }
function long(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += "0123456789abcdef" + i; return s; }
function doubled(times: number): string { let text = "x"; for (let i = 0; i < times; i++) text = text + text; return text; }
function lengthLimit(): void {
  const big = doubled(29); let s = "head"; let appended = 0; let name = "none";
  try { for (let i = 0; i < 8; i++) { s += big; appended++; } } catch (error) { name = (error as Error).name; }
  const lengthAfterFailure = s.length; s += "tail";
  console.log("length limit: " + appended + " " + name + " " + lengthAfterFailure + " " + s.length);
}
function multipartLengthLimit(): void {
  const big = doubled(29); let s = "head"; let appended = 0; let name = "none";
  try { for (let i = 0; i < 8; i++) { s += "[" + big + "]" + i; appended++; } } catch (error) { name = (error as Error).name; }
  console.log("length limit, several parts: " + appended + " " + name + " " + s.length);
}
async function manyAtOnce(count: number): Promise<string> { const pending: Promise<string>[] = []; for (let i = 0; i < count; i++) pending.push(acrossAwait(1 + i % 4)); return (await Promise.all(pending)).join("|"); }
async function collectsAcrossAwait(n: number): Promise<string> { let s = "start"; for (let i = 0; i < n; i++) { s += ":" + i; await null; collect(); s += "."; } return s; }
function collectsAcrossYield(n: number): string { const generator = yieldsLengths(n); let s = ""; for (;;) { const step = generator.next(); collect(); if (step.done) return s + step.value; s += (step.value as number) + ","; } }
show("a part throws", partThrows(7));                       show("a throw exits the loop", throwExitsLoop(7));           show("no throw", throwExitsLoop(2));
show("the handler returns the old state", handlerReturnsOldState(7));                                                    show("no handler run", handlerReturnsOldState(2));
show("a conversion throws", conversionThrows([1, "two", throwingToString, null, plainToString, Symbol("s"), undefined, 4n, true]));
show("across await", await acrossAwait(5));                 show("await in try", await awaitInTry(4));                   show("two at once", await twoAtOnce());
console.log("across yield: " + drained(4));
show("16-bit text arrives", wideText(11));                  show("16-bit text from the start", wideFromStart(5));        show("long", long(20000));
lengthLimit();
multipartLengthLimit();
show("many at once", await manyAtOnce(12));                 show("collections across await", (await Promise.all([collectsAcrossAwait(3), collectsAcrossAwait(2)])).join("|"));
console.log("collections across yield: " + collectsAcrossYield(4));
