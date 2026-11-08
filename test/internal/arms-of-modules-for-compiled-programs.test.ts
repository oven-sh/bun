// A module of src/js may hold an arm behind IS_COMPILED_AHEAD_OF_TIME, or behind another constant that `bun compile` replaces: `bun run`
// evaluates one side and a compiled program the other.
// The two must answer alike, and what `bun run` evaluates must be what it evaluated before the arm was written.
// So each arm names a program of test/aot/parallel/arms-of-the-library that reaches it: there a compiled program is held against `bun run`.
// An arm that only a compiled test run takes names a test of test/aot instead.
// Where the two sides part today the program says so in a `// Todo:`, which fails once they agree.
// The second texts under src/js/ahead-of-time are read by the compiler alone: second-texts-of-modules.test.ts holds those. A second text that
// is listed here was the only text of its module when its arms were written: their rows went with it.
import { Glob } from "bun";
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const modules = join(import.meta.dir, "../../src/js");
const tests = join(import.meta.dir, "../aot");
const constants = [
  ...readFileSync(join(modules, "../codegen/replacements.ts"), "utf8")
    .replaceAll("\r\n", "\n")
    .matchAll(/\/\/ `bun compile` replaces the value.*\n((?: *"[A-Z_]+": "(?:true|false)",\n)+)/g),
].flatMap(([, lines]) => [...lines.matchAll(/"([A-Z_]+)":/g)].map(([, name]) => name));
const namesConstant = new RegExp("\\b(?:" + constants.join("|") + ")\\b");
const arm = (program: string) => "parallel/arms-of-the-library/" + program;
const callsOfLibrary = "the-library-calls-the-same-built-ins-compiled-as-plain.test.ts";

