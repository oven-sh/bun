// Namespace and constructor objects (Math, JSON, Object, Array ..) stay extensible in a compiled program: they take any ordinary name and any symbol of the program, and such a property is ordinary in every way. They keep the members and the prototype they have from the start, and refuse an index and a name that they inherit. Left open are the few members that real packages replace (JSON.parse and Date.now here), and Intl, Function, the error constructors, WeakRef and DataView as a whole.
/* expected
a1 1 true true poop
a2 2 3 4 {"value":4,"writable":true,"enumerable":true,"configurable":true}
a3 true false undefined 
a4 3 true
a5 unparsed1 true
a6 true true
a7 0,1,2 true
a8 1,true,true,0,function, true,true,true,true,true,true
a9 1,2,3,4,5,6,7,8,9 true,true,true,true,true,true,true,true,true
a10 true 6.25 TypeError true false
a11 true 42  true
a12 TypeError true
a13 true true 12 true true
a14 true one,two true 
a15 true false false true true true false false
b1 TypeError 2 TypeError function
b2 TypeError false false false 2
b3 TypeError false TypeError true
b4 TypeError TypeError false [object Math] false
b5 stored TypeError TypeError TypeError 0 k true
b6 TypeError TypeError TypeError TypeError true
Math set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
JSON set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=stored redefine=true Reflect.replace=true Reflect.redefine=true delete=true Reflect.delete=true shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define,replace,redefine,Reflect.replace,Reflect.redefine,delete,Reflect.delete
Reflect set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
Atomics set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
Intl set=1 index=1 symbol=1 define=1 defineIndex=1 defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=true Reflect.define=true Reflect.defineIndex=true ordinary=2/true/true/true/true/false replace=stored redefine=true Reflect.replace=true Reflect.redefine=true delete=true Reflect.delete=true shadow=stored defineShadow=true Reflect.shadow=true setPrototypeOf=true __proto__=stored Reflect.setPrototypeOf=true extensible=true frozen=false took=set,index,symbol,define,defineIndex,defineGetter,assign,Reflect.set,Reflect.setIndex,Reflect.define,Reflect.defineIndex,replace,redefine,Reflect.replace,Reflect.redefine,delete,Reflect.delete,shadow,defineShadow,Reflect.shadow,setPrototypeOf,__proto__,Reflect.setPrototypeOf
Object set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
Array set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
Function set=1 index=1 symbol=1 define=1 defineIndex=1 defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=true Reflect.define=true Reflect.defineIndex=true ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=stored defineShadow=true Reflect.shadow=true setPrototypeOf=true __proto__=stored Reflect.setPrototypeOf=true extensible=true frozen=false took=set,index,symbol,define,defineIndex,defineGetter,assign,Reflect.set,Reflect.setIndex,Reflect.define,Reflect.defineIndex,shadow,defineShadow,Reflect.shadow,setPrototypeOf,__proto__,Reflect.setPrototypeOf
String set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
Number set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
Boolean set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
Symbol set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
BigInt set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
Map set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
Set set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
WeakMap set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
WeakSet set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
WeakRef set=1 index=1 symbol=1 define=1 defineIndex=1 defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=true Reflect.define=true Reflect.defineIndex=true ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=stored defineShadow=true Reflect.shadow=true setPrototypeOf=true __proto__=stored Reflect.setPrototypeOf=true extensible=true frozen=false took=set,index,symbol,define,defineIndex,defineGetter,assign,Reflect.set,Reflect.setIndex,Reflect.define,Reflect.defineIndex,shadow,defineShadow,Reflect.shadow,setPrototypeOf,__proto__,Reflect.setPrototypeOf
Promise set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
RegExp set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
Date set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=stored redefine=true Reflect.replace=true Reflect.redefine=true delete=true Reflect.delete=true shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define,replace,redefine,Reflect.replace,Reflect.redefine,delete,Reflect.delete
Error set=1 index=1 symbol=1 define=1 defineIndex=1 defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=true Reflect.define=true Reflect.defineIndex=true ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=stored defineShadow=true Reflect.shadow=true setPrototypeOf=true __proto__=stored Reflect.setPrototypeOf=true extensible=true frozen=false took=set,index,symbol,define,defineIndex,defineGetter,assign,Reflect.set,Reflect.setIndex,Reflect.define,Reflect.defineIndex,shadow,defineShadow,Reflect.shadow,setPrototypeOf,__proto__,Reflect.setPrototypeOf
TypeError set=1 index=1 symbol=1 define=1 defineIndex=1 defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=true Reflect.define=true Reflect.defineIndex=true ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=stored defineShadow=true Reflect.shadow=true setPrototypeOf=true __proto__=stored Reflect.setPrototypeOf=true extensible=true frozen=false took=set,index,symbol,define,defineIndex,defineGetter,assign,Reflect.set,Reflect.setIndex,Reflect.define,Reflect.defineIndex,shadow,defineShadow,Reflect.shadow,setPrototypeOf,__proto__,Reflect.setPrototypeOf
ArrayBuffer set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
DataView set=1 index=1 symbol=1 define=1 defineIndex=1 defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=true Reflect.define=true Reflect.defineIndex=true ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=stored defineShadow=true Reflect.shadow=true setPrototypeOf=true __proto__=stored Reflect.setPrototypeOf=true extensible=true frozen=false took=set,index,symbol,define,defineIndex,defineGetter,assign,Reflect.set,Reflect.setIndex,Reflect.define,Reflect.defineIndex,shadow,defineShadow,Reflect.shadow,setPrototypeOf,__proto__,Reflect.setPrototypeOf
%TypedArray% set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
Uint8Array set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
Float64Array set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
Proxy set=1 index=TypeError symbol=1 define=1 defineIndex=TypeError defineGetter=replaced assign=1 Reflect.set=true Reflect.setIndex=false Reflect.define=true Reflect.defineIndex=false ordinary=2/true/true/true/true/false replace=TypeError redefine=TypeError Reflect.replace=false Reflect.redefine=false delete=TypeError Reflect.delete=false shadow=TypeError defineShadow=TypeError Reflect.shadow=false setPrototypeOf=TypeError __proto__=TypeError Reflect.setPrototypeOf=false extensible=true frozen=false took=set,symbol,define,defineGetter,assign,Reflect.set,Reflect.define
d1 0 0 0 0 undefined undefined false
d2 2 undefined 1 k true a true true 1 true 2 [object Math] string
*/
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
const mark = Symbol("mark")

