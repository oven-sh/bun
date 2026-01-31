// @bun
//@ runDefaultWasm("--useDollarVM=1", "--jitPolicyScale=0.1")
function instantiate(moduleBase64, importObject) {
    let bytes = Uint8Array.fromBase64(moduleBase64);
    return WebAssembly.instantiate(bytes, importObject);
  }
  const report = $.agent.report;
  const isJIT = callerIsBBQOrOMGCompiled;
const extra = {isJIT};
(async function () {
let memory0 = new WebAssembly.Memory({initial: 728, shared: true, maximum: 1820});
/**
@returns {void}
 */
let fn0 = function () {
};
/**
@returns {void}
 */
let fn1 = function () {
};
/**
@param {ExternRef} a0
@param {FuncRef} a1
@returns {[ExternRef, FuncRef]}
 */
let fn2 = function (a0, a1) {
a0?.toString(); a1?.toString();
return [a0, a1];
};
/**
@returns {void}
 */
let fn3 = function () {
};
/**
@returns {void}
 */
let fn4 = function () {
};
/**
@param {ExternRef} a0
@param {FuncRef} a1
@returns {[ExternRef, FuncRef]}
 */
let fn5 = function (a0, a1) {
a0?.toString(); a1?.toString();
return [a0, a1];
};
/**
@param {ExternRef} a0
@param {FuncRef} a1
@returns {void}
 */
let fn6 = function (a0, a1) {
a0?.toString(); a1?.toString();
};
/**
@param {ExternRef} a0
@param {FuncRef} a1
@returns {void}
 */
let fn7 = function (a0, a1) {
a0?.toString(); a1?.toString();
};
/**
@returns {void}
 */
let fn8 = function () {
};
let tag4 = new WebAssembly.Tag({parameters: ['externref', 'anyfunc']});
let tag5 = new WebAssembly.Tag({parameters: []});
let global0 = new WebAssembly.Global({value: 'externref', mutable: true}, {});
let global1 = new WebAssembly.Global({value: 'f32', mutable: true}, -53278.38197474244);
let m2 = {fn1, fn4, global2: global0, global4: global0, global6: global0, memory0};
let m0 = {fn0, fn5, fn7, fn8, global0, global5: global1, tag7: tag5};
let m1 = {fn2, fn3, fn6, global1, global3: global0, tag4, tag5, tag6: tag4, tag8: tag5, tag9: tag4};
let importObject0 = /** @type {Imports2} */ ({m0, m1, m2});
let i0 = await instantiate('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', importObject0);
let {fn9, fn10, fn11, global7, global8, global9, global10, global11, global12, global13, global14, global15, global16, global17, global18, memory1, table0, table1, table2, table3, table4, table5, tag0, tag1, tag2, tag3} = /**
  @type {{
fn9: () => void,
fn10: (a0: ExternRef, a1: FuncRef) => [ExternRef, FuncRef],
fn11: (a0: ExternRef, a1: FuncRef) => [ExternRef, FuncRef],
global7: WebAssembly.Global,
global8: WebAssembly.Global,
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
memory1: WebAssembly.Memory,
table0: WebAssembly.Table,
table1: WebAssembly.Table,
table2: WebAssembly.Table,
table3: WebAssembly.Table,
table4: WebAssembly.Table,
table5: WebAssembly.Table,
tag0: WebAssembly.Tag,
tag1: WebAssembly.Tag,
tag2: WebAssembly.Tag,
tag3: WebAssembly.Tag
  }} */ (i0.instance.exports);
table1.set(24, table0);
table1.set(13, table0);
table0.set(31, table0);
table0.set(11, table0);
table0.set(1, table1);
table1.set(2, table0);
table1.set(27, table0);
table1.set(17, table0);
table0.set(5, table0);
table1.set(48, table0);
table1.set(42, table0);
table1.set(12, table0);
global15.value = 0n;
global18.value = 0;
global13.value = 'a';
report('progress');
try {
  for (let k=0; k<14; k++) {
  let zzz = fn11(global13.value, null);
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
  for (let k=0; k<18; k++) {
  let zzz = fn10(global13.value, null);
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
  for (let k=0; k<15; k++) {
  let zzz = fn9();
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
  for (let k=0; k<25; k++) {
  let zzz = fn10(global13.value, null);
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
  for (let k=0; k<25; k++) {
  let zzz = fn11(global13.value, null);
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
  for (let k=0; k<10; k++) {
  let zzz = fn9();
  if (zzz !== undefined) { throw new Error('expected undefined but return value is '+zzz); }
  }
} catch (e) {
  if (e instanceof WebAssembly.Exception) {
  } else if (e instanceof TypeError) {
  if (e.message === 'an exported wasm function cannot contain a v128 parameter or return value') {} else { throw e; }
  } else if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {} else { throw e; }
}
let tables = [table0, table1, table4, table3, table2, table5];
for (let table of tables) {
for (let k=0; k < table.length; k++) { table.get(k)?.toString(); }
}
})().then(() => {
  report('after');
}).catch(e => {
  report('error');
})