// The line of the arm as it is written, without the blanks around it, and what reaches it. A line that stands twice in a file is listed twice.
const witnessed: Record<string, [line: string, witness: string][]> = {
  "ahead-of-time/builtins/ProcessObjectInternals.ts": [
    [
      "if (!IS_COMPILED_AHEAD_OF_TIME || WARNINGS_ASK_NODE_PATH) {",
      "parallel/what-a-warning-brings/the-program-replaces-basename.js",
    ],
  ],
  "ahead-of-time/internal/process/next_tick_queue.ts": [
    [
      'if (CAN_LOAD_CODE_AT_RUN_TIME) require("node:async_hooks");',
      "parallel/code-from-disk-beside-the-compiled-library/it-hooks-the-ticks-of-the-program.cjs",
    ],
    [
      '((IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(process, "nextTick")) ||',
      "parallel/a-member-of-a-built-in-as-built/it-is-stored-over.mjs",
    ],
    [
      'if (IS_COMPILED_AHEAD_OF_TIME && isSetUp && $findsDeclaredMember(process, "nextTick"))',
      "parallel/a-member-of-a-built-in-as-built/it-is-stored-over.mjs",
    ],
    [
      'if (IS_COMPILED_AHEAD_OF_TIME && isSetUp && $findsDeclaredMember(process, "nextTick"))',
      "parallel/a-member-of-a-built-in-as-built/it-is-stored-over.mjs",
    ],
    [
      'if (IS_COMPILED_AHEAD_OF_TIME && isSetUp && $findsDeclaredMember(process, "nextTick"))',
      "parallel/a-member-of-a-built-in-as-built/it-is-stored-over.mjs",
    ],
  ],
  "ahead-of-time/internal/process/tick_ring.ts": [
    ["IS_COMPILED_AHEAD_OF_TIME && CAN_REPLACE_BUILT_INS", callsOfLibrary],
    ["IS_COMPILED_AHEAD_OF_TIME && CAN_REPLACE_BUILT_INS", callsOfLibrary],
    ["if (!(IS_COMPILED_AHEAD_OF_TIME && CAN_REPLACE_BUILT_INS))", callsOfLibrary],
    ["if (!(IS_COMPILED_AHEAD_OF_TIME && CAN_REPLACE_BUILT_INS))", callsOfLibrary],
    [
      "for (let i = 0; i < (IS_COMPILED_AHEAD_OF_TIME && CAN_REPLACE_BUILT_INS ? hooks.length : count); i++) {",
      "parallel-test-runs/arms-of-the-library/a-slice-that-answers-another-list-under-a-tick/a_test.ts",
    ],
    [
      "for (let i = 0; i < (IS_COMPILED_AHEAD_OF_TIME && CAN_REPLACE_BUILT_INS ? hooks.length : count); i++) {",
      "parallel-test-runs/arms-of-the-library/a-slice-that-answers-another-list-under-a-tick/a_test.ts",
    ],
  ],
  "ahead-of-time/internal/streams/end-of-stream.ts": [
    [
      '!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(stream as unknown as $Node.Stream, "on")) &&',
      arm("finished-is-asked-of-streams-of-node-and-of-the-web.cjs"),
    ],
    [
      "if (IS_COMPILED_AHEAD_OF_TIME && options !== sideOfHeir) own = kindOfOwnStream(stream);",
      "parallel/the-end-of-a-stream-is-awaited-while-the-stream-is-changed/a-readable-whose-pipe-is-taken-away.mjs",
    ],
    [
      "IS_COMPILED_AHEAD_OF_TIME &&",
      "parallel/the-end-of-a-stream-is-awaited-while-the-stream-is-changed/the-requests-of-a-server-are-of-an-heir-that-counts-reads-of-pipe.mjs",
    ],
    [
      "!CAN_REPLACE_BUILT_INS &&",
      "parallel/the-end-of-a-stream-is-awaited-while-the-stream-is-changed/the-requests-of-a-server-are-of-an-heir-that-counts-reads-of-pipe.mjs",
    ],
    [
      "IS_COMPILED_AHEAD_OF_TIME && own !== Own.Unknown",
      "parallel/the-end-of-a-stream-is-awaited-while-the-stream-is-changed/the-requests-of-a-server-are-of-an-heir-that-counts-reads-of-pipe.mjs",
    ],
    [
      ": ((IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS && options === sideOfHeir",
      "parallel/the-end-of-a-stream-is-awaited-while-the-stream-is-changed/the-requests-of-a-server-are-of-an-heir-that-counts-reads-of-pipe.mjs",
    ],
  ],
  "ahead-of-time/internal/streams/pipeline.ts": [
    [
      "return IS_COMPILED_AHEAD_OF_TIME &&",
      "parallel/streams-ask-what-plain-bun-asks/the-controller-of-a-pipeline-is-made-asked-and-aborted.mjs",
    ],
    [
      "!CAN_REPLACE_BUILT_IN_FUNCTIONS &&",
      "parallel/streams-ask-what-plain-bun-asks/the-controller-of-a-pipeline-is-made-asked-and-aborted.mjs",
    ],
    [
      "return IS_COMPILED_AHEAD_OF_TIME &&",
      "parallel/streams-ask-what-plain-bun-asks/the-controller-of-a-pipeline-is-made-asked-and-aborted.mjs",
    ],
    [
      "!CAN_REPLACE_BUILT_IN_FUNCTIONS &&",
      "parallel/streams-ask-what-plain-bun-asks/the-controller-of-a-pipeline-is-made-asked-and-aborted.mjs",
    ],
    ["IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS", arm("a-pipeline-ends-each-way-on-each-of-its-sides.cjs")],
    ["IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS", arm("a-pipeline-ends-each-way-on-each-of-its-sides.cjs")],
    ["IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS", arm("a-pipeline-ends-each-way-on-each-of-its-sides.cjs")],
    [
      "IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS && (reading || writing)",
      arm("a-pipeline-ends-each-way-on-each-of-its-sides.cjs"),
    ],
    [
      "IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS ? readableSide! : { readable: true, writable: false },",
      arm("a-pipeline-ends-each-way-on-each-of-its-sides.cjs"),
    ],
    [
      "IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS ? writableSide! : { readable: false, writable: true },",
      arm("a-pipeline-ends-each-way-on-each-of-its-sides.cjs"),
    ],
  ],
  "ahead-of-time/internal/streams/readable.ts": [
    [
      "if (!(IS_COMPILED_AHEAD_OF_TIME && $isPlainHeirOf(this, Readable)) && !(this instanceof Readable)) {",
      "parallel/streams-ask-what-plain-bun-asks/what-a-readable-asks-of-its-state-its-chunks-and-itself.mjs",
    ],
    [
      "if (CAN_REPLACE_BUILT_IN_FUNCTIONS) internals.keptDefinitions[0]();",
      "a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads.test.ts",
    ],
    [
      "if (CAN_REPLACE_BUILT_IN_FUNCTIONS) internals.keptDefinitions[1]();",
      "a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads.test.ts",
    ],
    [
      "const kShapeMode: typeof shared.kShapeMode = IS_COMPILED_AHEAD_OF_TIME ? shared.kShapeMode : (undefined as never);",
      "parallel/a-readable-is-born-below-what-the-program-has-laid/the-options-are-asked-as-often.cjs",
    ],
    [
      "const kCapture: typeof shared.kCapture = IS_COMPILED_AHEAD_OF_TIME ? shared.kCapture : (undefined as never);",
      "parallel/a-readable-is-born-below-what-the-program-has-laid/emitters-capture-rejections.cjs",
    ],
    [
      "const EventEmitterPrototype: $Node.EventEmitterPrototype = IS_COMPILED_AHEAD_OF_TIME",
      "parallel/a-readable-is-born-below-what-the-program-has-laid/emitters-capture-rejections.cjs",
    ],
    [
      "if (IS_COMPILED_AHEAD_OF_TIME) {",
      "parallel/a-readable-is-born-below-what-the-program-has-laid/a-signal-that-has-aborted-lets-the-program-lay-the-name-on-the-stream-itself.cjs",
    ],
    [
      "IS_COMPILED_AHEAD_OF_TIME &&",
      "parallel/a-readable-is-born-below-what-the-program-has-laid/nothing-as-a-value-under-the-name-on-the-prototype-of-readable.cjs",
    ],
    [
      "if (IS_COMPILED_AHEAD_OF_TIME) {",
      "parallel/what-a-program-stores-into-the-table-of-listeners/each-name-that-the-end-of-a-request-looks-under.cjs",
    ],
    ["IS_COMPILED_AHEAD_OF_TIME &&", arm("a-readable-that-has-ended-is-asked-for-its-writable-side.cjs")],
    ["if (IS_COMPILED_AHEAD_OF_TIME) {", arm("read-is-asked-for-every-kind-of-amount.cjs")],
    ["const finishRead = IS_COMPILED_AHEAD_OF_TIME", arm("how-often-read-stands-on-the-stack-where-it-calls-out.cjs")],
    [
      'if (IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(Number, "isNaN") && internals.isPlainReadableState!(state)) {',
      arm("what-the-program-sees-of-a-readable-from-inside-every-call-that-read-makes.cjs"),
    ],
    [
      "if (IS_COMPILED_AHEAD_OF_TIME) internals.isPlainReadableAlone = isPlainReadableAlone;",
      "parallel/the-end-of-a-stream-is-awaited-while-the-stream-is-changed/a-readable-whose-pipe-is-taken-away.mjs",
    ],
  ],
  "ahead-of-time/internal/streams/state.ts": [
    [
      "if (CAN_REPLACE_BUILT_IN_FUNCTIONS) {",
      "a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads.test.ts",
    ],
    [
      "const definePropertiesWhereBunRunDoes: typeof ObjectDefineProperties = CAN_REPLACE_BUILT_IN_FUNCTIONS",
      "a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads.test.ts",
    ],
    [
      "const definePropertyWhereBunRunDoes: typeof ObjectDefineProperty = CAN_REPLACE_BUILT_IN_FUNCTIONS",
      "a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads.test.ts",
    ],
    [
      'if (CAN_LOAD_CODE_AT_RUN_TIME) require("node:stream");',
      "parallel/code-from-disk-beside-the-compiled-library/it-asks-node-stream-for-every-kind-of-stream.cjs",
    ],
    [
      "const oneObject = IS_COMPILED_AHEAD_OF_TIME ? { objectMode: true, highWaterMark: 1 } : undefined;",
      "parallel/how-often-the-flags-of-a-state-are-asked/while-from-makes-a-readable.cjs",
    ],
    [
      'const kGivenHighWaterMark = IS_COMPILED_AHEAD_OF_TIME ? Symbol("kGivenHighWaterMark") : undefined;',
      "parallel/how-often-the-flags-of-a-state-are-asked/while-a-server-makes-the-state-of-a-request.cjs",
    ],
    [
      "IS_COMPILED_AHEAD_OF_TIME &&",
      "parallel/how-often-the-flags-of-a-state-are-asked/while-from-makes-a-readable.cjs",
    ],
    [
      "if (IS_COMPILED_AHEAD_OF_TIME && options === kGivenHighWaterMark) {",
      "parallel/how-often-the-flags-of-a-state-are-asked/while-a-server-makes-the-state-of-a-request.cjs",
    ],
    [
      "if (IS_COMPILED_AHEAD_OF_TIME) internals.isPlainReadableState = isPlainReadableState;",
      "parallel/how-often-the-flags-of-a-state-are-asked/the-length-of-a-state-pauses-the-stream-amid-a-push.cjs",
    ],
    [
      "if (IS_COMPILED_AHEAD_OF_TIME) internals.oneObject = oneObject;",
      "parallel/how-often-the-flags-of-a-state-are-asked/while-from-makes-a-readable.cjs",
    ],
    [
      "if (IS_COMPILED_AHEAD_OF_TIME) internals.readableSideOfHeir = { writable: false };",
      "parallel/what-a-stream-asks-in-plains-number/read-of-a-readable-in-a-for-await.cjs",
    ],
    [
      "if (IS_COMPILED_AHEAD_OF_TIME && highWaterMark != null)",
      "parallel/how-often-the-flags-of-a-state-are-asked/while-a-server-makes-the-state-of-a-request.cjs",
    ],
    [
      "if (IS_COMPILED_AHEAD_OF_TIME && !$isPrototypeChainPlain(ReadableState)) {",
      "parallel/how-often-the-flags-of-a-state-are-asked/while-a-server-makes-the-state-of-a-request-on-a-kept-connection.cjs",
    ],
    [
      "readingMore: IS_COMPILED_AHEAD_OF_TIME",
      "parallel/node-http/what-lies-under-reading-more-of-the-state-of-a-request-takes-the-store.cjs",
    ],
  ],
  "ahead-of-time/internal/util/inspect.ts": [
    [
      "const ObjectPrototypeIsPrototypeOf = IS_COMPILED_AHEAD_OF_TIME ? Object.prototype.isPrototypeOf : undefined;",
      arm("what-stands-below-the-prototype-of-functions-is-printed.cjs"),
    ],
    [
      "if (!IS_COMPILED_AHEAD_OF_TIME) wellKnownFunction = Function;",
      arm("what-stands-below-the-prototype-of-functions-is-printed.cjs"),
    ],
    ["? IS_COMPILED_AHEAD_OF_TIME", arm("what-stands-below-the-prototype-of-functions-is-printed.cjs")],
  ],
  "ahead-of-time/node/fs.ts": [
    ["appendFileSync = IS_COMPILED_AHEAD_OF_TIME", arm("the-functions-of-node-fs-that-node-net-calls.mjs")],
    ["closeSync = IS_COMPILED_AHEAD_OF_TIME", arm("the-functions-of-node-fs-that-node-net-calls.mjs")],
    ["chmodSync = IS_COMPILED_AHEAD_OF_TIME", arm("the-functions-of-node-fs-that-node-net-calls.mjs")],
    ["fstatSync = IS_COMPILED_AHEAD_OF_TIME", arm("the-functions-of-node-fs-that-node-net-calls.mjs")],
    ["statSync = IS_COMPILED_AHEAD_OF_TIME", arm("the-functions-of-node-fs-that-node-net-calls.mjs")],
    [
      "return IS_COMPILED_AHEAD_OF_TIME ? fs.existsSync(_path) : fs.existsSync.$apply(fs, arguments);",
      arm("exists-sync-with-no-operand-and-with-two.mjs"),
    ],
  ],
  "ahead-of-time/node/path.ts": [
    [
      'if (CAN_REPLACE_BUILT_IN_FUNCTIONS) require("internal/validators");',
      "a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads.test.ts",
    ],
    [
      "IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS",
      "parallel-test-runs/arms-of-the-library/the-first-matches-glob-loads-the-validators/a_test.js",
    ],
  ],
  "ahead-of-time/internal/fs/streams.ts": [
    [
      'if (CAN_REPLACE_BUILT_IN_FUNCTIONS) require("node:fs/promises");',
      "a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads.test.ts",
    ],
  ],
  "ahead-of-time/node/net.ts": [
    [
      "if (IS_COMPILED_AHEAD_OF_TIME) netSymbols.resumeOfSocket = resumeOfSocket;",
      arm("a-getter-under-resume-above-the-prototype-of-sockets.cjs"),
    ],
    [
      "const bunTlsSymbol: typeof netSymbols.bunTlsSymbol = CAN_REPLACE_BUILT_IN_FUNCTIONS",
      "a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads.test.ts",
    ],
    [
      "const bunSocketServerOptions: typeof netSymbols.bunSocketServerOptions = CAN_REPLACE_BUILT_IN_FUNCTIONS",
      "a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads.test.ts",
    ],
    [
      "const kNativeSecureContextCtor: typeof netSymbols.kNativeSecureContextCtor = CAN_REPLACE_BUILT_IN_FUNCTIONS",
      "a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads.test.ts",
    ],
    [
      "CAN_REPLACE_BUILT_IN_FUNCTIONS",
      "a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads.test.ts",
    ],
  ],
  "ahead-of-time/node/http2.ts": [
    [
      "const bunSocketServerOptions: typeof netSymbols.bunSocketServerOptions = CAN_REPLACE_BUILT_IN_FUNCTIONS",
      "a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads.test.ts",
    ],
  ],
  "ahead-of-time/node/events.ts": [
    [
      "let holder: object | null = CAN_REPLACE_BUILT_INS ? null : this;",
      arm("an-emitter-is-born-below-what-lies-under-the-name-of-the-prototype.cjs"),
    ],
  ],
};

