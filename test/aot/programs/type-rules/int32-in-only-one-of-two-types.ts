// An object is used as two types, and a member is an `int32` in only one of them. The build accepts a store, a call and a result through either type: each function is proven by itself, and a number that came in through the type that says `number` goes on as it is, as in plain Bun. A read of a field through the type that says `int32` stops the build once an object that holds a number there is taken for that type: type-rules/an-object-with-a-number-member-is-taken-for-a-type-with-an-int32-member.
import type { int32 } from "bun";

const given: number[] = JSON.parse("[1.5, 3]");
interface Movable {
  line: number;
  column: int32;
  move(by: number): void;
  width(): int32;
}
class Cursor implements Movable {
  line: int32 = 0;
  column: number = 0;
  move(by: int32): void { this.line = by; }
  width(): number { return 1.5; }
}
class Base {
  at: int32 = 0;
  skip(by: int32): int32 { return by; }
}
class Derived extends Base {
  at: number = 0.5;
  skip(by: int32): number { return by / 2; }
}
class Agreeing extends Base {
  at: int32 = 1;
  skip(by: number): int32 { return by | 0; }
}
function setLine(movable: Movable, line: number): number { movable.line = line; return movable.line; }
function lineOf(cursor: Cursor): int32 { return cursor.line; }
function move(movable: Movable, by: number): void { movable.move(by); }
function widthOf(movable: Movable): int32 { return movable.width(); }
function skip(base: Base, by: int32): int32 { return base.skip(by); }
function attempt(name: string, f: () => unknown): void {
  try { console.log(name, String(f())); } catch (e) { const message = (e as Error).message, note = message.indexOf(" (bun compile checks types"); console.log(name, (e as Error).name + (note < 0 ? "" : ": " + message.slice(0, note))); }
}

attempt("a store through the interface, which says number:", () => setLine(new Cursor(), given[0]));
attempt("a read through the class after it:", () => { const cursor = new Cursor(); setLine(cursor, given[0]); return lineOf(cursor); });
attempt("a read through the class after a store of an int32:", () => { const cursor = new Cursor(); setLine(cursor, given[1]); return lineOf(cursor); });
attempt("a call through the interface, which says number:", () => move(new Cursor(), given[0]));
attempt("the same call with an int32:", () => { const cursor = new Cursor(); move(cursor, given[1]); return lineOf(cursor); });
attempt("a result through the interface, which says int32:", () => widthOf(new Cursor()));
attempt("a result that the subclass declares number:", () => skip(new Derived(), 1));
attempt("a subclass that agrees:", () => skip(new Agreeing(), 2));
