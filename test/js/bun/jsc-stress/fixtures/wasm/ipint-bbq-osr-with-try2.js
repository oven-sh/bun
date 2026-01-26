// @bun
function instantiate(moduleBase64, importObject) {
    let bytes = Uint8Array.fromBase64(moduleBase64);
    return WebAssembly.instantiate(bytes, importObject);
  }
  const report = $.agent.report;
  const isJIT = callerIsBBQOrOMGCompiled;
const extra = {isJIT};
(async function () {
let tag4 = new WebAssembly.Tag({parameters: ['i64', 'i64']});
let global0 = new WebAssembly.Global({value: 'i64', mutable: true}, 3499732511n);
let global1 = new WebAssembly.Global({value: 'anyfunc', mutable: true}, null);
let global2 = new WebAssembly.Global({value: 'i32', mutable: true}, 2571545964);
let global3 = new WebAssembly.Global({value: 'anyfunc', mutable: true}, global1.value);
let global4 = new WebAssembly.Global({value: 'f32', mutable: true}, 364166.8042332507);
let global7 = new WebAssembly.Global({value: 'f64', mutable: true}, 213733.71202709377);
let global8 = new WebAssembly.Global({value: 'f32', mutable: true}, 616331.2736008756);
let table0 = new WebAssembly.Table({initial: 0, element: 'externref'});
let table1 = new WebAssembly.Table({initial: 9, element: 'anyfunc'});
let table2 = new WebAssembly.Table({initial: 49, element: 'anyfunc'});
let table3 = new WebAssembly.Table({initial: 26, element: 'externref', maximum: 430});
let table4 = new WebAssembly.Table({initial: 28, element: 'externref'});
let table5 = new WebAssembly.Table({initial: 49, element: 'externref', maximum: 474});
let table6 = new WebAssembly.Table({initial: 15, element: 'anyfunc', maximum: 280});
let m2 = {global3, global4, global5: global0, table0, table2, table4, tag4};
let m1 = {global0, global1, global7, table6, tag5: tag4};
let m0 = {global2, global6: 364324.50814459583, global8, table1, table3, table5};
let importObject0 = /** @type {Imports2} */ ({extra, m0, m1, m2});
let i0 = await instantiate('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', importObject0);
let {fn0, global9, global10, global11, global12, global13, global14, global15, global16, global17, global18, memory0, table7, table8, table9, tag0, tag1, tag2, tag3} = /**
  @type {{
fn0: (a0: I64, a1: I64) => [I64, I64],
global9: WebAssembly.Global,
global10: WebAssembly.Global,
global11: WebAssembly.Global,
global12: WebAssembly.Global,
global13: WebAssembly.Global,
global14: WebAssembly.Global,
global15: WebAssembly.Global,
global16: WebAssembly.Global,
global17: WebAssembly.Global,
global18: WebAssembly.Global,
memory0: WebAssembly.Memory,
table7: WebAssembly.Table,
table8: WebAssembly.Table,
table9: WebAssembly.Table,
tag0: WebAssembly.Tag,
tag1: WebAssembly.Tag,
tag2: WebAssembly.Tag,
tag3: WebAssembly.Tag
  }} */ (i0.instance.exports);
table3.set(6, table0);
table8.set(24, table3);
table8.set(11, table3);
table5.set(46, table8);
table3.set(5, table8);
global16.value = 0n;
global1.value = null;
report('progress');
try {
  for (let k=0; k<29; k++) {
  let zzz = fn0(global0.value, global16.value);
  if (!(zzz instanceof Array)) { throw new Error('expected array but return value is '+zzz); }
if (zzz.length != 2) { throw new Error('expected array of length 2 but return value is '+zzz); }
let [r0, r1] = zzz;
r0?.toString(); r1?.toString();
  }
} catch (e) {
  if (e instanceof WebAssembly.Exception) {
  } else if (e instanceof TypeError) {
  if (e.message === 'an exported wasm function cannot contain a v128 parameter or return value') {} else { throw e; }
  } else if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {} else { throw e; }
}
report('progress');
try {
  for (let k=0; k<27; k++) {
  let zzz = fn0(global0.value, global16.value);
  if (!(zzz instanceof Array)) { throw new Error('expected array but return value is '+zzz); }
if (zzz.length != 2) { throw new Error('expected array of length 2 but return value is '+zzz); }
let [r0, r1] = zzz;
r0?.toString(); r1?.toString();
  }
} catch (e) {
  if (e instanceof WebAssembly.Exception) {
  } else if (e instanceof TypeError) {
  if (e.message === 'an exported wasm function cannot contain a v128 parameter or return value') {} else { throw e; }
  } else if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {} else { throw e; }
}
let tables = [table0, table4, table3, table5, table8, table1, table2, table6, table9, table7];
for (let table of tables) {
for (let k=0; k < table.length; k++) { table.get(k)?.toString(); }
}
})().then(() => {
  report('after');
}).catch(e => {
  report('error');
})
