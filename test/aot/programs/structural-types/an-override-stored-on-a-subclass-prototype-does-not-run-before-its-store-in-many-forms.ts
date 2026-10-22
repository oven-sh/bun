const never = process.argv.length > 99;

function stored(): string {
  return "stored";
}

class Other {
  read(): string {
    return "stored";
  }
}

class ExpressionBase {
  n = 1;
  read(): string {
    return "inherited " + this.n;
  }
}

class Expression extends ExpressionBase {}

function readExpression(b: ExpressionBase): string {
  return b.read();
}

{
  const before = readExpression(new Expression()) + " | " + new Expression().read() + " | " + Object.hasOwn(Expression.prototype, "read");
  Expression.prototype.read = function () {
    return "stored " + this.n;
  };
  console.log("a function expression" + ": before " + before + " || after " + readExpression(new Expression()) + " | " + new Expression().read() + " | " + Object.hasOwn(Expression.prototype, "read") + " | the base " + readExpression(new ExpressionBase()));
}

class ArrowBase {
  n = 1;
  read(): string {
    return "inherited " + this.n;
  }
}

class Arrow extends ArrowBase {}

function readArrow(b: ArrowBase): string {
  return b.read();
}

{
  const before = readArrow(new Arrow()) + " | " + new Arrow().read() + " | " + Object.hasOwn(Arrow.prototype, "read");
  Arrow.prototype.read = () => "stored";
  console.log("an arrow" + ": before " + before + " || after " + readArrow(new Arrow()) + " | " + new Arrow().read() + " | " + Object.hasOwn(Arrow.prototype, "read") + " | the base " + readArrow(new ArrowBase()));
}

class DeclaredBase {
  n = 1;
  read(): string {
    return "inherited " + this.n;
  }
}

class Declared extends DeclaredBase {}

function readDeclared(b: DeclaredBase): string {
  return b.read();
}

{
  const before = readDeclared(new Declared()) + " | " + new Declared().read() + " | " + Object.hasOwn(Declared.prototype, "read");
  Declared.prototype.read = stored;
  console.log("a declared function" + ": before " + before + " || after " + readDeclared(new Declared()) + " | " + new Declared().read() + " | " + Object.hasOwn(Declared.prototype, "read") + " | the base " + readDeclared(new DeclaredBase()));
}

class BorrowedBase {
  n = 1;
  read(): string {
    return "inherited " + this.n;
  }
}

class Borrowed extends BorrowedBase {}

function readBorrowed(b: BorrowedBase): string {
  return b.read();
}

{
  const before = readBorrowed(new Borrowed()) + " | " + new Borrowed().read() + " | " + Object.hasOwn(Borrowed.prototype, "read");
  Borrowed.prototype.read = Other.prototype.read;
  console.log("a method of another class" + ": before " + before + " || after " + readBorrowed(new Borrowed()) + " | " + new Borrowed().read() + " | " + Object.hasOwn(Borrowed.prototype, "read") + " | the base " + readBorrowed(new BorrowedBase()));
}

class BoundBase {
  n = 1;
  read(): string {
    return "inherited " + this.n;
  }
}

class Bound extends BoundBase {}

function readBound(b: BoundBase): string {
  return b.read();
}

{
  const before = readBound(new Bound()) + " | " + new Bound().read() + " | " + Object.hasOwn(Bound.prototype, "read");
  Bound.prototype.read = stored.bind(null);
  console.log("a bound function" + ": before " + before + " || after " + readBound(new Bound()) + " | " + new Bound().read() + " | " + Object.hasOwn(Bound.prototype, "read") + " | the base " + readBound(new BoundBase()));
}

class BracketsBase {
  n = 1;
  read(): string {
    return "inherited " + this.n;
  }
}

class Brackets extends BracketsBase {}

function readBrackets(b: BracketsBase): string {
  return b.read();
}

{
  const before = readBrackets(new Brackets()) + " | " + new Brackets().read() + " | " + Object.hasOwn(Brackets.prototype, "read");
  Brackets.prototype["read"] = stored;
  console.log("brackets" + ": before " + before + " || after " + readBrackets(new Brackets()) + " | " + new Brackets().read() + " | " + Object.hasOwn(Brackets.prototype, "read") + " | the base " + readBrackets(new BracketsBase()));
}

class AliasBase {
  n = 1;
  read(): string {
    return "inherited " + this.n;
  }
}

class Alias extends AliasBase {}

function readAlias(b: AliasBase): string {
  return b.read();
}

