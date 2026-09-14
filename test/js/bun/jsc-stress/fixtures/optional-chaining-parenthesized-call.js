// @bun
// The parentheses in `(a?.b)()` end the optional chain, so the call is not part of it.
// A nullish `a` makes the callee undefined and the call throws a TypeError. A present `a` is the |this| of the call.

function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error(`expected ${String(expected)} but got ${String(actual)}`);
}

function shouldThrowTypeError(func, messagePrefix) {
    let error;
    let result;
    try {
        result = func();
    } catch (e) {
        error = e;
    }

    if (!(error instanceof TypeError))
        throw new Error(`Expected TypeError from ${func} but got ${error ? String(error) : `the value ${String(result)}`}`);

    if (messagePrefix !== undefined && !error.message.startsWith(messagePrefix))
        throw new Error(`TypeError from ${func} has wrong message: ${error.message}`);
}

function testNullishBase(nullish) {
    const key = 'a';

    shouldThrowTypeError(() => (nullish?.a)(), '(nullish?.a) is not a function');
    shouldThrowTypeError(() => (nullish?.['a'])(), '(nullish?.[\'a\']) is not a function');
    shouldThrowTypeError(() => (nullish?.[0])(), '(nullish?.[0]) is not a function');
    shouldThrowTypeError(() => (nullish?.[key])(), '(nullish?.[key]) is not a function');
    shouldThrowTypeError(() => ((nullish?.a))(), '((nullish?.a)) is not a function');
    shouldThrowTypeError(() => (((nullish?.[key])))(), '(((nullish?.[key]))) is not a function');

    // The chain short-circuits before its last link.
    shouldThrowTypeError(() => (nullish?.a.b)(), '(nullish?.a.b) is not a function');
    shouldThrowTypeError(() => (nullish?.a.b.c)(), '(nullish?.a.b.c) is not a function');
    shouldThrowTypeError(() => (nullish?.a[key])(), '(nullish?.a[key]) is not a function');
    shouldThrowTypeError(() => (nullish?.[key].a)(), '(nullish?.[key].a) is not a function');
    shouldThrowTypeError(() => (nullish?.[key][key])(), '(nullish?.[key][key]) is not a function');
    shouldThrowTypeError(() => (nullish?.a?.b)(), '(nullish?.a?.b) is not a function');
    shouldThrowTypeError(() => (nullish?.a?.[key])(), '(nullish?.a?.[key]) is not a function');
    shouldThrowTypeError(() => (nullish?.a().b)(), '(nullish?.a().b) is not a function');
    shouldThrowTypeError(() => (nullish?.().a)(), '(nullish?.().a) is not a function');

    // These names get a special call node when the callee is not a parenthesized chain.
    shouldThrowTypeError(() => (nullish?.call)({}), '(nullish?.call) is not a function');
    shouldThrowTypeError(() => (nullish?.apply)({}, []), '(nullish?.apply) is not a function');
    shouldThrowTypeError(() => (nullish?.hasOwnProperty)(key), '(nullish?.hasOwnProperty) is not a function');
    shouldThrowTypeError(() => (nullish?.a.call)({}), '(nullish?.a.call) is not a function');
    shouldThrowTypeError(() => (nullish?.a.apply)({}, []), '(nullish?.a.apply) is not a function');

    // A link in the middle is nullish.
    const holder = { a: nullish, b: { c: nullish } };
    shouldThrowTypeError(() => (holder.a?.b)(), '(holder.a?.b) is not a function');
    shouldThrowTypeError(() => (holder?.a?.b)(), '(holder?.a?.b) is not a function');
    shouldThrowTypeError(() => (holder?.b.c?.d)(), '(holder?.b.c?.d) is not a function');
    shouldThrowTypeError(() => (holder?.b.c?.[key].d)(), '(holder?.b.c?.[key].d) is not a function');
    shouldThrowTypeError(() => (holder?.a.b)(), `${nullish} is not an object`);

    // The call can be anywhere an expression can.
    shouldThrowTypeError(() => { if ((nullish?.a)()) throw new Error('unreachable'); });
    shouldThrowTypeError(() => (nullish?.a)() ? 1 : 2);
    shouldThrowTypeError(() => (nullish?.a)() ?? 1);
    shouldThrowTypeError(() => (nullish?.a)() || 1);
    shouldThrowTypeError(() => (nullish?.a)() && 1);
    shouldThrowTypeError(() => !(nullish?.a)());
    shouldThrowTypeError(() => typeof (nullish?.a)());
    shouldThrowTypeError(() => void (nullish?.a)());
    shouldThrowTypeError(() => delete (nullish?.a)());
    shouldThrowTypeError(() => (nullish?.a)().b);
    shouldThrowTypeError(() => (nullish?.a)()?.b);
    shouldThrowTypeError(() => (nullish?.a)()());
    shouldThrowTypeError(() => (nullish?.a)()?.());
    shouldThrowTypeError(() => [(nullish?.a)()]);
    shouldThrowTypeError(() => ({ x: (nullish?.[key])() }));
    shouldThrowTypeError(() => `${(nullish?.a)()}`);
    shouldThrowTypeError(() => { for (const x of (nullish?.a)()); });
    shouldThrowTypeError(() => { 'use strict'; return (nullish?.a)(); });
    shouldThrowTypeError(() => { 'use strict'; return (nullish?.[key])(); });

    // These are still one chain each, so the call short-circuits as well.
    shouldBe(nullish?.a(), undefined);
    shouldBe(nullish?.[key](), undefined);
    shouldBe(nullish?.a.b(), undefined);
    shouldBe(nullish?.a?.(), undefined);
    shouldBe((nullish?.a)?.(), undefined);
    shouldBe((nullish?.[key])?.(), undefined);
    shouldBe((nullish?.a.b)?.(), undefined);
    shouldBe(((nullish?.a))?.(), undefined);
    shouldBe((nullish?.a)?.().b.c, undefined);
}
noInline(testNullishBase);

