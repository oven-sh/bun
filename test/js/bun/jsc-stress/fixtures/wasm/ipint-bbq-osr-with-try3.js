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
let memory0 = new WebAssembly.Memory({initial: 64, shared: true, maximum: 385});
/**
@param {F32} a0
@param {FuncRef} a1
@returns {[F32, FuncRef]}
 */
let fn0 = function (a0, a1) {
a0?.toString(); a1?.toString();
return [7.379721330814865e-7, a1];
};
/**
@returns {I32}
 */
let fn1 = function () {

return 44;
};
/**
@returns {[FuncRef, ExternRef]}
 */
let fn2 = function () {

return [null, {f:42}];
};
/**
@param {F32} a0
@param {FuncRef} a1
@returns {[F32, FuncRef]}
 */
let fn3 = function (a0, a1) {
a0?.toString(); a1?.toString();
return [5.672612013030605e25, a1];
};
let tag0 = new WebAssembly.Tag({parameters: []});
let tag1 = new WebAssembly.Tag({parameters: ['f32', 'anyfunc']});
let tag2 = new WebAssembly.Tag({parameters: ['f32', 'anyfunc']});
let global0 = new WebAssembly.Global({value: 'i32', mutable: true}, 456597103);
let global1 = new WebAssembly.Global({value: 'i32', mutable: true}, 3266924630);
let global2 = new WebAssembly.Global({value: 'externref', mutable: true}, {});
let global3 = new WebAssembly.Global({value: 'f64', mutable: true}, 461131.2504203794);
let global4 = new WebAssembly.Global({value: 'f32', mutable: true}, 783663.6145011102);
let global6 = new WebAssembly.Global({value: 'i32', mutable: true}, 169917961);
let global7 = new WebAssembly.Global({value: 'anyfunc', mutable: true}, null);
let table0 = new WebAssembly.Table({initial: 99, element: 'anyfunc'});
let table1 = new WebAssembly.Table({initial: 19, element: 'externref'});
let table2 = new WebAssembly.Table({initial: 36, element: 'externref', maximum: 841});
let table3 = new WebAssembly.Table({initial: 94, element: 'externref'});
let table5 = new WebAssembly.Table({initial: 48, element: 'externref', maximum: 536});
let m1 = {fn0, fn1, fn3, global4, global5: global2, memory0, table0, table4: table0, tag0, tag1};
let m0 = {fn2, global0, global1, global2, table2, tag2};
let m2 = {global3, global6, global7, table1, table3, table5};
let importObject0 = /** @type {Imports2} */ ({extra, m0, m1, m2});
let i0 = await instantiate('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', importObject0);
let {fn4, fn5, fn6, global8, global9, global10, global11, global12, global13, global14, global15, memory1} = /**
  @type {{
fn4: (a0: ExternRef, a1: V128, a2: FuncRef) => void,
fn5: () => I32,
fn6: () => void,
global8: WebAssembly.Global,
global9: WebAssembly.Global,
global10: WebAssembly.Global,
global11: WebAssembly.Global,
global12: WebAssembly.Global,
global13: WebAssembly.Global,
global14: WebAssembly.Global,
global15: WebAssembly.Global,
memory1: WebAssembly.Memory
  }} */ (i0.instance.exports);
table3.set(36, table2);
table5.set(31, table3);
table1.set(4, table3);
table5.set(27, table2);
table2.set(3, table1);
table3.set(1, table5);
table5.set(11, table3);
table5.set(13, table3);
table2.set(18, table2);
table2.set(35, table3);
table5.set(9, table5);
table3.set(46, table2);
table5.set(34, table3);
table5.set(11, table1);
table1.set(8, table5);
table1.set(13, table2);
table1.set(10, table1);
table5.set(36, table1);
table2.set(4, table1);
table1.set(9, table5);
table1.set(9, table3);
table3.set(13, table5);
global8.value = 0n;
global3.value = 0;
global2.value = 'a';
report('progress');
try {
  for (let k=0; k<26; k++) {
  let zzz = fn5();
  zzz?.toString();
  }
} catch (e) {
  if (e instanceof WebAssembly.Exception) {
  } else if (e instanceof TypeError) {
  if (e.message === 'an exported wasm function cannot contain a v128 parameter or return value') {} else { throw e; }
  } else if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {} else { throw e; }
}
report('progress');
try {
  for (let k=0; k<18; k++) {
  let zzz = fn6();
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
  for (let k=0; k<27; k++) {
  let zzz = fn5();
  zzz?.toString();
  }
} catch (e) {
  if (e instanceof WebAssembly.Exception) {
  } else if (e instanceof TypeError) {
  if (e.message === 'an exported wasm function cannot contain a v128 parameter or return value') {} else { throw e; }
  } else if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {} else { throw e; }
}
report('progress');
try {
  for (let k=0; k<14; k++) {
  let zzz = fn6();
  if (zzz !== undefined) { throw new Error('expected undefined but return value is '+zzz); }
  }
} catch (e) {
  if (e instanceof WebAssembly.Exception) {
  } else if (e instanceof TypeError) {
  if (e.message === 'an exported wasm function cannot contain a v128 parameter or return value') {} else { throw e; }
  } else if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {} else { throw e; }
}
let tables = [table1, table2, table3, table5, table0];
for (let table of tables) {
for (let k=0; k < table.length; k++) { table.get(k)?.toString(); }
}
})().then(() => {
  report('after');
}).catch(e => {
  report('error');
})
