// A symbol can only name a member whose name is computed. The engine asks objects for symbols all the time: Symbol.toStringTag, Symbol.toPrimitive, Symbol.iterator, Symbol.isConcatSpreadable. The prototype of a class without such members says no at once, however often it is asked, and need not make its members for that.
class Token { kind = "word"; text() { return this.kind; } length() { return 4; } }
class Keyword extends Token { kind = "keyword"; reserved() { return true; } }
const describe = Object.prototype.toString;
const token = new Token(), keyword = new Keyword();
let last = "";
for (let i = 0; i < 100; i++) last = describe.call(token) + describe.call(keyword);
let joined = 0;
for (let i = 0; i < 100; i++) joined += [].concat(token, keyword).length;
let tags = 0;
for (let i = 0; i < 100; i++) tags += token[Symbol.toStringTag] === undefined && keyword[Symbol.iterator] === undefined ? 1 : 0;
console.log(last, joined, tags);

// The symbol arrives, and a class that has one from the start.
Token.prototype[Symbol.toStringTag] = "Token";
console.log(describe.call(token), describe.call(keyword), token.text(), keyword.reserved());
Object.defineProperty(Keyword.prototype, Symbol.toStringTag, { get() { return "Keyword of " + this.kind; } });
console.log(describe.call(token), describe.call(keyword));
class Tagged { get [Symbol.toStringTag]() { return "Tagged"; } *[Symbol.iterator]() { yield 1; yield 2; } plain() { return 0; } }
console.log(describe.call(new Tagged()), [...new Tagged()].join(), new Tagged().plain());
class Heir extends Tagged { more() { return 1; } }
console.log(describe.call(new Heir()), [...new Heir()].join(), new Heir().more());