function shouldThrowTypeErrorWithEither(func, ...messagePrefixes) {
    let error;
    try {
        func();
    } catch (e) {
        error = e;
    }
    if (!(error instanceof TypeError) || !messagePrefixes.some((prefix) => error.message.startsWith(prefix)))
        throw new Error(`Expected a TypeError starting with one of ${messagePrefixes} from ${func} but got ${error}`);
}

function testThisValue() {
    const symbol = Symbol('s');
    const o = {
        f() { return this; },
        0() { return this; },
        [symbol]() { return this; },
        inner: { g() { return this; }, deeper: { h() { return this; } } },
        make() { return this.inner; },
    };
    const key = 'f';

    shouldBe((o?.f)(), o);
    shouldBe((o?.['f'])(), o);
    shouldBe((o?.[key])(), o);
    shouldBe((o?.[0])(), o);
    shouldBe((o?.[symbol])(), o);
    shouldBe(((o?.f))(), o);
    shouldBe((((o?.[key])))(), o);
    shouldBe((o?.inner.g)(), o.inner);
    shouldBe((o?.inner?.g)(), o.inner);
    shouldBe((o.inner?.g)(), o.inner);
    shouldBe((o?.inner['g'])(), o.inner);
    shouldBe((o?.['inner'].g)(), o.inner);
    shouldBe((o?.inner.deeper.h)(), o.inner.deeper);
    shouldBe((o?.inner?.deeper?.h)(), o.inner.deeper);
    shouldBe((o?.make().g)(), o.inner);
    shouldBe((o?.make?.().g)(), o.inner);

    // The result of the call is an ordinary value.
    shouldBe((o?.f)().inner, o.inner);
    shouldBe((o?.f)()?.inner, o.inner);
    shouldBe((o?.f)().f(), o);
    shouldBe((o?.make)().g(), o.inner);
    shouldBe((o?.make)()?.nothing?.g(), undefined);
    shouldBe((o?.f)() ?? 1, o);
    shouldBe((o?.f)() ? 1 : 2, 1);
    shouldBe(typeof (o?.f)(), 'object');
    shouldBe(delete (o?.f)(), true);

    // A primitive base is the |this| of a strict function as it is.
    const strict = function () { 'use strict'; return this; };
    String.prototype.strictThis = strict;
    Number.prototype.strictThis = strict;
    try {
        shouldBe(('str'?.strictThis)(), 'str');
        shouldBe((5?.strictThis)(), 5);
        shouldBe((0?.['strictThis'])(), 0);
        shouldBe((''?.strictThis)(), '');
        shouldBe((false?.valueOf)(), false);
    } finally {
        delete String.prototype.strictThis;
        delete Number.prototype.strictThis;
    }

    // The base and the callee are evaluated once, before the arguments.
    const log = [];
    const observed = {
        get f() { log.push('get f'); return function (...args) { log.push(`call ${args}`); return this; }; },
    };
    function base() { log.push('base'); return observed; }
    function name() { log.push('key'); return 'f'; }
    function argument(x) { log.push(`arg ${x}`); return x; }
    shouldBe((base()?.f)(argument(1), argument(2)), observed);
    shouldBe(log.join(), 'base,get f,arg 1,arg 2,call 1,2');
    log.length = 0;
    shouldBe((base()?.[name()])(argument(1)), observed);
    shouldBe(log.join(), 'base,key,get f,arg 1,call 1');

    // Arguments that assign to the base or the key do not change the callee or |this|.
    let a = o;
    shouldBe((a?.f)(a = null), o);
    shouldBe(a, null);
    let b = o;
    let k = 'f';
    shouldBe((b?.[k])(b = undefined, k = 'inner'), o);
    shouldBe(b, undefined);
    shouldBe(k, 'inner');

    // A present base with a callee that is not callable.
    shouldThrowTypeError(() => (o?.missing)(), '(o?.missing) is not a function');
    shouldThrowTypeError(() => (o?.[key + key])(), '(o?.[key + key]) is not a function');
    shouldThrowTypeError(() => (o?.inner)(), '(o?.inner) is not a function');
    shouldThrowTypeError(() => (o?.inner.missing)(), '(o?.inner.missing) is not a function');
    shouldThrowTypeErrorWithEither(() => (o?.missing.g)(), 'undefined is not an object');
}
noInline(testThisValue);

