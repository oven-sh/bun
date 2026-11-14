import { describe, expect, test } from "bun:test";

// Coverage for the WebKit f59345e04a sync. Each case pins an observable difference between
// the old and the new JavaScriptCore. The sources go through `new Function`, so that Bun's
// transpiler leaves them alone and they are sloppy mode code.

describe.concurrent("WebKit f59345e04a upgrade", () => {
  test("a destructuring declaration in the head of a `for` statement needs an initializer (926bafc4e2)", () => {
    const sources = [
      "for (const [z]; ;) break;",
      "for (let [z]; ;) break;",
      "for (var [z]; ;) break;",
      "for (const {z}; ;) break;",
      "for (let {z}; ;) break;",
      "for (var {z}; ;) break;",
      "for (let x = 0, []; ;) break;",
      "for (let x, [a]; ;) break;",
      "for (let [a], b = 1; ;) break;",
      "for (let [a] = [], {b}; ;) break;",
    ];
    for (const source of sources) expect(() => new Function(source), source).toThrow(SyntaxError);

    const run = new Function(`
      const seen = [];
      for (let [a] = [1]; ;) { seen.push(a); break; }
      for (var [b] = [2], c = 3, {d} = { d: 4 }; ;) { seen.push(b + c + d); break; }
      for (let [e] of [[5]]) seen.push(e);
      for (const {length} in { abc: 1 }) seen.push(length);
      return seen;
    `);
    expect(run()).toEqual([1, 9, 5, 3]);
  });

  test("`let` is an identifier in the head of a sloppy `for` statement (926bafc4e2)", () => {
    const run = new Function(`
      var let, count = 0;
      const seen = [];
      for (let in { key: 1 }) ;
      seen.push(let);
      for (let
      in { other: 1 }) ;
      seen.push(let);
      for (let = 3; ;) break;
      seen.push(let);
      for (let; count < 2; ++count) ;
      seen.push(count);
      for (let++; ;) break;
      seen.push(let);
      for (let, count = 5; ;) break;
      seen.push(count);
      let = {};
      for (let.x in { key: 1 }) ;
      for (let.y = 6; ;) break;
      for (let?.z; ;) break;
      seen.push(let.x, let.y);
      let = () => seen;
      for (let().last in { key: 1 }) ;
      for (let(); ;) break;
      seen.push(seen.last);
      return seen;
    `);
    expect([...run()]).toEqual(["key", "other", 3, 2, 4, 5, "key", 6, "key"]);

    // What has to stay an error.
    expect(() => new Function("var let; for (let of [1]) ;")).toThrow(SyntaxError);
    expect(() => new Function("'use strict'; for (let in {}) ;")).toThrow(SyntaxError);
  });

  test("`for await (async of` is allowed (926bafc4e2)", async () => {
    const run = new Function(`
      return (async function () {
        var async;
        const seen = [];
        for await (async of [1, 2]) seen.push(async);
        return seen;
      })();
    `);
    expect(await run()).toEqual([1, 2]);

    // Without `await` it would be the start of an arrow function.
    expect(() => new Function("var async; for (async of [1]) ;")).toThrow(SyntaxError);
  });

  test("an overwritten `length` of a sloppy arguments object is converted with ToLength (7b1cfc54c8)", () => {
    const run = new Function(
      "create",
      "length",
      `
      function direct(length) { arguments.length = length; return arguments; }
      function scoped(length) { (function () { return length; })(); arguments.length = length; return arguments; }
      function count() { return arguments.length; }
      const make = () => ({ direct, scoped })[create](length, 2, 3);
      const attempt = callback => { try { return callback(); } catch (error) { return error.constructor.name; } };
      return {
        push: attempt(() => Array.prototype.push.call(make(), 4)),
        pop: attempt(() => { const args = make(); Array.prototype.pop.call(args); return args.length; }),
        slice: attempt(() => Array.prototype.slice.call(make(), 1, 3).join()),
        indexOf: attempt(() => Array.prototype.indexOf.call(make(), 3)),
        apply: attempt(() => count.apply(null, make())),
        reflectApply: attempt(() => Reflect.apply(count, null, make())),
      };
    `,
    );
    for (const create of ["direct", "scoped"]) {
      // These were 4294967295.
      for (const length of [-1, -1.5, "-1"]) {
        expect(run(create, length), `${create} ${length}`).toEqual({
          push: 1,
          pop: 0,
          slice: "",
          indexOf: -1,
          apply: 0,
          reflectApply: 0,
        });
      }
      // These were truncated to 32 bits.
      for (const [length, expected] of [
        [2 ** 32, 2 ** 32],
        [2 ** 32 + 1, 2 ** 32 + 1],
        [2 ** 53 + 2, 2 ** 53 - 1],
        [Infinity, 2 ** 53 - 1],
      ]) {
        expect(run(create, length), `${create} ${length}`).toEqual({
          push: expected === 2 ** 53 - 1 ? "TypeError" : expected + 1,
          pop: expected - 1,
          slice: "2,3",
          indexOf: 2,
          apply: "RangeError",
          reflectApply: "RangeError",
        });
      }
    }
  });

  test("a promise resolved with itself is rejected in optimized code too (b45f2446d8)", async () => {
    const run = new Function(`
      function resolveWithItself(i) {
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        Object.setPrototypeOf(promise, null);
        promise.foo = i;
        resolve(promise);
        return promise;
      }
      const settled = [];
      for (let i = 0; i < 10000; ++i) {
        settled.push(new Promise(done => {
          Promise.prototype.then.call(resolveWithItself(i), () => done("fulfilled"), error => done(error.constructor.name));
        }));
      }
      return Promise.all(settled);
    `);
    // The DFG turned the resolve into a fulfill, with the promise as its own value.
    expect(new Set(await run())).toEqual(new Set(["TypeError"]));
  });
});
