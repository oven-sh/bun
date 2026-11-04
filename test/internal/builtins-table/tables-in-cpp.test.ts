import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { collectWebCoreTables } from "../../../src/codegen/builtins/collect-webcore-tables.ts";
import { Problems, type SourcedDeclaration } from "../../../src/codegen/builtins/declarations.ts";
import * as b from "../../../src/codegen/builtins/lib.ts";

const globalObject = `#include "JSThing.h"
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(Thing);
`;
const globalTable = `@begin bunGlobalObjectTable
  Thing                           ThingConstructorCallback                             PropertyCallback
@end
`;

const thing = (bodies: string, rows: string) => `
const ClassInfo JSThingPrototype::s_info = { "Thing"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSThingPrototype) };
const ClassInfo JSThing::s_info = { "Thing"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSThing) };
static const HashTableValue JSThingPrototypeTableValues[] = {
${rows}
};
void JSThingPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, JSThing::info(), JSThingPrototypeTableValues, *this);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}
${bodies}
`;

const operation = (name: string, body: string) => `
static inline JSC::EncodedJSValue jsThingPrototypeFunction_${name}Body(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSThing>::ClassParameter castedThis)
{
${body}
}
JSC_DEFINE_HOST_FUNCTION(jsThingPrototypeFunction_${name}, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSThing>::call<jsThingPrototypeFunction_${name}Body>(*lexicalGlobalObject, *callFrame, "${name}");
}`;
const row = (name: string) =>
  `    { "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsThingPrototypeFunction_${name}, 1 } },`;

const written: SourcedDeclaration[] = b
  .class("Thing", {})
  .map(declaration => ({
    declaration,
    source: { file: "thing.builtins.ts", line: null, origin: "Host", proof: "HandWritten" },
  }));

function collect(files: Record<string, string>, handWritten: readonly SourcedDeclaration[] = written) {
  using dir = tempDir("tables-in-cpp", {
    "src/jsc/bindings/ZigGlobalObject.cpp": globalObject,
    "src/jsc/bindings/ZigGlobalObject.lut.txt": globalTable,
    ...files,
  });
  const problems = new Problems();
  const { declarations, leftUndescribed } = collectWebCoreTables(String(dir), handWritten, problems);
  const results = Object.fromEntries(
    declarations.flatMap(({ declaration, source }) =>
      declaration.declares === "Member"
        ? [
            [
              declaration.path,
              declaration.signatures.length === 0
                ? "listed"
                : `${source.proof}: ${JSON.stringify(declaration.signatures[0].result)}`,
            ],
          ]
        : [],
    ),
  );
  return { results, leftUndescribed, problems: problems.lines };
}

test("a member answers what every return of its body makes", () => {
  const { results, leftUndescribed, problems } = collect({
    "src/jsc/bindings/webcore/JSThing.cpp": thing(
      operation(
        "has",
        `    if (callFrame->argumentCount() < 1) [[unlikely]]
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
    RELEASE_AND_RETURN(throwScope, JSValue::encode(toJS<IDLBoolean>(*lexicalGlobalObject, throwScope, impl.has(WTF::move(name)))));`,
      ) +
        operation(
          "name",
          `    RELEASE_AND_RETURN(throwScope, JSValue::encode(toJS<IDLNullable<IDLUSVString>>(*lexicalGlobalObject, throwScope, impl.name())));`,
        ),
      [row("has"), row("name")].join("\n"),
    ),
  });
  expect(problems).toEqual([]);
  expect(leftUndescribed).toEqual([]);
  expect(results["Thing.prototype.has"]).toBe(`ByConstruction: ${JSON.stringify(b.bool.spec)}`);
  expect(results["Thing.prototype.name"]).toBe(
    `ByConstruction: ${JSON.stringify(b.union(b.string, b.strictNull).spec)}`,
  );
});

test("one return that is not read leaves the member listed and undescribed", () => {
  const { results, leftUndescribed, problems } = collect({
    "src/jsc/bindings/webcore/JSThing.cpp": thing(
      operation(
        "all",
        `    if (impl.isEmpty())
        return JSValue::encode(jsUndefined());
    return JSValue::encode(result);`,
      ) +
        operation(
          "any",
          `    RELEASE_AND_RETURN(throwScope, JSValue::encode(toJS<IDLAny>(*lexicalGlobalObject, throwScope, impl.any())));`,
        ),
      [row("all"), row("any")].join("\n"),
    ),
  });
  expect(problems).toEqual([]);
  expect(leftUndescribed).toEqual(["Thing.prototype.all", "Thing.prototype.any"]);
  expect(results["Thing.prototype.all"]).toBe("listed");
  expect(results["Thing.prototype.any"]).toBe("listed");
});

test("a row written by hand wins", () => {
  const byHand = b
    .method("Thing.prototype.has", { returns: b.any, capability: "js", throws: true, implementation: b.generic })
    .map((declaration): SourcedDeclaration => ({ declaration, source: written[0].source }));
  const { results } = collect(
    {
      "src/jsc/bindings/webcore/JSThing.cpp": thing(
        operation(
          "has",
          `    RELEASE_AND_RETURN(throwScope, JSValue::encode(toJS<IDLBoolean>(*lexicalGlobalObject, throwScope, impl.has())));`,
        ),
        row("has"),
      ),
    },
    [...written, ...byHand],
  );
  expect(Object.keys(results)).toEqual(["Thing.prototype.@@toStringTag"]);
});

test("a table that nobody reads stops the generator", () => {
  const files = { "src/jsc/bindings/webcore/JSThing.cpp": thing("", "") };
  expect(collect(files).problems).toEqual([]);
  const { problems } = collect({
    ...files,
    "src/jsc/bindings/webcore/JSStray.cpp": `static const HashTableValue JSStrayPrototypeTableValues[] = {\n};\n`,
  });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("nobody reads JSStrayPrototypeTableValues");
});