function testArgumentsAreEvaluatedBeforeTheThrow(nullish) {
    const log = [];
    function argument(x) { log.push(`arg ${x}`); return x; }
    function name() { log.push('key'); return 'a'; }

    shouldThrowTypeError(() => (nullish?.a)(argument(1), argument(2)));
    shouldBe(log.join(), 'arg 1,arg 2');
    log.length = 0;

    // The rest of the chain is skipped, the arguments are not.
    shouldThrowTypeError(() => (nullish?.[name()])(argument(1)));
    shouldBe(log.join(), 'arg 1');
    log.length = 0;

    shouldThrowTypeError(() => (nullish?.[name()][name()].a)(...[argument(1), argument(2)]));
    shouldBe(log.join(), 'arg 1,arg 2');
    log.length = 0;

    shouldThrowTypeError(() => (nullish?.a)((nullish?.b)(argument(1)), argument(2)));
    shouldBe(log.join(), 'arg 1');
    log.length = 0;

    // An argument that throws wins over the TypeError of the call.
    let error;
    try {
        (nullish?.a)(argument(1), (() => { throw new RangeError('argument'); })(), argument(3));
    } catch (e) {
        error = e;
    }
    shouldBe(error instanceof RangeError, true);
    shouldBe(log.join(), 'arg 1');
}
noInline(testArgumentsAreEvaluatedBeforeTheThrow);

