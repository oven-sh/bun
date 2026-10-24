// Default exports that have no binding to refer to: a function, a class, an arrow function, an async generator and a parenthesized function expression. Each calls a helper that nothing else names.
import anonymousFunction from "./function";
import AnonymousClass from "./class";
import arrow from "./arrow";
import generator from "./generator";
import expression from "./expression";
import * as viaNamespace from "./function";

console.log(anonymousFunction());
console.log(new AnonymousClass().method(), AnonymousClass.name);
console.log(arrow(), arrow.name);
for await (const value of generator()) console.log(value);
console.log(expression(), expression.name);
console.log(viaNamespace.default === anonymousFunction);
