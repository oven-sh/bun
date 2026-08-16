// @bun
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
/*
  (func (;5;) (param ) (result )
    (local i32 i32)
    loop ;; label = @1
      local.get 1
      i32.const 1
      i32.add
      local.tee 1
      i32.const 43
      i32.lt_u
      br_if 0 (;@1;)
      ;; BEGIN IMPORTANT
        i32.const 1
        i32.const 6
        table.get 1
        ;; BEGIN VERY IMPORTANT
        loop (param i32 funcref) (result i32 funcref)  ;; label = @3
          try (param i32 funcref) (result i32 funcref)  ;; label = @4
            local.get 0
            i32.const 1
            i32.add
            local.tee 0
            i32.const 36
            i32.lt_u
            if (param i32 funcref) (result i32 funcref)  ;; label = @5
              br 2 (;@3;)
            end
          end
        end
        ;; END VERY IMPORTANT
        table.set 1
      ;; END IMPORTANT
    end
    )
  (func (;6;) (type 18) (param i32 f32)
    call 5
    return)

*/
let i0 = await instantiate(
'AGFzbQEAAAABgAETYAABf2ACf3AJcH1/cHt9f3t9YAJ/cAJ/cGACf3AAYANvcHsAYANvcHsDb3B7YANvcHsAYAN7fn8De317YAN7fn8De35/YAN7fn8AYANwfnsDfXB/YANwfnsDcH57YANwfnsAYAAAYAAAYAAAYAJ/fQJ7f2ACf30Cf31gAn99AALnAhwCbTIHbWVtb3J5MAIDug6rFQJtMQNmbjAAEgJtMQNmbjEADQJtMQNmbjIAEQJtMgNmbjMAAwVleHRyYQVpc0pJVAAAAm0yBHRhZzUEAA4CbTIEdGFnNgQAEgJtMAR0YWc3BAAPAm0xBHRhZzgEAA0CbTIEdGFnOQQADgJtMAV0YWcxMAQADwJtMAV0YWcxMQQAEgJtMQV0YWcxMgQADwJtMgdnbG9iYWwwA38BAm0xB2dsb2JhbDEDfAECbTIHZ2xvYmFsMgN/AQJtMAdnbG9iYWwzA30BAm0wB2dsb2JhbDQDfgECbTAHZ2xvYmFsNQN+AQJtMQdnbG9iYWw2A30BAm0yB2dsb2JhbDcDcAECbTEHZ2xvYmFsOANvAQJtMQZ0YWJsZTABbwEw2wICbTEGdGFibGUxAXAAJQJtMAZ0YWJsZTIBbwEzlAICbTEGdGFibGUzAW8ATQJtMAZ0YWJsZTQBbwA7AwMCDRIEFgVvAFhvARTTBm8BE6kGcABObwFNygYNFwsADwAOAAYADQAOAAwADQAJAA0ABgANBl4KfQFDC0JCjAt8AUTD6W+dAQahrQt+AULEAAt/AUHfAAt8AESAU9orGbwSsgt/AUEBC30BQ0MnTH8LfgFC7ZHWnwwLfwFBxwALewH9DIFrswgU3AOrzNvkUWHqRLwLB74BFQR0YWczBAcIZ2xvYmFsMTYDEgR0YWcwBAIDZm41AAYEdGFnMgQGBnRhYmxlOAEIBnRhYmxlNwEHB21lbW9yeTECAAhnbG9iYWwxNQMRBHRhZzEEBQNmbjQABQhnbG9iYWwxMQMKBHRhZzQECghnbG9iYWwxMAMJBnRhYmxlNgEGCGdsb2JhbDE0AxAGdGFibGU5AQkHZ2xvYmFsOQMACGdsb2JhbDEzAwwGdGFibGU1AQUIZ2xvYmFsMTIDCwnyAQkDAE4BBQEDAgUCAwAFAwEGBAQDAwIGBgEAAwADAQEFBAEBBQYFBgUBAwYEAgQABgACBQYFBAYEAAIBBQYGBQIFAgYGAQADBgAFAgEGAQUGBQUBAFQAAwUCAQIFBgYAAgAABQYEBAMDAgADAgEABgEBBAIAAQQCAAQGAQAFAQICAwUEAAYBAgAEAAYFBAYDAwUABgUGBgEAAQEAAAMFBAQBAgYGAwMGBgMCAUEUCwARAwIFAwYABQIAAwIGAwYCBQUCAUEeCwACAAYCCEEMCwABAQIIQSILAAECAghBEgsAAQMCCEELCwABBAIBQQELAAEFCjgCMAECfwNAIAFBAWoiAUErSQ0AQQFBBiUBAwIGAiAAQQFqIgBBJEkEAgwCCwsLJgELCwUAEAUPCwsZAwEHnzQg5BrOxgBBiscACwSuJgPYAQKQxA=='
    , importObject0);
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
})().then(() => {
  report('after');
}).catch(e => {
  report('error');
})

