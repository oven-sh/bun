import { expect, test } from "bun:test";
import type { MemberDeclaration, SourcedDeclaration } from "../../../src/codegen/builtins/declarations.ts";
import * as b from "../../../src/codegen/builtins/lib.ts";
import { engineFile } from "../../../src/codegen/engine-directory.ts";

const {
  declareFormsInRanges,
}: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/forms-in-ranges.ts") =
  await import(engineFile("builtins/generator/forms-in-ranges.ts"));

const source = { file: "x.builtins.ts", line: null, origin: "Host", proof: "HandWritten" } as const;
const sourced = (declarations: readonly unknown[]) =>
  declarations.map(declaration => ({ declaration, source })) as SourcedDeclaration[];

const view = b.union(b.instance("TypedArray"), b.instance("DataView"));
const entry = b.typedEntry({
  calls: { latin1: "write8", utf16: "write16" },
  parameters: ["Characters", "Bytes"],
  returnsFields: ["read", "written"],
});

test("the entry that the generator writes picks the C function by the width of the characters", () => {
  expect(entry.symbol).toBe("AOTTyped__write8");
  expect(entry.parameters.map(({ value }) => value)).toEqual(["Characters", "Bytes"]);
  expect(entry.returnsFields).toBe(true);
  expect(entry.declaration).toBe(
    [
      'extern "C" SYSV_ABI JSC::AOT::BuiltinDirectFields AOTTyped__write8(const uint8_t* p0, size_t p0Count, uint8_t* p1, size_t p1Count)',
      "{",
      "    auto answer = reinterpret_cast<uintptr_t>(p0) & JSC::AOT::wideCharactersBit ? write16(reinterpret_cast<const char16_t*>(reinterpret_cast<uintptr_t>(p0) & ~JSC::AOT::wideCharactersBit), p0Count, p1, p1Count) : write8(reinterpret_cast<const Latin1Character*>(p0), p0Count, p1, p1Count);",
      "    return { answer.read, answer.written };",
      "}",
    ].join("\n"),
  );
});

test("a row whose native code takes bytes is declared once more for parts of views", () => {
  const row = b.fn("Writer.write", {
    args: { text: b.string, into: view },
    returns: b.ordinaryObjectOf("ReadAndWrittenCounts").fresh,
    capability: "heap",
    uses: { text: [b.readAsCharacters], into: [b.readsContents(), b.writesContents()] },
    implementation: b.hostCall,
    directEntry: entry,
  });
  const derived = declareFormsInRanges(sourced(row));
  expect(derived).toHaveLength(1);
  const helper = derived[0].declaration as MemberDeclaration;
  expect(helper.path).toBe("%CompilerHelpers%.Writer_write_inRanges");
  const [signature] = helper.signatures;
  expect(signature.parameters.map(({ name }) => name)).toEqual(["text", "into", "startOfView0", "endOfView0"]);
  expect(signature.directEntry!.symbol).toBe(entry.symbol);
  expect(signature.directEntry!.parameters.map(({ value }) => value)).toEqual(["Characters", "BytesInRange"]);
  expect(signature.uses).toEqual({
    text: [b.readAsCharacters],
    into: [b.readsContents(), b.writesContents()],
    startOfView0: [],
    endOfView0: [],
  });
});

test("a row without bytes is not", () => {
  const row = b.fn("Writer.flush", { args: {}, returns: b.undefined, capability: "none", implementation: b.hostCall });
  expect(declareFormsInRanges(sourced(row))).toEqual([]);
});