// a. As programs write it: the receiver is named at the place of the attempt.
try { console.log("a1", attempt(() => { (Math as any).poop = 1; return (Math as any).poop }), "poop" in Math, Object.hasOwn(Math, "poop"), Object.keys(Math).join()) } catch (e) { console.log("line 60:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("a2", attempt(() => { (Math as any).poop = 2; return (Math as any).poop }), attempt(() => ++(Math as any).poop), attempt(() => (Math as any).poop += 1), JSON.stringify(Object.getOwnPropertyDescriptor(Math, "poop"))) } catch (e) { console.log("line 61:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("a3", attempt(() => delete (Math as any).poop), "poop" in Math, String((Math as any).poop), Object.keys(Math).join()) } catch (e) { console.log("line 62:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("a4", attempt(() => { (Math as any).clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v)); return (Math as any).clamp(5, 0, 3) }), attempt(() => delete (Math as any).clamp)) } catch (e) { console.log("line 63:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("a5", attempt(() => { (JSON as any).safeParse = (text: string) => { try { return JSON.parse(text) } catch { return "unparsed" } }; return (JSON as any).safeParse("{") + (JSON as any).safeParse("1") }), attempt(() => delete (JSON as any).safeParse)) } catch (e) { console.log("line 64:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("a6", attempt(() => { (Object as any).isObject = (v: unknown) => typeof v === "object" && v !== null; return (Object as any).isObject({}) }), attempt(() => delete (Object as any).isObject)) } catch (e) { console.log("line 65:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("a7", attempt(() => { (Array as any).range = (n: number) => Array.from({ length: n }, (_, i) => i); return (Array as any).range(3) }), attempt(() => delete (Array as any).range)) } catch (e) { console.log("line 66:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log("a8", attempt(() => { (Reflect as any).extra = 1; (Symbol as any).mine = mark; (Number as any).isOdd = (n: number) => n % 2 === 1; (String as any).empty = ""; (Function as any).noop = () => {}; (Boolean as any).maybe = null
  return [(Reflect as any).extra, (Symbol as any).mine === mark, (Number as any).isOdd(3), (String as any).empty.length, typeof (Function as any).noop, (Boolean as any).maybe].join() }),
  attempt(() => [delete (Reflect as any).extra, delete (Symbol as any).mine, delete (Number as any).isOdd, delete (String as any).empty, delete (Function as any).noop, delete (Boolean as any).maybe].join()))
console.log("a9", attempt(() => { (Promise as any).never = 1; (Map as any).of = 2; (Set as any).of = 3; (WeakMap as any).of = 4; (RegExp as any).any = 5; (Date as any).epoch = 6; (Error as any).codes = 7; (BigInt as any).zero = 8n; (Uint8Array as any).empty = 9
  return [(Promise as any).never, (Map as any).of, (Set as any).of, (WeakMap as any).of, (RegExp as any).any, (Date as any).epoch, (Error as any).codes, (BigInt as any).zero, (Uint8Array as any).empty].join() }),
  attempt(() => [delete (Promise as any).never, delete (Map as any).of, delete (Set as any).of, delete (WeakMap as any).of, delete (RegExp as any).any, delete (Date as any).epoch, delete (Error as any).codes, delete (BigInt as any).zero, delete (Uint8Array as any).empty].join()))
try { console.log("a10", attempt(() => Object.defineProperty(Math, "TAU", { value: 6.25, enumerable: true, configurable: true }) === Math), String((Math as any).TAU), attempt(() => { (Math as any).TAU = 1; return "stored" }), attempt(() => delete (Math as any).TAU), "TAU" in Math) } catch (e) { console.log("line 73:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("a11", attempt(() => Object.defineProperty(Math, "answer", { get: () => 42, configurable: true }) === Math), String((Math as any).answer), Object.keys(Math).join(), attempt(() => delete (Math as any).answer)) } catch (e) { console.log("line 74:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("a12", attempt(() => { (Math as any)[0] = "zero"; (Math as any)[mark] = "marked"; return (Math as any)[0] + (Math as any)[mark] + Reflect.ownKeys(Math).includes(mark) + Object.keys(Math) }), attempt(() => delete (Math as any)[0] && delete (Math as any)[mark])) } catch (e) { console.log("line 75:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("a13", Reflect.set(Math, "poop", 1), Reflect.defineProperty(Math, "pee", { value: 2, configurable: true }), String((Math as any).poop) + String((Math as any).pee), Reflect.deleteProperty(Math, "poop"), Reflect.deleteProperty(Math, "pee")) } catch (e) { console.log("line 76:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("a14", attempt(() => Object.assign(Math, { one: 1, two: 2 }) === Math), Object.keys(Math).join(), attempt(() => delete (Math as any).one && delete (Math as any).two), Object.keys(Math).join()) } catch (e) { console.log("line 77:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("a15", Object.isExtensible(Math), Object.isFrozen(Math), Object.isSealed(Math), Reflect.isExtensible(JSON), Object.isExtensible(Object), Object.isExtensible(Array), Object.isFrozen(Object), Object.isFrozen(Array)) } catch (e) { console.log("line 78:", e instanceof TypeError ? "TypeError" : "other " + e) }

// b. What they have from the start cannot be replaced, redefined, deleted or shadowed, but for the members left open. A change that is taken is not undone: the rest of the program runs with it.
try { console.log("b1", attempt(() => { Math.ceil = () => 0; return "stored" }), Math.ceil(1.5), attempt(() => delete (Math as any).ceil), typeof Math.ceil) } catch (e) { console.log("line 81:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("b2", attempt(() => Object.defineProperty(Math, "ceil", { value: () => 0 }) === Math), Reflect.set(Math, "ceil", 0), Reflect.defineProperty(Math, "ceil", { value: 0 }), Reflect.deleteProperty(Math, "ceil"), Math.ceil(1.5)) } catch (e) { console.log("line 82:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("b3", attempt(() => Object.setPrototypeOf(Math, {}) === Math), Reflect.setPrototypeOf(Math, {}), attempt(() => { (Math as any).__proto__ = {}; return "stored" }), Object.getPrototypeOf(Math) === Object.prototype) } catch (e) { console.log("line 83:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("b4", attempt(() => { (Math as any).toString = () => "mine"; return "stored" }), attempt(() => Object.defineProperty(Math, "toString", { value: () => "mine" }) === Math), Reflect.set(Math, "toString", 0), String(Math), Object.hasOwn(Math, "toString")) } catch (e) { console.log("line 84:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("b5", attempt(() => { JSON.parse = () => 0; return "stored" }), attempt(() => { Object.keys = () => []; return "stored" }), attempt(() => { Array.isArray = ((v: unknown) => false) as any; return "stored" }), attempt(() => { Promise.resolve = (() => 0) as any; return "stored" }), JSON.parse("1"), Object.keys({ k: 1 }).join(), Array.isArray([])) } catch (e) { console.log("line 85:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("b6", attempt(() => { (Array as any).prototype = {}; return "stored" }), attempt(() => delete (Array as any).prototype), attempt(() => Object.setPrototypeOf(Array, {}) === Array), attempt(() => { (Array as any).call = () => 0; return "stored" }), Array.prototype === Object.getPrototypeOf([])) } catch (e) { console.log("line 86:", e instanceof TypeError ? "TypeError" : "other " + e) }

// c. Every object, every way, through `any`. The key is a property the object has from the start.
interface Shot { keys: PropertyKey[]; descriptors: PropertyDescriptor[]; parent: object | null }
function shoot(p: object): Shot {
  const keys = Reflect.ownKeys(p), descriptors: PropertyDescriptor[] = []
  for (let i = 0; i < keys.length; i++) descriptors[i] = Reflect.getOwnPropertyDescriptor(p, keys[i]) as PropertyDescriptor
  return { keys, descriptors, parent: Reflect.getPrototypeOf(p) }
}
function isAsShot(p: object, was: Shot): boolean {
  const now = shoot(p)
  if (now.parent !== was.parent || now.keys.length !== was.keys.length) return false
  for (let i = 0; i < now.keys.length; i++) {
    const a = now.descriptors[i], b = was.descriptors[i]
    if (now.keys[i] !== was.keys[i] || !Object.is(a.value, b.value) || a.get !== b.get || a.set !== b.set || a.writable !== b.writable || a.enumerable !== b.enumerable || a.configurable !== b.configurable) return false
  }
  return true
}
// What an attempt changed is put back, so that each starts from the same state.
function restore(p: object, was: Shot) {
  Reflect.setPrototypeOf(p, was.parent)
  const keys = Reflect.ownKeys(p)
  for (let i = 0; i < keys.length; i++) if (was.keys.indexOf(keys[i]) < 0) Reflect.deleteProperty(p, keys[i])
  for (let i = 0; i < was.keys.length; i++) Reflect.defineProperty(p, was.keys[i], was.descriptors[i])
}
const replacement = function () { return "replaced" }
function data(): PropertyDescriptor { return { value: 1, writable: true, enumerable: true, configurable: true } }
const attempts: [string, (p: any, k: PropertyKey) => unknown][] = [
  ["set", p => { p.added = 1; return p.added }],
  ["index", p => { p[1] = 1; return p[1] }],
  ["symbol", p => { p[mark] = 1; return p[mark] }],
  ["define", p => Object.defineProperty(p, "added", data()).added],
  ["defineIndex", p => Object.defineProperty(p, 1, data())[1]],
  ["defineGetter", p => Object.defineProperty(p, "added", { get: replacement, configurable: true }).added],
  ["assign", p => Object.assign(p, { added: 1 }).added],
  ["Reflect.set", p => Reflect.set(p, "added", 1)],
  ["Reflect.setIndex", p => Reflect.set(p, 1, 1)],
  ["Reflect.define", p => Reflect.defineProperty(p, "added", data())],
  ["Reflect.defineIndex", p => Reflect.defineProperty(p, 1, data())],
  ["ordinary", p => { p.added = 1; p.added = 2; const d = Object.getOwnPropertyDescriptor(p, "added") as PropertyDescriptor; return [p.added, d.writable, d.enumerable, d.configurable, delete p.added, "added" in p].join("/") }],
  ["replace", (p, k) => { p[k] = replacement; return "stored" }],
  ["redefine", (p, k) => Object.defineProperty(p, k, { value: replacement }) === p],
  ["Reflect.replace", (p, k) => Reflect.set(p, k, replacement)],
  ["Reflect.redefine", (p, k) => Reflect.defineProperty(p, k, { value: replacement })],
  ["delete", (p, k) => delete p[k]],
  ["Reflect.delete", (p, k) => Reflect.deleteProperty(p, k)],
  ["shadow", p => { p.toString = replacement; return "stored" }],
  ["defineShadow", p => Object.defineProperty(p, "toString", { value: replacement, configurable: true }) === p],
  ["Reflect.shadow", p => Reflect.set(p, "toString", replacement)],
  ["setPrototypeOf", p => Object.setPrototypeOf(p, {}) === p],
  ["__proto__", p => { p.__proto__ = {}; return "stored" }],
  ["Reflect.setPrototypeOf", p => Reflect.setPrototypeOf(p, {})],
]
function row(name: string, p: any, k: PropertyKey) {
  const out: string[] = [], took: string[] = []
  let was = shoot(p)
  for (let i = 0; i < attempts.length; i++) {
    out[i] = attempts[i][0] + "=" + attempt(() => attempts[i][1](p, k))
    if (!isAsShot(p, was)) { took[took.length] = attempts[i][0]; restore(p, was); was = shoot(p) }
  }
  console.log(name, out.join(" "), "extensible=" + Object.isExtensible(p), "frozen=" + Object.isFrozen(p), "took=" + took.join())
}
try { row("Math", Math, "ceil") } catch (e) { console.log("line 148:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("JSON", JSON, "parse") } catch (e) { console.log("line 149:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Reflect", Reflect, "get") } catch (e) { console.log("line 150:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Atomics", Atomics, "add") } catch (e) { console.log("line 151:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Intl", Intl, "NumberFormat") } catch (e) { console.log("line 152:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Object", Object, "keys") } catch (e) { console.log("line 153:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Array", Array, "isArray") } catch (e) { console.log("line 154:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Function", Function, "prototype") } catch (e) { console.log("line 155:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("String", String, "fromCharCode") } catch (e) { console.log("line 156:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Number", Number, "isInteger") } catch (e) { console.log("line 157:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Boolean", Boolean, "prototype") } catch (e) { console.log("line 158:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Symbol", Symbol, "for") } catch (e) { console.log("line 159:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("BigInt", BigInt, "asIntN") } catch (e) { console.log("line 160:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Map", Map, "prototype") } catch (e) { console.log("line 161:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Set", Set, "prototype") } catch (e) { console.log("line 162:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("WeakMap", WeakMap, "prototype") } catch (e) { console.log("line 163:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("WeakSet", WeakSet, "prototype") } catch (e) { console.log("line 164:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("WeakRef", WeakRef, "prototype") } catch (e) { console.log("line 165:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Promise", Promise, "resolve") } catch (e) { console.log("line 166:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("RegExp", RegExp, "prototype") } catch (e) { console.log("line 167:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Date", Date, "now") } catch (e) { console.log("line 168:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Error", Error, "prototype") } catch (e) { console.log("line 169:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("TypeError", TypeError, "prototype") } catch (e) { console.log("line 170:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("ArrayBuffer", ArrayBuffer, "isView") } catch (e) { console.log("line 171:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("DataView", DataView, "prototype") } catch (e) { console.log("line 172:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("%TypedArray%", Object.getPrototypeOf(Uint8Array), "from") } catch (e) { console.log("line 173:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Uint8Array", Uint8Array, "prototype") } catch (e) { console.log("line 174:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Float64Array", Float64Array, "prototype") } catch (e) { console.log("line 175:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { row("Proxy", Proxy, "revocable") } catch (e) { console.log("line 176:", e instanceof TypeError ? "TypeError" : "other " + e) }

// d. In the end the changes that b could make are still there, and nothing else is.
try { console.log("d1", Object.keys(Math).length, Object.keys(JSON).length, Object.keys(Object).length, Object.keys(Array).length, String((Math as any).added), String((Array as any).added), mark in Math) } catch (e) { console.log("line 179:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("d2", Math.ceil(1.5), JSON.parse("[1]").length, Reflect.get({ k: 1 }, "k"), Object.keys({ k: 1 }).join(), Array.isArray([]), String.fromCharCode(97), Number.isInteger(1), Symbol.for("s") === Symbol.for("s"), String(BigInt.asIntN(8, 257n)), ArrayBuffer.isView(new Uint8Array(1)), Uint8Array.from([1, 2]).length, String(Math), typeof Array.toString()) } catch (e) { console.log("line 180:", e instanceof TypeError ? "TypeError" : "other " + e) }
