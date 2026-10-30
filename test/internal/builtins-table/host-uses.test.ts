import { expect, test } from "bun:test";
import { checkHostUses } from "../../../src/codegen/builtins/check-host-uses.ts";
import { Problems } from "../../../src/codegen/builtins/declarations.ts";
import * as b from "../../../src/codegen/builtins/lib.ts";
import type {
  ModelBuiltin,
  ModelCalledFunction,
  ModelHostCall,
  ModelHostObject,
  ModelHostUse,
  ModelHostValue,
  ModelModuleLoad,
  ModelName,
  ModelOverload,
  ModelType,
  TableModel,
} from "../../../src/codegen/builtins/model.ts";

type CheckedModel = Parameters<typeof checkHostUses>[0];

const source = { file: "rows.builtins.ts", line: null, origin: "Host", proof: "HandWritten" } as const;
const names = new Map<string, ModelName>();
function nameOf(text: string): ModelName {
  let name = names.get(text);
  if (name === undefined) {
    name = { number: names.size, text, kind: "Text", cppConstant: null };
    names.set(text, name);
  }
  return name;
}

const stringType = { primitives: ["String"], integers: null, stringLiterals: [], parts: [] } as unknown as ModelType;
const neverType = { primitives: [], integers: null, stringLiterals: [], parts: [] } as unknown as ModelType;
const none: ModelHostValue = { place: "None" };
const newString: ModelHostValue = { place: "NewValue", type: stringType };
const inCell = (cell: string): ModelHostValue => ({ place: "NativeCell", cell: nameOf(cell) });

const callWith = (columns: Partial<ModelHostCall>): ModelHostCall => ({
  times: "Once",
  thisValue: none,
  arguments: [],
  otherArguments: none,
  result: [],
  ...columns,
});
const called = (columns: Partial<ModelHostCall>): ModelHostUse => ({
  path: [],
  read: "Called",
  call: callWith(columns),
});
const kept = (cell: string): ModelHostUse => ({ path: [], read: "Kept", cell: nameOf(cell) });

const overloadTaking = (argumentCount: number, calledMembers: readonly string[] = []) =>
  ({
    mode: "Call",
    flags: [],
    receiver: null,
    parameters: Array.from({ length: argumentCount }, (_, index) => ({
      operand: { operand: "Argument", index },
      calledMembers: calledMembers.map(nameOf),
    })),
    flow: { transfers: [], callbacks: [], propertyActions: [], handlerCalls: [] },
  }) as unknown as ModelOverload;

const entry = (
  text: string,
  kind: ModelBuiltin["kind"],
  columns: Partial<ModelBuiltin["attachments"]> = {},
  overloads: ModelOverload[] = [],
) =>
  ({
    text,
    kind,
    overloads,
    attachments: { moduleLoads: [], calledFunctions: [], ...columns },
  }) as unknown as ModelBuiltin;

const calling = (uses: ModelCalledFunction["uses"]): ModelCalledFunction =>
  ({ function: { file: "builtins/Streams", name: "makeStream" }, condition: null, uses }) as ModelCalledFunction;

const reading = (uses: ModelHostUse[] | null): ModelModuleLoad =>
  ({
    module: { specifier: "internal/printer" },
    exports: [{ name: nameOf("print"), uses }],
    condition: null,
  }) as ModelModuleLoad;

const hostObject = (cell: string, columns: Partial<ModelHostObject> = {}): ModelHostObject => ({
  cell: nameOf(cell),
  function: null,
  prototype: null,
  fields: [],
  internalFields: [],
  source,
  ...columns,
});

function problemsOf(columns: Partial<CheckedModel>): readonly string[] {
  const builtins = columns.builtins ?? [];
  const model: CheckedModel = {
    builtins,
    overloads: builtins.flatMap(builtin => builtin.overloads),
    startup: {
      modules: [],
      loads: [],
      functionsCalledWithLoads: [],
      namesOfMethodsCallingLoads: [],
      moduleLoaderFunctions: [],
    },
    hostObjects: [],
    namedMemberCalls: [],
    hostMethodCalls: [],
    ...columns,
  } satisfies Pick<TableModel, keyof CheckedModel>;
  const problems = new Problems();
  checkHostUses(model, problems);
  return problems.lines;
}

