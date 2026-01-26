// @bun
//@ runDefaultWasm("--jitPolicyScale=0", "--useConcurrentJIT=0")
import fs from "fs";
import path from "path";
async function instantiate(filename, importObject) {
  const bytes = fs.readFileSync(path.join(import.meta.dirname, filename));
  return WebAssembly.instantiate(bytes, importObject);
}
const log = function () {};
const report = function () {};
const isJIT = callerIsBBQOrOMGCompiled;
const extra = { isJIT };
(async function () {
  let memory0 = new WebAssembly.Memory({ initial: 3947, shared: false, maximum: 6209 });
  let tag3 = new WebAssembly.Tag({ parameters: [] });
  let global0 = new WebAssembly.Global({ value: "f64", mutable: true }, 882640.3220068762);
  let global1 = new WebAssembly.Global({ value: "f32", mutable: true }, 162294.89036678328);
  let global2 = new WebAssembly.Global({ value: "f64", mutable: true }, 50173.96827009934);
  let table0 = new WebAssembly.Table({ initial: 6, element: "externref" });
  let m1 = { global0, memory0, tag3 };
  let m0 = { global1, global2 };
  let m2 = { table0 };
  let importObject0 = /** @type {Imports2} */ ({ m0, m1, m2 });
  let i0 = await instantiate("omg-osr-stack-check-2.wasm", importObject0);
  let { fn0, global3, global4, memory1, table1, table2, table3, table4, table5, table6, table7, tag0, tag1, tag2 } = /**
  @type {{
fn0: () => void,
global3: WebAssembly.Global,
global4: WebAssembly.Global,
memory1: WebAssembly.Memory,
table1: WebAssembly.Table,
table2: WebAssembly.Table,
table3: WebAssembly.Table,
table4: WebAssembly.Table,
table5: WebAssembly.Table,
table6: WebAssembly.Table,
table7: WebAssembly.Table,
tag0: WebAssembly.Tag,
tag1: WebAssembly.Tag,
tag2: WebAssembly.Tag
  }} */ (i0.instance.exports);
  table4.set(6, table7);
  table4.set(44, table1);
  global4.value = 0;
  log("calling fn0");
  report("progress");
  try {
    for (let k = 0; k < 21; k++) {
      let zzz = fn0();
      if (zzz !== undefined) {
        throw new Error("expected undefined but return value is " + zzz);
      }
    }
  } catch (e) {
    if (e instanceof WebAssembly.Exception) {
      log(e);
      if (e.stack) {
        log(e.stack);
      }
    } else if (e instanceof TypeError) {
      if (e.message === "an exported wasm function cannot contain a v128 parameter or return value") {
        log(e);
      } else {
        throw e;
      }
    } else if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {
      log(e);
    } else {
      throw e;
    }
  }
  log("calling fn0");
  report("progress");
  try {
    for (let k = 0; k < 19; k++) {
      let zzz = fn0();
      if (zzz !== undefined) {
        throw new Error("expected undefined but return value is " + zzz);
      }
    }
  } catch (e) {
    if (e instanceof WebAssembly.Exception) {
      log(e);
      if (e.stack) {
        log(e.stack);
      }
    } else if (e instanceof TypeError) {
      if (e.message === "an exported wasm function cannot contain a v128 parameter or return value") {
        log(e);
      } else {
        throw e;
      }
    } else if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {
      log(e);
    } else {
      throw e;
    }
  }
  let tables = [table0, table7, table5, table1, table4, table3, table6, table2];
  for (let table of tables) {
    for (let k = 0; k < table.length; k++) {
      table.get(k)?.toString();
    }
  }
})()
  .then(() => {
    log("after");
    report("after");
  })
  .catch(e => {
    log(e);
    log("error");
    report("error");
  });