function testCallApplyHasOwnProperty() {
    function greet(name) { return `hey, ${name}${this?.suffix ?? '.'}`; }
    const holder = { greet, own: 1 };

    shouldBe((greet?.call)({ suffix: '!' }, 'world'), 'hey, world!');
    shouldBe((greet?.apply)({ suffix: '?' }, ['world']), 'hey, world?');
    shouldBe((greet?.call)(), 'hey, undefined.');
    shouldBe((greet?.apply)(), 'hey, undefined.');
    shouldBe((holder?.greet.call)({ suffix: '!' }, 'world'), 'hey, world!');
    shouldBe((holder?.greet.apply)({ suffix: '?' }, ['world']), 'hey, world?');
    shouldBe((holder?.greet?.call)({ suffix: '!' }, ...['world']), 'hey, world!');
    shouldBe((holder.greet?.apply)({ suffix: '?' }, [...['world']]), 'hey, world?');
    shouldBe((greet?.call.call.call)(greet, { suffix: '!' }, 'world'), 'hey, world!');

    shouldBe((holder?.hasOwnProperty)('own'), true);
    shouldBe((holder?.hasOwnProperty)('greet'), true);
    shouldBe((holder?.hasOwnProperty)('hasOwnProperty'), false);
    let count = 0;
    for (const property in holder) {
        shouldBe((holder?.hasOwnProperty)(property), true);
        count++;
    }
    shouldBe(count, 2);

    // A `call` that is not Function.prototype.call.
    const fake = { call() { return this; }, apply() { return this; } };
    shouldBe((fake?.call)(1), fake);
    shouldBe((fake?.apply)(1, [2]), fake);
}
noInline(testCallApplyHasOwnProperty);

function testLocalsAreNotClobbered(o, k) {
    // The short-circuit writes undefined to the callee and to |this|, not to the registers of `o` and `k`.
    let threw = 0;
    try {
        (o?.f)();
    } catch (e) {
        if (e instanceof TypeError)
            threw++;
    }
    try {
        (o?.[k])();
    } catch (e) {
        if (e instanceof TypeError)
            threw++;
    }
    try {
        (o?.[k].f)(o, k);
    } catch (e) {
        if (e instanceof TypeError)
            threw++;
    }
    shouldBe(threw, 3);
    return [o, k];
}
noInline(testLocalsAreNotClobbered);

class Privates {
    #method() { return this; }
    #field = function () { return this; };
    get #getter() { return function () { return this; }; }
    static #staticMethod() { return this; }
    inner = { owner: this };

