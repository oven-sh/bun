import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { spelledAsElsewhere } from "../../scripts/build/islands-coff.ts";

const objdump = Bun.which("llvm-objdump");

test.skipIf(objdump === null)("a name decorated Microsoft's way is spelled as the other platforms spell it, parameters too", () => {
  using dir = tempDir("islands-coff-names", {});
  const names = {
    "?promiseConstructorFuncAll@JSC@@YA_JPEAVJSGlobalObject@1@PEAVCallFrame@1@@Z": "JSC::promiseConstructorFuncAll(JSC::JSGlobalObject*, JSC::CallFrame*)",
    "?write@CloneSerializer@WebCore@@AEAA_NPEBVCryptoKey@2@@Z": "WebCore::CloneSerializer::write(WebCore::CryptoKey const*)",
    "?generator@JSC@@YAXAEAVVM@1@@Z": "JSC::generator(JSC::VM&)",
    "?takes@@YAXPEAUPlain@@W4Color@@@Z": "takes(Plain*, Color)",
    "?nothing@JSC@@YAXXZ": "JSC::nothing()",
    "not_decorated": "not_decorated",
  };
  expect(spelledAsElsewhere(objdump!, String(dir), Object.keys(names))).toEqual(Object.values(names));
});
