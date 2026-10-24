// What a program calls its types decides nothing: an alias of `number` is `number`, whatever its name.
type int32 = number;
type uint8 = number;
type Count = int32;
interface Box { held: int32; counted: Count; small: uint8 }
class Meter { level: int32 = 0; raise(by: int32): int32 { this.level += by; return this.level; } }
function half(n: int32): int32 { return n / 2; }
function far(n: Count): Count { return n * 4294967296; }
const box: Box = { held: 1.5, counted: 2 ** 40, small: -0.25 };
let kept: int32 = 0.5;
kept += half(3);
const meter = new Meter();
console.log(half(3), half(-1), far(3), 1 / half(-0), half(NaN), half(Infinity));
console.log(box.held, box.counted, box.small, kept, meter.raise(0.1), meter.raise(2 ** 33));
