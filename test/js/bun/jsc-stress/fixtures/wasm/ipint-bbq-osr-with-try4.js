// @bun
//@ $skipModes << "wasm-no-jit".to_sym
//@ $skipModes << "wasm-no-wasm-jit".to_sym
// Too slow without JIT

function instantiate(moduleBase64, importObject) {
    let bytes = Uint8Array.fromBase64(moduleBase64);
    return WebAssembly.instantiate(bytes, importObject);
  }
  const report = $.agent.report;
  const isJIT = callerIsBBQOrOMGCompiled;
const extra = {isJIT};
(async function () {
let memory0 = new WebAssembly.Memory({initial: 1850, shared: true, maximum: 2731});
/**
@param {I32} a0
@param {F32} a1
@returns {void}
 */
let fn0 = function (a0, a1) {
a0?.toString(); a1?.toString();
};
/**
@returns {void}
 */
let fn1 = function () {
};
/**
@param {I32} a0
@param {F32} a1
@returns {[I32, F32]}
 */
let fn2 = function (a0, a1) {
a0?.toString(); a1?.toString();
return [36, 8.433544074882645e1];
};
/**
@param {I32} a0
@param {FuncRef} a1
@returns {void}
 */
let fn3 = function (a0, a1) {
a0?.toString(); a1?.toString();
};
let tag5 = new WebAssembly.Tag({parameters: []});
let tag6 = new WebAssembly.Tag({parameters: ['i32', 'f32']});
let tag9 = new WebAssembly.Tag({parameters: []});
let global0 = new WebAssembly.Global({value: 'i32', mutable: true}, 3721432472);
let global1 = new WebAssembly.Global({value: 'f64', mutable: true}, 548636.1280581957);
let global3 = new WebAssembly.Global({value: 'f32', mutable: true}, 52810.0658290932);
let global4 = new WebAssembly.Global({value: 'i64', mutable: true}, 1872919390n);
let global7 = new WebAssembly.Global({value: 'anyfunc', mutable: true}, null);
let global8 = new WebAssembly.Global({value: 'externref', mutable: true}, {});
let table0 = new WebAssembly.Table({initial: 48, element: 'externref', maximum: 347});
let table1 = new WebAssembly.Table({initial: 37, element: 'anyfunc'});
let table2 = new WebAssembly.Table({initial: 51, element: 'externref', maximum: 276});
let table3 = new WebAssembly.Table({initial: 77, element: 'externref'});
let m2 = {fn3, global0, global2: global0, global7, memory0, tag5, tag6, tag9};
let m1 = {fn0, fn1, fn2, global1, global6: global3, global8, table0, table1, table3, tag8: tag5, tag12: tag9};
let m0 = {global3, global4, global5: global4, table2, table4: table3, tag7: tag5, tag10: tag9, tag11: tag6};
let importObject0 = /** @type {Imports2} */ ({extra, m0, m1, m2});
let i0 = await instantiate('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', importObject0);
let {fn4, fn5, global9, global10, global11, global12, global13, global14, global15, global16, memory1, table5, table6, table7, table8, table9, tag0, tag1, tag2, tag3, tag4} = /**
  @type {{
fn4: (a0: FuncRef, a1: I64, a2: V128) => [FuncRef, I64, V128],
fn5: (a0: I32, a1: F32) => void,
global9: WebAssembly.Global,
global10: WebAssembly.Global,
global11: WebAssembly.Global,
global12: WebAssembly.Global,
global13: WebAssembly.Global,
global14: WebAssembly.Global,
global15: WebAssembly.Global,
global16: WebAssembly.Global,
memory1: WebAssembly.Memory,
table5: WebAssembly.Table,
table6: WebAssembly.Table,
table7: WebAssembly.Table,
table8: WebAssembly.Table,
table9: WebAssembly.Table,
tag0: WebAssembly.Tag,
tag1: WebAssembly.Tag,
tag2: WebAssembly.Tag,
tag3: WebAssembly.Tag,
tag4: WebAssembly.Tag
  }} */ (i0.instance.exports);
table5.set(16, table2);
table3.set(2, table9);
table6.set(5, table3);
table3.set(54, table5);
table5.set(37, table9);
table5.set(83, table0);
table9.set(16, table3);
table0.set(5, table9);
table2.set(23, table5);
table2.set(27, table9);
table9.set(60, table6);
table6.set(9, table2);
table7.set(8, table7);
table5.set(46, table7);
table2.set(43, table3);
table6.set(18, table6);
table3.set(23, table2);
table0.set(21, table2);
table6.set(8, table0);
table6.set(6, table7);
global13.value = 0;
global12.value = 0n;
global8.value = 'a';
report('progress');
try {
  for (let k=0; k<27; k++) {
  let zzz = fn5(global9.value, global3.value);
  if (zzz !== undefined) { throw new Error('expected undefined but return value is '+zzz); }
  }
} catch (e) {
  if (e instanceof WebAssembly.Exception) {
  } else if (e instanceof TypeError) {
  if (e.message === 'an exported wasm function cannot contain a v128 parameter or return value') {} else { throw e; }
  } else if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {} else { throw e; }
}
report('progress');
try {
  for (let k=0; k<9; k++) {
  let zzz = fn5(k, global10.value);
  if (zzz !== undefined) { throw new Error('expected undefined but return value is '+zzz); }
  }
} catch (e) {
  if (e instanceof WebAssembly.Exception) {
  } else if (e instanceof TypeError) {
  if (e.message === 'an exported wasm function cannot contain a v128 parameter or return value') {} else { throw e; }
  } else if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {} else { throw e; }
}
let tables = [table0, table3, table2, table7, table6, table9, table5, table1, table8];
for (let table of tables) {
for (let k=0; k < table.length; k++) { table.get(k)?.toString(); }
}
})().then(() => {
  report('after');
}).catch(e => {
  report('error');
})
