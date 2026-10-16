#!/usr/bin/env python3
"""large-literals-of-constants.py <folder>: A large literal of constants may be kept as a JSON text and parsed once. What must hold: numbers bit for bit, strings code unit for code unit, keys and their order, a name given twice, __proto__, depth, what is NOT a constant in the middle. A folder a case: main.ts imports ./data.js, whose module body holds the literal; 5,000 filler leaves make it large. The digest looks at everything a program can see."""
import os, random, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
H = os.getcwd()
MAIN='''declare const console: { log(...values: unknown[]): void };
// @ts-ignore
import * as data from "./data.js";
const bits = new Float64Array(1), words = new Uint32Array(bits.buffer);
let hash = 0, count = 0;
function mix(n: number): void { hash = (Math.imul(hash, 31) + n) | 0; count++ }
function text(s: string): void { mix(s.length); for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i)) }
function look(v: any, depth: number): void {
  if (typeof v === "number") { bits[0] = v; mix(1); mix(words[0]!); mix(words[1]!); return }
  if (typeof v === "string") { mix(2); text(v); return }
  if (typeof v === "boolean") { mix(v ? 3 : 4); return }
  if (v === null) { mix(5); return }
  if (v === undefined) { mix(6); return }
  if (typeof v === "function") { mix(7); return }
  if (typeof v === "bigint") { mix(10); text(String(v)); return }
  const isArray = Array.isArray(v);
  mix(isArray ? 8 : 9); mix(Object.getPrototypeOf(v) === (isArray ? Array.prototype : Object.prototype) ? 1 : 0); mix(Object.isExtensible(v) ? 1 : 0);
  const names = Reflect.ownKeys(v);
  mix(names.length);
  for (const name of names) {
    text(String(name));
    const d = Object.getOwnPropertyDescriptor(v, name)!;
    mix((d.writable ? 1 : 0) | (d.enumerable ? 2 : 0) | (d.configurable ? 4 : 0) | ("get" in d ? 8 : 0));
    if (!("get" in d)) look(d.value, depth + 1);
  }
}
const all = data as any;
for (const name of Object.keys(all).sort()) { hash = 0; count = 0; look(all[name], 0); console.log(name, hash, count) }
if (all.shown) console.log(JSON.stringify(all.shown).slice(0, 1500));
if (all.big && all.again) console.log("two evaluations are two objects", all.big !== all.again);
if (all.big && typeof all.big === "object") { const b = all.big; b.added = 1; delete b.f0; console.log("it is ordinary", b.added, "f0" in b, Object.isFrozen(b)) }
'''
TS='{ "compilerOptions": { "strict": true, "allowJs": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "noEmit": true, "types": [], "lib": ["esnext"] }, "include": ["main.ts"] }\n'
def filler(n,start=0): return ', '.join('f%d: %d'%(i,i) for i in range(start,start+n))
NUM=['0','-0','0.0','-0.0','1','-1','2147483647','2147483648','-2147483648','-2147483649','4294967295','4294967296','9007199254740991','9007199254740992','9007199254740993','9007199254740994','-9007199254740991','-9007199254740993','18014398509481984','1e21','1e+21','999999999999999900000','123456789012345680000','1e-7','0.000001','1e-6','5e-324','4.9e-324','2.2250738585072014e-308','2.225073858507201e-308','1.7976931348623157e308','1.7976931348623157e+308','0.1','0.2','0.30000000000000004','0.3333333333333333','4.35','1.005','1e300','1.5','-1.5','0x7fffffff','0xffffffff','0x1fffffffffffff','0b101','0o17','1_000_000','.5','5.','1e3','1E3','100e-2','1.0','2.50','123456789.123456789','0.1e1','72057594037927936','1e22','1e23','8.41e21','2e-7','-1e-7','3.141592653589793','2.718281828459045','4503599627370496.5','4503599627370497.5','9.5e-7']
STR=[r'""',r'"\0"',r'"\x01"',r'"\x1f"',r'"\x7f"',r'"\x80"',r'"\xff"',r'"\""',r'"\\"',r'"/"',r'"\/"',r'"\u2028"',r'"\u2029"',r'"a\u2028b\u2029c"',r'"\ud800"',r'"\udc00"',r'"\ud800x"',r'"x\udc00"',r'"\ud83d\ude00"',r'"\udc00\ud800"',r'"\ud800\ud800"',r'"\udbff\udfff"',r'"\ud7ff\ue000"',r'"\ufffe\uffff"',r'"\ufeff"',r'"é"',r'"\u0100"',r'"日本語"',r'"😀"',r'"a😀b"',r'"__proto__"',r'"\\u0041"',r'"\\n"',r'"\n\r\t\b\f\v"',r'"\\\""',r'"\\\\"',r'"{\"a\":1}"',r'"]"',r'"}"',r'","',r'":"',r"'single \" quote'",r"'it\'s'",r'`template`',r'`line\nbreak`','"'+'x'*70000+'"','"'+'é'*3000+'"','"'+r'\ud800'*50+'"',r'"\u0000\u0000"',r'"a\0b"',r'"\x1e\x1f\x20"']
KEY=['a','"a b"','""','"0"','"1"','"01"','"-1"','"1.5"','"4294967294"','"4294967295"','"4294967296"','"1e3"','0','1','7','1.5','1e3','0x10','"constructor"','"toString"','"length"','"hasOwnProperty"','"valueOf"','"\\0"','"\\""','"\\\\"','"\\u2028"','"\\ud800"','"\\udc00x"','"é"','"😀"','"日本"','"\\n"','"prototype"','"then"','"get"','"set"','async','await','"NaN"','"undefined"','"null"','"true"','class','function','"__proto__x"','"__defineGetter__"']
cases={}
cases['numbers']='export const big = { '+', '.join('n%d: %s'%(i,v) for i,v in enumerate(NUM))+', '+filler(5000)+' };\nexport const inArray = { list: ['+', '.join(NUM)+'], nested: [['+', '.join(NUM)+']], '+filler(5000)+' };\nexport const shown = ['+', '.join(NUM)+'];\n'
cases['strings']='export const big = { '+', '.join('s%d: %s'%(i,v) for i,v in enumerate(STR))+', '+filler(5000)+' };\nexport const inArray = { list: ['+', '.join(STR)+'], '+filler(5000)+' };\n'
cases['keys']='export const big = { '+filler(2500)+', '+', '.join('%s: %d'%(k,i) for i,k in enumerate(KEY))+', '+filler(2500,2500)+' };\nexport const keysFirst = { '+', '.join('%s: "v%d"'%(k,i) for i,k in enumerate(KEY))+', '+filler(5000)+' };\n'
cases['a_name_given_twice']='export const big = { a: 1, b: 2, a: 3, "a": 4, c: { x: 1, x: 2, y: 3, x: { z: 1 } }, 1: "one", "1": "uno", 1.0: "eins", 0x1: "hex", b: [1, 2], '+filler(5000)+', f7: "again", f0: null };\n'
cases['proto']='export const unquoted = { __proto__: null, a: 1, '+filler(5000)+' };\nexport const quoted = { "__proto__": null, a: 1, '+filler(5000)+' };\nexport const computed = { ["__proto__"]: null, a: 1, '+filler(5000)+' };\nexport const toObject = { __proto__: { inherited: 1 }, a: 1, '+filler(5000)+' };\nexport const number = { __proto__: 5, a: 1, '+filler(5000)+' };\nexport const nested = { inner: { __proto__: null, b: 2 }, other: { "__proto__": { c: 3 } }, third: { ["__proto__"]: 7 }, '+filler(5000)+' };\nexport const asValue = { k: "__proto__", '+filler(5000)+' };\n'
def deep(n,leaf): return '{ d: '*n+leaf+' }'*n
def deepa(n,leaf): return '['*n+leaf+']'*n
cases['depth']=''.join('export const o%d = { deep: %s, %s };\nexport const a%d = { deep: %s, %s };\n'%(n,deep(n,'1'),filler(5000),n,deepa(n,'1'),filler(5000)) for n in (1,2,62,63,64,65,66,100))
cases['not_constants_in_the_middle']='let c = 0; function g() { return ++c }\nconst v = "variable";\nexport const big = { '+filler(2000)+', call: g(), '+filler(2000,2000)+', name: v, u: undefined, hole: [1, , 3], neg: -g(), t: `a${v}b`, big: 10n === 10n, re: /x/.source, fn() { return 1 }, get acc() { return 2 }, [v]: 3, ...{ spread: 4 }, nan: NaN, inf: Infinity, ninf: -Infinity, arrow: () => 1, inner: { a: 1, b: g(), c: 3 }, list: [1, g(), 3], '+filler(2000,4000)+' };\nexport const order = c;\n'
cases['empties_and_shapes']='export const big = { e: {}, a: [], ee: { e: {} }, aa: [[]], ae: [{}], ea: { a: [] }, many: ['+', '.join('[]' for _ in range(300))+'], objs: ['+', '.join('{ id: %d, name: "n%d", tags: ["a", "b"], ok: %s, none: null }'%(i,i,'true' if i%2 else 'false') for i in range(1200))+'], mixed: [1, "a", null, true, 1.5, [2], { k: 3 }], ints: ['+', '.join(str(i) for i in range(300))+'], doubles: ['+', '.join(str(i+0.5) for i in range(300))+'], intsThenDouble: [1, 2, 3.5], intsThenString: [1, 2, "3"] };\nexport const rootArray = ['+', '.join('{ id: %d }'%i for i in range(5000))+'];\nexport const flatArray = ['+', '.join(str(i) for i in range(6000))+'];\n'
cases['used_more_than_once']='const shared = { s: 1 };\nexport const big = { one: shared, two: shared, '+filler(5000)+' };\nexport const same = big.one === big.two;\nfunction make() { return { '+filler(5000)+' } }\nexport const again = make();\nexport const third = make() !== again;\nlet kept; export const held = { inner: (kept = { k: 1 }), '+filler(5000)+' };\nexport const isKept = held.inner === kept;\nexport const inLoop = []; for (let i = 0; i < 2; i++) inLoop.push({ '+filler(5000)+' });\nexport const distinct = inLoop[0] !== inLoop[1];\n'
cases['at_the_floor']=''.join('export const n%d = { %s };\n'%(n,filler(n)) for n in (4094,4095,4096,4097))
F=filler(5000)
def M(name): return 'mark_%s: 1, '%name+F
BEHIND=[('call','x: g()'),('name','x: v'),('undef','x: undefined'),('hole','x: [1, , 3]'),('method','m() { return 1 }'),('superMethod','m() { return super.toString === Object.prototype.toString }'),('getter','get acc() { return 2 }'),('setter','set acc(q) { }'),('computed','[v]: 3'),('computedCall','[g()]: 3'),('spread','...{ spread: 4, f1: "spread" }'),('nan','x: NaN'),('inf','x: -Infinity'),('arrow','x: () => 1'),('bigint','x: 10n'),('regexp','x: /x/g'),('template','x: `a${v}b`'),('proto','__proto__: { inherited: 1 }'),('protoNull','__proto__: null'),('inner','x: { a: 1, b: g(), c: 3 }'),('list','x: [1, g(), 3]'),('cond','x: g() ? 1 : 2'),('condObject','x: g() ? { a: 1 } : { b: 2 }'),('logical','x: g() && { a: 1 }'),('shorthand','v'),('klass','x: class { static s = 1 }'),('neg','x: -g()'),('voidZero','x: void 0'),('typeOf','x: typeof v'),('comma','x: (g(), 5)'),('awaited','x: await 5')]
for n,x in BEHIND: cases['behind_'+n]='let c = 0; function g() { return ++c }\nconst v = "variable";\nexport const big = { %s, %s, after: 1, f3: "again", %s };\nexport const order = c;\n'%(M(n),x,filler(50,6000))
cases['two_large_blocks']='let c = 0; function g() { return ++c }\nexport const big = { '+F+', x: g() ? 1 : 2, '+filler(5000,5000)+', y: g() ? "a" : "b", '+filler(5000,10000)+' };\nexport const nested = { first: { '+F+' }, x: g() ? 1 : 2, second: { '+F+' }, third: [ { '+F+' }, g() ? 1 : 2, { '+F+' } ] };\n'
cases['under_a_handler']='export let big, list, thrown, after;\ntry { big = { '+M('inTry')+' } } catch (e) { big = "caught" }\ntry { list = [ { '+M('listInTry')+' }, [1, 2] ] } catch (e) { list = "caught" } finally { after = 1 }\ntry { thrown = { '+M('thrown')+', x: null.y } } catch (e) { thrown = String(e instanceof TypeError) }\nexport let inCatch; try { null.y } catch (e) { inCatch = { '+M('inCatch')+' } }\nexport let inFinally; try { } finally { inFinally = { '+M('inFinally')+' } }\n'
cases['in_other_statements']='const yes = Date.now() > 0;\nexport let inIf; if (yes) { inIf = { '+M('inIf')+' } }\nexport let inElse; if (!yes) { } else { inElse = { '+M('inElse')+' } }\nexport let labelled; out: { labelled = { '+M('labelled')+' }; break out }\nexport let once; do { once = { '+M('once')+' } } while (false);\nexport let inSwitch; switch (yes) { case true: inSwitch = { '+M('inSwitch')+' } }\nexport const conditional = yes ? { '+M('conditional')+' } : null;\nexport const logical = yes && { '+M('logical')+' };\nexport const plainOne = { '+M('plainOne')+' };\nexport var byVar = { '+M('byVar')+' };\nexport let inBlock; { inBlock = { '+M('inBlock')+' } }\n'
cases['as_an_argument']='function id(x) { return x }\nexport const passed = id({ '+F+' });\nexport const frozen = Object.freeze({ '+F+' });\nexport const isFrozen = Object.isFrozen(frozen);\nexport const map = [...new Map([ '+', '.join('["k%d", %d]'%(i,i) for i in range(3000))+' ])].length;\nexport const set = new Set([ '+', '.join('[%d]'%i for i in range(5000))+' ]).size;\nexport const member = { '+F+' }.f77;\nexport const keysOf = Object.keys({ '+F+' }).length;\nexport const text = JSON.stringify({ '+F+' }).length;\nexport const [first, second] = [ { '+F+' }, { '+F+' } ];\nexport const { f5, ...rest } = { '+F+' };\nexport default { '+F+' };\nexport const sharedString = "f10"; export const alsoShared = { '+F+', s: "f10", t: "sharedValue" }; export const sharedValue = "sharedValue";\nexport const two = [{ '+F+' }, { '+F+' }]; export const twoDiffer = two[0] !== two[1];\n'
cases['prototypes_with_setters']='export const log = [];\nlet ok = true;\ntry { Object.defineProperty(Object.prototype, "f1", { set(v) { log.push("f1 " + v) }, get() { return "inherited" }, configurable: true }); Object.defineProperty(Object.prototype, "7", { set(v) { log.push("7 " + v) }, configurable: true }); Object.defineProperty(Array.prototype, "1", { set(v) { log.push("[1] " + v) }, configurable: true }) } catch (e) { ok = false }\nexport const couldDefine = ok;\nexport const big = { '+F+', 7: "seven", list: [[1, 2, 3], [4, 5, 6]] };\ntry { delete Object.prototype.f1; delete Object.prototype["7"]; delete Array.prototype["1"] } catch (e) { }\n'
cases['five_megabytes']='export const big = { '+', '.join('"home.title.k%d": "Welcome back, number %d of a long list of sentences."'%(i,i) for i in range(70000))+' };\n'
import random,struct
R=random.Random(20261014)
def dbl():
    while True:
        x=struct.unpack('<d',struct.pack('<Q',R.getrandbits(64)))[0]
        if x==x and x not in (float('inf'),float('-inf')): return x
