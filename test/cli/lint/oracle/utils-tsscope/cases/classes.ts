class OnlyInside { m() { return new OnlyInside(); } static s = OnlyInside; }
class Extends extends (Extends as any) {}
@decorate(Decorated) class Decorated {}
function decorate(a: any): any {}
class Merged { m(): Merged { return this; } }
interface Merged { n(a: number): Merged }
namespace Merged { export const x = Merged; }
const expression = class Named { m() { return Named; } };
const anonymous = class {};
export default class {}
class TypeParameter<A, B> { a: A; }
class _Ignored {}
export class Exported { m() { return Exported; } }
class UsedOutside {}
new UsedOutside();
class Assigned {}
Assigned = 1 as any;
class WithStatic { static { WithStatic; } }
function f() { class Local { m() { Local; } } class Used {} return Used; }
f();