// How many arms of a file name no program yet. A number here only goes down: whoever writes an arm brings its program.
const owed: Record<string, number> = {
  "ahead-of-time/builtins/BundlerPlugin.ts": 1,
  "ahead-of-time/builtins/CommonJS.ts": 1,
  "ahead-of-time/builtins/ProcessObjectInternals.ts": 3,
  "ahead-of-time/internal/cluster/isPrimary.ts": 2,
  "ahead-of-time/internal/fs/streams.ts": 3,
  "ahead-of-time/internal/streams/destroy.ts": 1,
  "ahead-of-time/internal/streams/end-of-stream.ts": 11,
  "internal/streams/from.ts": 2,
  "ahead-of-time/internal/streams/readable.ts": 40,
  "ahead-of-time/internal/streams/state.ts": 3,
  "ahead-of-time/internal/streams/transform.ts": 1,
  "ahead-of-time/internal/streams/utils.ts": 1,
  "ahead-of-time/node/async_hooks.ts": 6,
  "ahead-of-time/node/events.ts": 9,
  "ahead-of-time/node/http2.ts": 2,
};

test("every arm for compiled programs names a program that reaches it", () => {
  expect(constants).toContain("IS_COMPILED_AHEAD_OF_TIME");
  const withoutProgram: Record<string, number> = {};
  const gone: string[] = [];
  const files = [...new Glob("**/*.{js,ts}").scanSync({ cwd: modules })]
    .map(file => file.replaceAll("\\", "/"))
    .filter(
      file => (!file.startsWith("ahead-of-time/") || file in witnessed || file in owed) && !file.endsWith(".d.ts"),
    )
    .sort();
  for (const file of files) {
    const left = (witnessed[file] ?? []).map(([line]) => line);
    for (const written of readFileSync(join(modules, file), "utf8").split("\n")) {
      const line = written.trim();
      if (!namesConstant.test(line) || line.startsWith("//")) continue;
      const at = left.indexOf(line);
      if (at >= 0) left.splice(at, 1);
      else withoutProgram[file] = (withoutProgram[file] ?? 0) + 1;
    }
    for (const line of left) gone.push(`src/js/${file}: ${line}`);
  }
  expect(gone).toEqual([]);
  expect(withoutProgram).toEqual(owed);
});

test("what the arms name is there", () => {
  const named = new Set(Object.values(witnessed).flatMap(arms => arms.map(([, witness]) => witness)));
  expect([...named].filter(witness => !existsSync(join(tests, witness)))).toEqual([]);
});