D=[repr(dbl()) for _ in range(5000)]+[repr(struct.unpack('<d',struct.pack('<Q',R.getrandbits(52)))[0]) for _ in range(500)]+[repr(float(R.getrandbits(R.randint(1,70)))*R.choice((1,-1))) for _ in range(1000)]+[str(R.getrandbits(R.randint(1,66))*R.choice((1,-1))) for _ in range(1500)]+[repr(round(R.uniform(-1e6,1e6),R.randint(0,12))) for _ in range(1000)]+['%de%d'%(R.randint(1,99999),R.randint(-330,300)) for _ in range(1000)]
cases['random_numbers']='export const big = { '+', '.join('n%d: %s'%(i,v) for i,v in enumerate(D))+' };\nexport const lists = [['+', '.join(D)+'], [1]];\n'
def unit():
    k=R.random()
    if k<.25: return R.randint(0,0x1f)
    if k<.45: return R.choice((0x22,0x5c,0x2f,0x7f,0x80,0xff,0x100,0x2028,0x2029,0xfeff,0xfffe,0xffff,0xd7ff,0xe000))
    if k<.70: return R.randint(0xd800,0xdfff)
    if k<.85: return R.randint(0x20,0x7e)
    return R.randint(0x80,0xffff)
def st(): return '"'+''.join('\\u%04x'%unit() for _ in range(R.randint(0,12)))+'"'
X=[st() for _ in range(6000)]
cases['random_strings']='export const big = { '+', '.join('s%d: %s'%(i,v) for i,v in enumerate(X))+' };\nexport const asKeys = { '+', '.join('%s: %d'%(v,i) for i,v in enumerate(X))+' };\nexport const lists = [['+', '.join(X)+'], [1]];\n'
def raw():
    o=''
    for _ in range(R.randint(0,10)):
        c=R.choice((R.randint(0x20,0x7e),R.randint(0xa0,0x2ff),R.randint(0x3040,0x30ff),R.randint(0x1f300,0x1f64f),0x2028,0x2029,0x7f,0xfeff))
        o+={0x22:'\\"',0x5c:'\\\\'}.get(c,chr(c))
    return '"'+o+'"'
