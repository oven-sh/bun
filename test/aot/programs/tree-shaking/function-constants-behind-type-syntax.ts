// The initializer of each constant is a function wrapped in syntax that leaves no trace at run time, and each reference is wrapped too.
type Fn = () => string;
const viaAs = function () { return "as"; } as Fn;
const viaSatisfies = (() => "satisfies") satisfies Fn;
const viaAngle = <Fn>function () { return "angle"; };
const viaNonNull = (() => "non-null")!;
const viaParentheses = ((() => "parentheses"));
const viaAnnotation: Fn = () => "annotation";
const viaAsConst = (() => "as const") as Fn as unknown as Fn;
const generic = <T,>(value: T): T => value;
const asyncArrow = async () => "async arrow";
const generator = function* () { yield "generator"; };

console.log((viaAs as Fn)(), viaSatisfies!(), (<Fn>viaAngle)(), (viaNonNull satisfies Fn)(), ((viaParentheses))());
console.log(viaAnnotation(), viaAsConst(), generic<string>("generic"), await asyncArrow(), [...generator()][0]);