    static method(o) { return (o?.#method)(); }
    static field(o) { return (o?.#field)(); }
    static getter(o) { return (o?.#getter)(); }
    static staticMethod(o) { return (o?.#staticMethod)(); }
    static nested(o) { return (o?.inner.owner.#method)(); }
    static nestedOptional(o) { return (o?.inner?.owner?.#field)(); }
}

function testPrivateNames(nullish) {
    const instance = new Privates;
    shouldBe(Privates.method(instance), instance);
    shouldBe(Privates.field(instance), instance);
    shouldBe(Privates.getter(instance), instance);
    shouldBe(Privates.staticMethod(Privates), Privates);
    shouldBe(Privates.nested(instance), instance);
    shouldBe(Privates.nestedOptional(instance), instance);

    shouldThrowTypeError(() => Privates.method(nullish), '(o?.#method) is not a function');
    shouldThrowTypeError(() => Privates.field(nullish), '(o?.#field) is not a function');
    shouldThrowTypeError(() => Privates.getter(nullish), '(o?.#getter) is not a function');
    shouldThrowTypeError(() => Privates.staticMethod(nullish), '(o?.#staticMethod) is not a function');
    shouldThrowTypeError(() => Privates.nested(nullish), '(o?.inner.owner.#method) is not a function');
    shouldThrowTypeError(() => Privates.nestedOptional(nullish), '(o?.inner?.owner?.#field) is not a function');

    // A present base without the private name still fails the brand check.
    shouldThrowTypeError(() => Privates.method({}));
    shouldThrowTypeError(() => Privates.field({}));
}
noInline(testPrivateNames);

class Base {
    who() { return this; }
}
class Derived extends Base {
    viaSuper() { return (super.who?.call)(this); }
    viaSuperMember(o) { return (super.who?.name.toString)(); }
    viaThis() { return (this?.who)(); }
    static viaNewTarget() { return (new.target?.x)(); }
}

function testOtherContexts(nullish) {
    const o = { f() { return this; } };

    const derived = new Derived;
    shouldBe(derived.viaSuper(), derived);
    shouldBe(derived.viaSuperMember(), 'who');
    shouldBe(derived.viaThis(), derived);
    shouldThrowTypeError(() => Derived.viaNewTarget(), '(new.target?.x) is not a function');

    // Tail calls.
    const strictTail = function (x) { 'use strict'; return (x?.f)(); };
    const strictTailBracket = function (x, key) { 'use strict'; return (x?.[key])(); };
    shouldBe(strictTail(o), o);
    shouldBe(strictTailBracket(o, 'f'), o);
    shouldThrowTypeError(() => strictTail(nullish), '(x?.f) is not a function');
    shouldThrowTypeError(() => strictTailBracket(nullish, 'f'), '(x?.[key]) is not a function');

    // Arrow functions, generators, async functions, eval and the Function constructor.
    shouldBe(((x) => (x?.f)())(o), o);
    shouldThrowTypeError(() => ((x) => (x?.f)())(nullish));
    function* generator(x) { yield (x?.f)(); yield (x?.['f'])(yield 1); }
    shouldBe(generator(o).next().value, o);
    shouldThrowTypeError(() => generator(nullish).next());
    const yielding = generator(o);
    yielding.next();
    shouldBe(yielding.next().value, 1);
    shouldBe(yielding.next().value, o);
    shouldBe(eval('(o?.f)()'), o);
    shouldThrowTypeError(() => eval('(nullish?.f)()'), '(nullish?.f) is not a function');
    shouldBe(new Function('x', 'return (x?.f)()')(o), o);
    shouldThrowTypeError(() => new Function('x', 'return (x?.f)()')(nullish), '(x?.f) is not a function');
    shouldThrowTypeError(() => new Function('x', 'return (x?.[0])()')(nullish), '(x?.[0]) is not a function');

    // `new` and tagged templates are not calls of this kind.
    shouldThrowTypeError(() => new (nullish?.f)(), 'undefined is not a constructor');
    shouldThrowTypeError(() => new (nullish?.f), 'undefined is not a constructor');
    const withClass = { C: class { constructor() { this.made = true; } } };
    shouldBe(new (withClass?.C)().made, true);
    shouldThrowTypeError(() => (nullish?.f)``);
    shouldThrowTypeError(() => (0, nullish?.f)(), '(0, nullish?.f) is not a function');
    shouldThrowTypeError(() => (nullish?.f).g(), 'undefined is not an object');

    // The parenthesized chain as an argument or a base of another call.
    shouldBe((o?.f)((o?.f)()), o);
    shouldThrowTypeError(() => (o?.f)((nullish?.f)()), '(nullish?.f) is not a function');
    shouldBe((o?.f)().f?.(), o);
    shouldBe(((o?.f)()?.f)(), o);
    shouldThrowTypeError(() => ((o?.f)()?.g?.h)(), '((o?.f)()?.g?.h) is not a function');
}
noInline(testOtherContexts);

function testClassFields(nullish) {
    // A field initializer is parsed again from the position of its node, so the node of the call has to start
    // at the opening parenthesis. It used to start at `o`, and the second parse stopped at the closing parenthesis:
    // the field got the function and nothing called it.
    const o = { f() { return this; }, inner: { g() { return this; } } };
    const key = 'f';
    class Fields {
        dot = (o?.f)();
        bracket = (o?.[key])();
        doubled = ((o?.f))();
        longer = (o?.inner.g)();
        withArguments = (o?.f)(1, 2).inner;
        ['computed'] = (o?.f)();
        #private = (o?.f)();
        static staticDot = (o?.f)();
        static staticBracket = (o?.['f'])();
        static #staticPrivate = (o?.inner?.g)();
        optionalCall = (o?.f)?.();
        shortCircuit = (nullish?.f)?.();
        get private() { return this.#private; }
        static get staticPrivate() { return Fields.#staticPrivate; }
    }
    const fields = new Fields;
    shouldBe(fields.dot, o);
    shouldBe(fields.bracket, o);
    shouldBe(fields.doubled, o);
    shouldBe(fields.longer, o.inner);
    shouldBe(fields.withArguments, o.inner);
    shouldBe(fields.computed, o);
    shouldBe(fields.private, o);
    shouldBe(Fields.staticDot, o);
    shouldBe(Fields.staticBracket, o);
    shouldBe(Fields.staticPrivate, o.inner);
    shouldBe(fields.optionalCall, o);
    shouldBe(fields.shortCircuit, undefined);

    shouldThrowTypeError(() => new (class { field = (nullish?.f)(); }), '(nullish?.f) is not a function');
    shouldThrowTypeError(() => new (class { field = (nullish?.[key])(); }), '(nullish?.[key]) is not a function');
    shouldThrowTypeError(() => class { static field = (nullish?.f.g)(); }, '(nullish?.f.g) is not a function');
}
noInline(testClassFields);

async function testAsync(nullish) {
    const o = { async f() { return this; } };
    shouldBe(await (o?.f)(), o);
    shouldBe(await (o?.['f'])(await 1), o);
    let error;
    try {
        await (nullish?.f)(await 1);
    } catch (e) {
        error = e;
    }
    shouldBe(error instanceof TypeError, true);
}

function hotDot(o) {
    return (o?.f)();
}
noInline(hotDot);

function hotBracket(o, key) {
    return (o?.[key])();
}
noInline(hotBracket);

function hotNested(o) {
    return (o?.inner.f)(1, 2);
}
noInline(hotNested);

function hotCatch(o) {
    try {
        return (o?.inner?.f)();
    } catch (e) {
        return e instanceof TypeError ? 'TypeError' : 'other';
    }
}
noInline(hotCatch);

for (let i = 0; i < 100; i++) {
    testNullishBase(undefined);
    testNullishBase(null);
    testThisValue();
    testArgumentsAreEvaluatedBeforeTheThrow(undefined);
    testArgumentsAreEvaluatedBeforeTheThrow(null);
    testCallApplyHasOwnProperty();
    testPrivateNames(undefined);
    testPrivateNames(null);
    testOtherContexts(undefined);
    testOtherContexts(null);
    testClassFields(undefined);
    testClassFields(null);

    const o = {};
    for (const nullish of [undefined, null]) {
        const [first, second] = testLocalsAreNotClobbered(nullish, 'f');
        shouldBe(first, nullish);
        shouldBe(second, 'f');
    }
    const [first, second] = testLocalsAreNotClobbered(o, 'f');
    shouldBe(first, o);
    shouldBe(second, 'f');
}

// Let the optimizing tiers see the present base first, then the short-circuit.
{
    const o = { f() { return this; }, inner: { f(a, b) { return a === undefined ? this : this === o.inner ? a + b : -1; } } };
    for (let i = 0; i < testLoopCount; i++) {
        shouldBe(hotDot(o), o);
        shouldBe(hotBracket(o, 'f'), o);
        shouldBe(hotNested(o), 3);
        shouldBe(hotCatch(o), o.inner);
    }
    for (let i = 0; i < testLoopCount; i++) {
        const nullish = i & 1 ? null : undefined;
        shouldThrowTypeError(() => hotDot(nullish), '(o?.f) is not a function');
        shouldThrowTypeError(() => hotBracket(nullish, 'f'), '(o?.[key]) is not a function');
        shouldThrowTypeError(() => hotNested(nullish), '(o?.inner.f) is not a function');
        shouldBe(hotCatch(nullish), 'TypeError');
        shouldBe(hotCatch({ inner: nullish }), 'TypeError');
        shouldBe(hotDot(o), o);
        shouldBe(hotCatch(o), o.inner);
    }
}

let asyncError;
let asyncDone = false;
Promise.all([testAsync(undefined), testAsync(null)]).then(() => { asyncDone = true; }, (e) => { asyncError = e; });
drainMicrotasks();
if (asyncError)
    throw asyncError;
shouldBe(asyncDone, true);