test("a row says what native code does with an export, a function and a result", () => {
  expect(b.exportRead("inspect", b.keptIn("Realm.inspect"))).toEqual({
    name: "inspect",
    uses: [{ read: "Kept", cell: "Realm.inspect" }],
  });
  const use = b.calledByHost({
    times: "Once",
    this: b.undefined,
    args: [b.builtin("process"), b.nativeCell("Realm.queue"), b.nativeMemory],
    result: [b.memberOfValue(0, b.isValueOf("process.stdout")), b.memberOfValue(1, b.inspectedByHost)],
  });
  expect(use).toEqual({
    read: "Called",
    call: {
      times: "Once",
      thisValue: { place: "NewValue", value: { type: "Primitive", primitive: "Undefined" } },
      arguments: [
        { place: "NewValue", value: { type: "Builtin", path: "process" } },
        { place: "NativeCell", cell: "Realm.queue" },
        { place: "NativeMemory" },
      ],
      otherArguments: undefined,
      result: [
        { read: "Member", name: 0, uses: [{ read: "IsValueOf", builtin: "process.stdout" }] },
        { read: "Member", name: 1, uses: [{ read: "Inspected" }] },
      ],
    },
  });
});

test("a call without a list of arguments or of uses leaves them open, and b.dropped closes the result", () => {
  const open = b.calledByHost({ times: "Later" });
  expect(open).toMatchObject({ read: "Called", call: { arguments: undefined, result: undefined } });
  expect(b.calledByHost({ times: "Later", args: [], result: b.dropped })).toMatchObject({
    call: { arguments: [], result: [] },
  });
});

test("where no call of a built-in is under way there is no operand to name", () => {
  expect(() => b.calledByHost({ times: "Once", args: [b.operand("options")] })).toThrow(
    "Operand: where no call of a built-in is under way",
  );
  expect(() => b.calledByHost({ times: "Once", this: b.result })).toThrow("Result: where no call");
  expect(() => b.hostObject("Realm.options", { fields: { depth: b.ownValues("options") } })).toThrow(
    "OwnValues: where no call",
  );
  expect(() => b.namedMemberCall("print", [b.slot("this", "element")])).toThrow("Slot: where no call");
});

test("a field of a host object lists everything that may be put there", () => {
  expect(
    b.hostObject("Realm.options", { fields: { stylize: [b.nativeCell("A"), b.nativeCell("B")], depth: b.f64 } }),
  ).toEqual([
    {
      declares: "HostObject",
      cell: "Realm.options",
      function: null,
      prototype: "Object.prototype",
      fields: [
        {
          name: "stylize",
          values: [
            { place: "NativeCell", cell: "A" },
            { place: "NativeCell", cell: "B" },
          ],
        },
        { name: "depth", values: [{ place: "NewValue", value: { type: "Primitive", primitive: "Number" } }] },
      ],
      internalFields: [],
      keepsStringsOfStoredValues: false,
    },
  ]);
});

test("a host object says what lies under the names that it does not list, and that it keeps strings of what is stored", () => {
  expect(
    b.hostObject("Realm.variables", {
      fields: { count: b.f64 },
      otherNames: b.string,
      keepsStringsOfStoredValues: true,
    }),
  ).toEqual([
    {
      declares: "HostObject",
      cell: "Realm.variables",
      function: null,
      prototype: "Object.prototype",
      fields: [
        { name: "count", values: [{ place: "NewValue", value: { type: "Primitive", primitive: "Number" } }] },
        { name: null, values: [{ place: "NewValue", value: { type: "Primitive", primitive: "String" } }] },
      ],
      internalFields: [],
      keepsStringsOfStoredValues: true,
    },
  ]);
});

test("a function that native code hands over is an entry of its own, which no spelling in the library names", () => {
  const [binding, member, object] = b.hostFunction("Realm.drain", "Realm.cpp", "drainQueue", {
    returns: b.undefined,
    capability: "js",
    implementation: b.hostCall,
  });
  expect(binding).toMatchObject({
    declares: "NativeBinding",
    file: "Realm.cpp",
    symbol: "drainQueue",
    hostNumber: null,
    answersFunction: true,
    isHandedByNativeCode: true,
  });
  expect(member).toMatchObject({ declares: "Member", path: "native:NewCppFunction:Realm.cpp:drainQueue" });
  expect(object).toMatchObject({
    declares: "HostObject",
    cell: "Realm.drain",
    function: "%NativeFunctions%.RealmCppDrainQueue",
    prototype: "Function.prototype",
  });
});