{
  const before = readAlias(new Alias()) + " | " + new Alias().read() + " | " + Object.hasOwn(Alias.prototype, "read");
  const proto = Alias.prototype;
  proto.read = stored;
  console.log("an alias of the prototype" + ": before " + before + " || after " + readAlias(new Alias()) + " | " + new Alias().read() + " | " + Object.hasOwn(Alias.prototype, "read") + " | the base " + readAlias(new AliasBase()));
}

class AssignedBase {
  n = 1;
  read(): string {
    return "inherited " + this.n;
  }
}

class Assigned extends AssignedBase {}

function readAssigned(b: AssignedBase): string {
  return b.read();
}

{
  const before = readAssigned(new Assigned()) + " | " + new Assigned().read() + " | " + Object.hasOwn(Assigned.prototype, "read");
  Object.assign(Assigned.prototype, { read: stored });
  console.log("Object.assign" + ": before " + before + " || after " + readAssigned(new Assigned()) + " | " + new Assigned().read() + " | " + Object.hasOwn(Assigned.prototype, "read") + " | the base " + readAssigned(new AssignedBase()));
}

class DefinedBase {
  n = 1;
  read(): string {
    return "inherited " + this.n;
  }
}

class Defined extends DefinedBase {}

function readDefined(b: DefinedBase): string {
  return b.read();
}

{
  const before = readDefined(new Defined()) + " | " + new Defined().read() + " | " + Object.hasOwn(Defined.prototype, "read");
  Object.defineProperty(Defined.prototype, "read", { value: stored });
  console.log("Object.defineProperty" + ": before " + before + " || after " + readDefined(new Defined()) + " | " + new Defined().read() + " | " + Object.hasOwn(Defined.prototype, "read") + " | the base " + readDefined(new DefinedBase()));
}

class LaterBase {
  n = 1;
  read(): string {
    return "inherited " + this.n;
  }
}

class Later extends LaterBase {}

function readLater(b: LaterBase): string {
  return b.read();
}

function patchLater(): void {
  Later.prototype.read = stored;
}

{
  const before = readLater(new Later()) + " | " + new Later().read() + " | " + Object.hasOwn(Later.prototype, "read");
  patchLater();
  console.log("a function that is called later" + ": before " + before + " || after " + readLater(new Later()) + " | " + new Later().read() + " | " + Object.hasOwn(Later.prototype, "read") + " | the base " + readLater(new LaterBase()));
}

class NeverBase {
  n = 1;
  read(): string {
    return "inherited " + this.n;
  }
}

class Never extends NeverBase {}

function readNever(b: NeverBase): string {
  return b.read();
}

{
  const before = readNever(new Never()) + " | " + new Never().read() + " | " + Object.hasOwn(Never.prototype, "read");
  if (never) Never.prototype.read = stored;
  console.log("a condition that is never true" + ": before " + before + " || after " + readNever(new Never()) + " | " + new Never().read() + " | " + Object.hasOwn(Never.prototype, "read") + " | the base " + readNever(new NeverBase()));
}

class UncalledBase {
  n = 1;
  read(): string {
    return "inherited " + this.n;
  }
}

class Uncalled extends UncalledBase {}

function readUncalled(b: UncalledBase): string {
  return b.read();
}

function patchUncalled(): void {
  Uncalled.prototype.read = stored;
}

{
  const before = readUncalled(new Uncalled()) + " | " + new Uncalled().read() + " | " + Object.hasOwn(Uncalled.prototype, "read");
  if (never) patchUncalled();
  console.log("a function that is never called" + ": before " + before + " || after " + readUncalled(new Uncalled()) + " | " + new Uncalled().read() + " | " + Object.hasOwn(Uncalled.prototype, "read") + " | the base " + readUncalled(new UncalledBase()));
}

class CallbackBase {
  n = 1;
  read(): string {
    return "inherited " + this.n;
  }
}

class Callback extends CallbackBase {}

function readCallback(b: CallbackBase): string {
  return b.read();
}

{
  const before = readCallback(new Callback()) + " | " + new Callback().read() + " | " + Object.hasOwn(Callback.prototype, "read");
  const empty: number[] = [];
  empty.forEach(() => {
    Callback.prototype.read = stored;
  });
  console.log("a callback that is never called" + ": before " + before + " || after " + readCallback(new Callback()) + " | " + new Callback().read() + " | " + Object.hasOwn(Callback.prototype, "read") + " | the base " + readCallback(new CallbackBase()));
}

export {};
