//@ requireOptions("--useDollarVM=1")
// JSTests/stress/debugger-scope-property-caches.js of oven-sh/WebKit.
var createBuiltin = $vm.createBuiltin;

function shouldBe(actual, expected, what) {
    if (actual !== expected)
        throw new Error(what + ': expected ' + String(expected) + ' but got ' + String(actual));
}

// A DebuggerScope is the object that the inspector gives for a scope of a paused call frame. It answers for the
// properties of the scope behind it, and every scope object of a realm has one structure. So that structure says
// neither where a property is nor that there is none.

var hasOwn = Object.prototype.hasOwnProperty;
var globalScope = $vm.createDebuggerScope();
var functionInWith;
with ({ onlyInWith: 1, goesFromWith: 1 }) {
    functionInWith = function () { };
}
var withScope = $vm.createDebuggerScope(functionInWith);

// A hit: the global object holds the property, at an offset of its own structure.
(function () {
    var direct = createBuiltin(`(function (o) {
        return @getByIdDirect(o, "hit");
    })`);
    function read(o) { return o.hit; }
    function has(o) { return "hit" in o; }
    noInline(direct);
    noInline(read);
    noInline(has);

    globalThis.hit = 42;
    shouldBe(direct(globalScope), 42, 'own read, first');
    shouldBe(direct(globalScope), 42, 'own read, second');
    for (var i = 0; i < testLoopCount; ++i) {
        shouldBe(direct(globalScope), 42, 'own read');
        shouldBe(read(globalScope), 42, 'read');
        shouldBe(has(globalScope), true, 'in');
    }
    globalThis.hit = 43;
    shouldBe(direct(globalScope), 43, 'own read after a store');
    shouldBe(read(globalScope), 43, 'read after a store');
}());

// A miss, and then the scope gains the property.
(function () {
    var direct = createBuiltin(`(function (o) {
        return @getByIdDirect(o, "later1");
    })`);
    function read(o) { return o.later2; }
    function has(o) { return "later3" in o; }
    noInline(direct);
    noInline(read);
    noInline(has);

    for (var i = 0; i < testLoopCount; ++i) {
        shouldBe(direct(globalScope), undefined, 'own read of a missing property');
        shouldBe(read(globalScope), undefined, 'read of a missing property');
        shouldBe(has(globalScope), false, 'in of a missing property');
        shouldBe(hasOwn.call(globalScope, 'later4'), false, 'hasOwnProperty of a missing property');
    }
    globalThis.later1 = 1;
    globalThis.later2 = 2;
    globalThis.later3 = 3;
    globalThis.later4 = 4;
    shouldBe(direct(globalScope), 1, 'own read after the definition');
    shouldBe(read(globalScope), 2, 'read after the definition');
    shouldBe(has(globalScope), true, 'in after the definition');
    shouldBe(hasOwn.call(globalScope, 'later4'), true, 'hasOwnProperty after the definition');
}());

// Two scope objects with one structure. Only the scope of the with statement holds the property.
(function () {
    var direct = createBuiltin(`(function (o) {
        return @getByIdDirect(o, "onlyInWith");
    })`);
    function read(o) { return o.onlyInWith; }
    noInline(direct);
    noInline(read);

    shouldBe(direct(withScope), 1, 'own read of the with scope, first');
    shouldBe(direct(withScope), 1, 'own read of the with scope, second');
    shouldBe(direct(globalScope), undefined, 'own read of the global scope');
    for (var i = 0; i < testLoopCount; ++i) {
        shouldBe(direct(withScope), 1, 'own read of the with scope');
        shouldBe(direct(globalScope), undefined, 'own read of the global scope');
        shouldBe(read(withScope), 1, 'read of the with scope');
        shouldBe(read(globalScope), undefined, 'read of the global scope');
        shouldBe(hasOwn.call(withScope, 'onlyInWith'), true, 'hasOwnProperty of the with scope');
        shouldBe(hasOwn.call(globalScope, 'onlyInWith'), false, 'hasOwnProperty of the global scope');
    }
}());

// A delete, after the function that deletes was compiled for a scope that has no such property.
(function () {
    function remove(o) { return delete o.goesFromWith; }
    noInline(remove);

    for (var i = 0; i < testLoopCount; ++i)
        shouldBe(remove(globalScope), true, 'delete of a missing property');
    shouldBe(hasOwn.call(withScope, 'goesFromWith'), true, 'before the delete');
    shouldBe(remove(withScope), true, 'delete');
    shouldBe(hasOwn.call(withScope, 'goesFromWith'), false, 'after the delete');
}());

// A getter of the global object.
(function () {
    var direct = createBuiltin(`(function (o) {
        return @getByIdDirect(o, "computed");
    })`);
    noInline(direct);

    var calls = 0;
    Object.defineProperty(globalThis, 'computed', { get() { calls++; return 9; }, configurable: true });
    for (var i = 0; i < testLoopCount; ++i)
        shouldBe(direct(globalScope), 9, 'getter');
    shouldBe(calls, testLoopCount, 'calls of the getter');
}());

// The object of a with statement inherits the property.
(function () {
    var direct = createBuiltin(`(function (o) {
        return @getByIdDirect(o, "inherited");
    })`);
    noInline(direct);

    var prototype = { inherited: 7 };
    var inner;
    with (Object.create(prototype)) {
        inner = function () { };
    }
    var scope = $vm.createDebuggerScope(inner);
    for (var i = 0; i < testLoopCount; ++i)
        shouldBe(direct(scope), 7, 'inherited');
    prototype.inherited = 8;
    shouldBe(direct(scope), 8, 'inherited after a store');
}());

// A store goes to the scope.
(function () {
    function store(o, value) { o.stored = value; }
    noInline(store);

    for (var i = 0; i < testLoopCount; ++i) {
        store(globalScope, i);
        shouldBe(globalThis.stored, i, 'store');
    }
}());

// A scope object as a prototype: a miss through it, and then the scope gains the property.
(function () {
    function read(o) { return o.laterThroughPrototype; }
    noInline(read);

    var heir = Object.create(globalScope);
    for (var i = 0; i < testLoopCount; ++i)
        shouldBe(read(heir), undefined, 'read through the prototype');
    globalThis.laterThroughPrototype = 1;
    shouldBe(read(heir), 1, 'read through the prototype after the definition');
}());

// The scope may hold a property named then: a promise that is resolved with the scope object asks for it.
(function () {
    var reads = 0;
    Object.defineProperty(globalThis, 'then', { get() { reads++; return undefined; }, configurable: true });
    Promise.resolve(globalScope);
    delete globalThis.then;
    shouldBe(reads, 1, 'reads of then');
}());