test("rows that name what is there are taken", () => {
  const stream = entry("process.stdout", "DataProperty");
  const serve = entry("Bun.serve", "Function", {}, [overloadTaking(1, ["print"])]);
  const user = entry("process.stdout", "DataProperty", {
    moduleLoads: [reading([kept("Realm.print"), { path: [], read: "PassedTo", builtin: serve, argument: 0 }])],
    calledFunctions: [
      calling([
        called({
          thisValue: newString,
          arguments: [inCell("Realm.print"), inCell("Realm.options")],
          result: [
            { path: [nameOf("0")], read: "IsValueOf", builtin: stream },
            called({ arguments: null, result: null }),
          ],
        }),
      ]),
      calling(null),
    ],
  });
  expect(
    problemsOf({
      builtins: [user, serve],
      hostObjects: [hostObject("Realm.options", { fields: [{ name: nameOf("print"), value: inCell("Realm.print") }] })],
      namedMemberCalls: [{ name: nameOf("print"), arguments: [inCell("Realm.options")], source }],
    }),
  ).toEqual([]);
});

test("a native cell that is read is written by something", () => {
  const row = "process.stdout uses makeStream of builtins/Streams";
  const nothingPuts = (cell: string) =>
    `nothing puts a value into the native cell ${cell}: no b.keptIn, no b.hostObject and no operand of an overload`;
  const user = (uses: ModelHostUse[]) => entry("process.stdout", "DataProperty", { calledFunctions: [calling(uses)] });
  expect(problemsOf({ builtins: [user([called({ arguments: [inCell("Realm.lost")] })])] })).toEqual([
    `${row}: ${nothingPuts("Realm.lost")}`,
  ]);
  expect(problemsOf({ builtins: [user([called({ thisValue: inCell("Realm.lost") })])] })).toEqual([
    `${row}: ${nothingPuts("Realm.lost")}`,
  ]);
  expect(
    problemsOf({ builtins: [user([called({ result: [called({ arguments: [inCell("Realm.lost")] })] })])] }),
  ).toEqual([`${row}: ${nothingPuts("Realm.lost")}`]);
  expect(
    problemsOf({ builtins: [user([called({ arguments: [inCell("Realm.kept")], result: [kept("Realm.kept")] })])] }),
  ).toEqual([]);
  expect(
    problemsOf({
      hostObjects: [hostObject("Realm.options", { fields: [{ name: nameOf("print"), value: inCell("Realm.lost") }] })],
    }),
  ).toEqual([`the field print of the host object Realm.options: ${nothingPuts("Realm.lost")}`]);
});

test("a value is passed to an argument that the built-in has", () => {
  const serve = entry("Bun.serve", "Function", {}, [overloadTaking(1)]);
  const user = (argument: number) =>
    entry("Bun.plugin", "Function", {
      moduleLoads: [reading([{ path: [], read: "PassedTo", builtin: serve, argument }])],
    });
  expect(problemsOf({ builtins: [user(0)] })).toEqual([]);
  expect(problemsOf({ builtins: [user(1)] })).toEqual([
    "Bun.plugin reads print of internal/printer: it is passed to Bun.serve, and no Call overload has argument 1",
  ]);
  expect(problemsOf({ builtins: [user(-1)] })).toEqual([
    "Bun.plugin reads print of internal/printer: -1 is no index of an argument",
  ]);
});

test("only an entry that holds a value takes one", () => {
  const user = (builtin: ModelBuiltin) =>
    entry("process.stdout", "DataProperty", {
      calledFunctions: [calling([called({ result: [{ path: [], read: "IsValueOf", builtin }] })])],
    });
  for (const kind of ["Constructor", "Function", "Method", "Accessor", "DataProperty"] as const) {
    expect(problemsOf({ builtins: [user(entry("process.member", kind))] })).toEqual([]);
  }
  expect(problemsOf({ builtins: [user(entry("process", "Namespace"))] })).toEqual([
    "process.stdout uses makeStream of builtins/Streams: it is the value of process, and a Namespace holds no value that native code makes later",
  ]);
});

test("further arguments follow a list, and every value that is passed has a type", () => {
  const user = (call: Partial<ModelHostCall>) =>
    entry("process.stdout", "DataProperty", { calledFunctions: [calling([called(call)])] });
  const row = "process.stdout uses makeStream of builtins/Streams";
  expect(problemsOf({ builtins: [user({ arguments: null, otherArguments: newString })] })).toEqual([
    `${row}: otherArgs follows a list of arguments, and the call has none`,
  ]);
  expect(problemsOf({ builtins: [user({ arguments: [{ place: "NewValue", type: neverType }] })] })).toEqual([
    `${row}: native code passes a value that has no type`,
  ]);
});