Y=[raw() for _ in range(6000)]
cases['random_strings_written_raw']='export const big = { '+', '.join('s%d: %s'%(i,v) for i,v in enumerate(Y))+' };\nexport const asKeys = { '+', '.join('%s: %d'%(v,i) for i,v in enumerate(Y))+' };\n'
cases['many_empties']='export const arrays = ['+', '.join('[]' for _ in range(5000))+'];\nexport const objects = ['+', '.join('{}' for _ in range(5000))+'];\nexport const inObject = { '+', '.join('e%d: %s'%(i,'[]' if i%2 else '{}') for i in range(5000))+' };\nexport const distinct = arrays[0] !== arrays[1] && objects[0] !== objects[1] && inObject.e0 !== inObject.e2;\n'
TSCASE='export const asAny: any = { '+M('asAny')+' };\nexport const castAny = { '+M('castAny')+' } as any;\nexport const asUnknown: unknown = { '+M('asUnknown')+' };\nexport const asARecord: Record<string, number> = { '+M('asARecord')+' };\nexport const asObject: object = { '+M('asObject')+' };\nexport const inferred = { '+M('inferred')+' };\nexport const asConst = { '+M('asConst')+' } as const;\nexport const anyList: any[] = [ { '+M('anyList')+' }, [1] ];\nexport const sum: number = inferred.f7 + asARecord["f8"]! + asAny.f9 + asConst.f10;\n'
for name,body in cases.items():
    d=os.path.join(H,name); os.makedirs(d,exist_ok=True)
    open(os.path.join(d,'main.ts'),'w').write(MAIN); open(os.path.join(d,'data.js'),'w').write(body); open(os.path.join(d,'tsconfig.json'),'w').write(TS)
d=os.path.join(H,'in_typescript'); os.makedirs(d,exist_ok=True)
open(os.path.join(d,'main.ts'),'w').write(MAIN.replace('"./data.js"','"./data"')); open(os.path.join(d,'data.ts'),'w').write(TSCASE); open(os.path.join(d,'data.js.txt'),'w').write(''); open(os.path.join(d,'tsconfig.json'),'w').write(TS)
print(len(cases)+1,'folders')
