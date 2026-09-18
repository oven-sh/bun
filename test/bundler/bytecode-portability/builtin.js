(function (exports, require, module, arg) {
  "use strict";
  // Corpus for bundler_bytecode_portable.test.ts in JavaScriptCore *builtin* syntax (@-intrinsics, private names,
  // link-time constants): the shapes Bun's internal modules (node:*, bun:*) are written in, which `bun build --compile
  // --bytecode` also embeds bytecode for. Only ever compiled (through bun:internal-for-testing's internalModuleBytecode),
  // never run; it is a single function expression, as every builtin is.
  // Opcodes only intrinsics emit.
  var count = @argumentCount();
  var second = @argument(1);
  var callable = @isCallable(arg) ? 1 : 0;
  var ctor = @isConstructor(arg) ? 1 : 0;
  var obj = @toObject(arg, "builtin corpus: not an object");
  var num = @toNumber(second) + @toString(module).length;
  var key = @toPropertyKey(second);
  var self = @toThis(this);
  var arr = @newArrayWithSize(4);
  @putByValDirect(arr, 0, count);
  @putByValDirect(arr, 1, second);
  @arrayPush(arr, key);
  var kinds = [@isObject(obj), @isJSArray(arr), @isProxyObject(obj), @isDerivedArray(arr), @isPromise(obj), @isRegExpObject(obj), @isMap(obj), @isSet(obj), @isUndefinedOrNull(second), @isGenerator(obj), @isArrayIterator(obj), @isShadowRealm(obj)];
  var proto = @getPrototypeOf(obj);
  var direct = @getByIdDirect(obj, "length");
  @putByIdDirect(obj, "then", count);
  var withThis = @getByValWithThis(obj, self, key);
  @putByValWithThisStrict(obj, self, key, num);
  var profiled = @idWithProfile(num, "SpecInt32Only");
  // Promise machinery: internal fields and the link-time @Promise constructor.
  var promise = @newPromise();
  var created = @createPromise(@Promise);
  var flags = @getInternalField(promise, 0);
  @putInternalField(promise, 1, arr);
  var linkTime = [@Promise, @Object, @Array, @String, @Number, @Map, @Set, @RegExp, @undefined, @promiseResolve];
  @superSamplerBegin();
  @superSamplerEnd();
  // Generators / iterators.
  function* gen() { yield count; }
  var g = gen();
  var frame = @isGenerator(g) ? @getGeneratorInternalField(g, @generatorFieldState) : -1;
  var iterated = 0;
  for (var v of arr) iterated += @isObject(v) ? 1 : 0;
  // Private-name property access on ordinary objects and link-time constant lookups.
  var holder = { @then: 1, @resolve: 2, regular: 3 };
  holder.@then = holder.@then + holder.@resolve;
  @putByIdDirectPrivate(holder, "reject", 4);
  var viaPrivate = @getByIdDirectPrivate(holder, "reject") + @Object.@hasOwn.length;
  var applied = arg.@call(holder, 1) + arg.@apply(holder, arr);
  // Errors builtins throw.
  if (count > 99) @throwTypeError("builtin corpus: too many arguments");
  if (count < -1) @throwRangeError("builtin corpus: negative");
  // Nested functions of each kind, so the executable records carry the builtin flags too.
  var arrow = (x) => @isCallable(x);
  async function asyncFn(p) { return await p; }
  async function* asyncGen() { yield 1; }
  class K { #p = 1; static s = 2; m() { return this.#p + @argumentCount(); } }
  return [count, second, callable, ctor, num, key, self, arr, kinds, proto, direct, withThis, profiled, created, flags, linkTime, frame, iterated, holder, viaPrivate, applied, arrow, asyncFn, asyncGen, K];
})