test("the records of start-up are checked as those of an entry are", () => {
  const startup = {
    modules: [],
    loads: [reading([called({ arguments: [inCell("Realm.lost")] })])],
    functionsCalledWithLoads: [calling([called({ thisValue: inCell("Realm.gone") })])],
    namesOfMethodsCallingLoads: [],
    moduleLoaderFunctions: [],
  };
  expect(problemsOf({ startup }).map(line => line.split(":")[0])).toEqual([
    "start-up reads print of internal/printer",
    "start-up uses makeStream of builtins/Streams",
  ]);
});

test("a host object has a cell and internal fields of its own", () => {
  expect(problemsOf({ hostObjects: [hostObject("Realm.queue"), hostObject("Realm.queue")] })).toEqual([
    "rows.builtins.ts: two host objects lie in the native cell Realm.queue",
  ]);
  const fields = (...indexes: number[]) =>
    hostObject("Realm.queue", { internalFields: indexes.map(index => ({ index, uses: [] })) });
  expect(problemsOf({ hostObjects: [fields(0, 2)] })).toEqual([]);
  expect(problemsOf({ hostObjects: [fields(2, 2)] })).toEqual([
    "rows.builtins.ts: the host object Realm.queue lists internal field 2 twice",
  ]);
  expect(problemsOf({ hostObjects: [fields(256)] })).toEqual([
    "rows.builtins.ts: the host object Realm.queue: 256 is no index of an internal field",
  ]);
  expect(
    problemsOf({
      hostObjects: [
        hostObject("Realm.queue", {
          internalFields: [{ index: 2, uses: [called({ arguments: [inCell("Realm.lost")] })] }],
        }),
      ],
    })[0],
  ).toStartWith(
    "internal field 2 of the host object Realm.queue: nothing puts a value into the native cell Realm.lost",
  );
});

test("a host object that is a function has an entry that says what a call does", () => {
  const described = entry("%NativeFunctions%.RealmCppDrainQueue", "Function", {}, [overloadTaking(0)]);
  const undeclared = entry("%NativeFunctions%.RealmCppOther", "Function", {}, [
    { ...overloadTaking(0), flags: ["IsUndeclared"] } as ModelOverload,
  ]);
  expect(problemsOf({ hostObjects: [hostObject("Realm.drain", { function: described })] })).toEqual([]);
  expect(problemsOf({ hostObjects: [hostObject("Realm.drain", { function: undeclared })] })).toEqual([
    "rows.builtins.ts: the host object Realm.drain is a function, and %NativeFunctions%.RealmCppOther has no Call overload that says what a call does",
  ]);
});

test("a member that native code calls by name is called by some operand's protocol, and described once", () => {
  const printer = entry("console.log", "Function", {}, [overloadTaking(1, ["print"])]);
  const call = { name: nameOf("print"), arguments: [newString], source };
  expect(problemsOf({ builtins: [printer], namedMemberCalls: [call] })).toEqual([]);
  expect(problemsOf({ builtins: [printer], namedMemberCalls: [call, call] })).toEqual([
    "rows.builtins.ts: two rows say what native code passes to a member named print",
  ]);
  expect(problemsOf({ namedMemberCalls: [call] })).toEqual([
    'rows.builtins.ts: no operand has b.calls("print"), so nothing calls a member of that name',
  ]);
});

test("a host method that calls what is kept goes by a name that start-up lists", () => {
  const startup = (...listed: string[]) => ({
    modules: [],
    loads: [reading([kept("Realm.print")])],
    functionsCalledWithLoads: [],
    namesOfMethodsCallingLoads: listed.map(nameOf),
    moduleLoaderFunctions: [],
  });
  const method = (cell: string) => ({
    name: nameOf("print"),
    cell: nameOf(cell),
    call: callWith({ arguments: [newString] }),
    source,
  });
  expect(problemsOf({ startup: startup("print"), hostMethodCalls: [method("Realm.print")] })).toEqual([]);
  expect(problemsOf({ startup: startup(), hostMethodCalls: [method("Realm.print")] })).toEqual([
    "rows.builtins.ts: print is not among namesOfMethodsCallingLoads of b.startup, so nothing says that the host has methods of that name",
  ]);
  expect(problemsOf({ startup: startup("print"), hostMethodCalls: [method("Realm.lost")] })[0]).toStartWith(
    "a host method named print: nothing puts a value into the native cell Realm.lost",
  );
});
