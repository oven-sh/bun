/**
 * scripts/webcore-copies.ts lists the upstream WebKit commits that touch a file Bun has its own copy of. The WebKit
 * upgrade routine (.claude/commands/upgrade-webkit.md) runs it, so that an upstream fix to such a file is seen. It
 * reads two git repositories: a bun checkout and a WebKit clone. Here both are a few files with the shape of the real
 * ones.
 */
import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  compareToUpstream,
  formatCopyChanges,
  listCopyChanges,
  main,
  upstreamOf,
} from "../../scripts/webcore-copies.ts";

const root = join(import.meta.dir, "..", "..");

function git(cwd: string, args: string[], stdin = "") {
  const { exitCode, stdout, stderr } = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    env: bunEnv,
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} exited with ${exitCode}: ${stderr}`);
  return stdout.toString().trim();
}

interface Commit {
  message: string;
  /** The files that the commit writes. `null` removes one. */
  files: Record<string, string | null>;
  /** A ref that stays at this commit. */
  ref?: string;
}

/**
 * Adds `commits` to `main` with one git process, which makes no use of the machine's git configuration (identity,
 * signing, hooks). The author's date is not the committer's, and the objects stay loose files.
 */
function addCommits(dir: string, commits: Commit[], parent = "") {
  const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`;
  const stream = commits.map(({ message, files, ref }, index) =>
    [
      `commit refs/heads/main\nmark :${index + 1}\n`,
      "author Test <test@example.com> 1756728000 +0000\ncommitter Test <test@example.com> 1756900800 +0000\n",
      data(message),
      index === 0 ? parent : "",
      ...Object.entries(files).map(([path, text]) =>
        text === null ? `D ${path}\n` : `M 100644 inline ${path}\n${data(text)}`,
      ),
      ref === undefined ? "" : `reset ${ref}\nfrom :${index + 1}\n`,
    ].join(""),
  );
  git(dir, ["-c", "fastimport.unpackLimit=100000", "fast-import", "--quiet"], stream.join("\n"));
}

/** A WebKit clone with `commits` on `main`. The branch `base` is the first of them. */
function clone([base, ...commits]: Commit[]) {
  const dir = tempDir("webcore-copies-webkit", {});
  git(String(dir), ["init", "--quiet", "--initial-branch=main"]);
  addCommits(String(dir), [{ ...base, ref: "refs/heads/base" }, ...commits]);
  return dir;
}

/** A bun checkout where `files` are tracked. */
function checkout(files: Record<string, string>) {
  const dir = tempDir("webcore-copies-bun", files);
  git(String(dir), ["init", "--quiet", "--initial-branch=main"]);
  git(String(dir), ["add", "--all"]);
  return dir;
}

const license = `/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 */`;

// A copy with the name of its upstream file.
const performanceObserver = (register: string, deliver: string) => `${license}
#include "config.h"
#include "PerformanceObserver.h"

namespace WebCore {

ExceptionOr<void> PerformanceObserver::observe(Init&& init)
{
    if (!m_registered) {
        ${register}
        m_registered = true;
    }
    ${deliver}
    return { };
}

} // namespace WebCore
`;
const upstreamBefore = performanceObserver(
  "protectedPerformance()->registerPerformanceObserver(*this);",
  "if (isBuffered)\n        deliver();",
);
const upstreamAfter = performanceObserver(
  "protectedPerformance()->registerPerformanceObserver(*this);",
  "if (isBuffered && m_entriesToDeliver.size())\n        protectedPerformance()->scheduleTaskIfNeeded();",
);
// Edited for Bun, and without the upstream fix.
const bunCopy = performanceObserver(
  "m_performance->registerPerformanceObserver(*this);",
  "if (isBuffered)\n        deliver();",
);

// Bun's src/jsc/bindings/Path.cpp is node:path. WebCore's platform/graphics/Path.cpp draws curves.
const bunPath = `#include "Path.h"

namespace Bun {

JSC::JSValue createNodePathBinding(Zig::GlobalObject* globalObject)
{
    return JSC::constructEmptyObject(globalObject);
}

} // namespace Bun
`;
const webcorePath = (rule: string) => `${license}
#include "config.h"
#include "Path.h"

namespace WebCore {

bool Path::contains(const FloatPoint& point, WindRule rule) const
{
    return ${rule};
}

} // namespace WebCore
`;

// A copy with an underscore that upstream's name does not have.
const aesKw = (header: string, failed: string) => `${license}
#include "${header}"

namespace WebCore {

static std::optional<Vector<uint8_t>> cryptUnwrapKey(const Vector<uint8_t>& key, const Vector<uint8_t>& data)
{
    Vector<uint8_t> plainText(data.size() - 8);
    if (AES_unwrap_key(aesKey.key(), nullptr, plainText.begin(), data.begin(), data.size()) ${failed})
        return std::nullopt;
    return plainText;
}

} // namespace WebCore
`;

// A copy without the JS that upstream's name starts with.
const customEvent = (detail: string) => `${license}
#include "config.h"
#include "JSCustomEvent.h"

namespace WebCore {

JSC::JSValue JSCustomEvent::detail(JSC::JSGlobalObject& lexicalGlobalObject) const
{
    return cachedPropertyValue(lexicalGlobalObject, *this, wrapped().cachedDetail(), [this] {
        return ${detail};
    });
}

template<typename Visitor>
void JSCustomEvent::visitAdditionalChildren(Visitor& visitor)
{
    wrapped().detail().visit(visitor);
    wrapped().cachedDetail().visit(visitor);
}

} // namespace WebCore
`;

// Two files with nearly the same name, and the same license, that are not related: upstream's has a JS in front.
const upstreamCustom = (world: string) => `${license}
#include "config.h"
#include "JSPerformanceObserver.h"

bool JSPerformanceObserverOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, JSC::AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    return JSC::jsCast<JSPerformanceObserver*>(handle.slot()->asCell())->wrapped().isRegistered(${world});
}
`;
const bunCustom = `${license}
#include "PerformanceObserverCustom.h"

JSC_DEFINE_HOST_FUNCTION(jsPerformanceObserverPrototypeFunction_observe, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto* thisObject = jsDynamicCast<JSPerformanceObserver*>(callFrame->thisValue());
    auto options = convert<IDLDictionary<PerformanceObserver::Init>>(*globalObject, callFrame->argument(0));
    return JSValue::encode(toJS<IDLUndefined>(*globalObject, thisObject->wrapped().observe(WTF::move(options))));
}

JSC_DEFINE_HOST_FUNCTION(jsPerformanceObserverPrototypeFunction_disconnect, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto* thisObject = jsDynamicCast<JSPerformanceObserver*>(callFrame->thisValue());
    thisObject->wrapped().disconnect();
    return JSValue::encode(jsUndefined());
}
`;

// A copy whose code upstream has in two files. The table names both: no file name leads to the second one.
const cloneSerializer = `    void dumpArrayBufferView(JSObject* object, SerializationReturnCode& code);
    bool dumpIfTerminal(JSValue value, SerializationReturnCode& code);
    void write(SerializationTag tag) { writeLittleEndian<uint8_t>(m_buffer, static_cast<uint8_t>(tag)); }
    void write(const String& string) { write(string.impl()); }
`;
const serializedScriptValue = `RefPtr<SerializedScriptValue> SerializedScriptValue::create(JSGlobalObject& globalObject, JSValue value)
    auto serializer = CloneSerializer(globalObject, messagePorts, arrayBuffers);
    Vector<uint8_t> buffer = serializer.takeBuffer();
    return adoptRef(*new SerializedScriptValue(WTF::move(buffer)));
`;
const bunSerializer = "src/jsc/bindings/webcore/SerializedScriptValue.cpp";
const upstreamSerializer = "Source/JavaScriptCore/runtime/CloneSerializerBase.h";
const table = { [bunSerializer]: ["Source/WebCore/bindings/js/SerializedScriptValue.cpp", upstreamSerializer] };

const renderBox = `${license}\n// Bun has this file too, but not where the copies are.\n`;

const shas = (text: string) => text.replace(/^[0-9a-f]{4,64} /gm, "<sha> ");
const list = (bun: string, webkit: string, oldBase: string, newBase: string, names: Record<string, string[]> = {}) =>
  shas(formatCopyChanges(listCopyChanges(bun, webkit, oldBase, newBase, names), `${oldBase}..${newBase}`)).split("\n");

// Ten upstream commits and the Bun files that go with them. Nothing changes these two repositories after this.
let repositories: { bun: string; webkit: string; [Symbol.dispose](): void } | undefined;
afterAll(() => repositories?.[Symbol.dispose]());
function tenCommits() {
  if (repositories !== undefined) return repositories;
  const bun = checkout({
    "src/jsc/bindings/webcore/PerformanceObserver.cpp": bunCopy,
    "src/jsc/bindings/webcore/JSPerformanceObserver.cpp": `#include "JSPerformanceObserver.h"\n`,
    "src/jsc/bindings/webcore/PerformanceObserverCustom.cpp": bunCustom,
    "src/jsc/bindings/webcore/CustomEventCustom.cpp": customEvent("wrapped().detail().getValue()"),
    "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_KW.cpp": aesKw("CryptoAlgorithmAES_KW.h", "< 0"),
    [bunSerializer]: `${license}\n${cloneSerializer}${serializedScriptValue}`,
    "src/jsc/bindings/Path.cpp": bunPath,
    "src/jsc/bindings/RenderBox.cpp": renderBox,
    "src/runtime/RenderBox.cpp": renderBox,
  });
  // Tracked, and not in the working tree.
  rmSync(join(String(bun), "src/jsc/bindings/RenderBox.cpp"));

  const webkit = clone([
    {
      message: "base",
      files: {
        "Source/WebCore/page/PerformanceObserver.cpp": upstreamBefore,
        "Source/WebCore/page/PerformanceObserver.idl": "interface PerformanceObserver {};\n",
        "Source/WebCore/bindings/js/JSPerformanceObserverCustom.cpp": upstreamCustom("world"),
        "Source/WebCore/bindings/js/JSCustomEventCustom.cpp": customEvent("wrapped().detail().getValue()"),
        "Source/WebCore/crypto/algorithms/CryptoAlgorithmAESKW.cpp": aesKw("CryptoAlgorithmAESKW.h", "< 0"),
        "Source/WebCore/bindings/js/SerializedScriptValue.cpp": `${license}\n${serializedScriptValue}`,
        [upstreamSerializer]: `${license}\n${cloneSerializer}`,
        "Source/WebCore/platform/graphics/Path.cpp": webcorePath("false"),
        "Source/WebCore/rendering/RenderBox.cpp": renderBox,
        "Tools/TestWebKitAPI/PerformanceObserver.cpp": upstreamBefore,
      },
    },
    {
      message: "Schedule task on buffered PerformanceObserver\nhttps://bugs.webkit.org/show_bug.cgi?id=297765",
      files: {
        "Source/WebCore/page/PerformanceObserver.cpp": upstreamAfter,
        "LayoutTests/performance-api/buffered-does-not-sync-invoke.html": "<script></script>\n",
      },
    },
    {
      message: "Not listed: Bun's files of this name are elsewhere, or deleted",
      files: { "Source/WebCore/rendering/RenderBox.cpp": `${renderBox}// Changed.\n` },
    },
    {
      message: "Not listed: Bun's file of this name is not a copy",
      files: { "Source/WebCore/platform/graphics/Path.cpp": webcorePath("rule == WindRule::NonZero") },
    },
    {
      message: "Not listed: Bun's file of nearly this name has none of its code",
      files: { "Source/WebCore/bindings/js/JSPerformanceObserverCustom.cpp": upstreamCustom("visitor.world()") },
    },
    {
      message: "Not listed: the file is not under Source/WebCore, and the table does not name it",
      files: { "Tools/TestWebKitAPI/PerformanceObserver.cpp": upstreamAfter },
    },
    {
      message: "Expose PerformanceObserver.supportedEntryTypes",
      files: {
        "Source/WebCore/page/PerformanceObserver.idl":
          "interface PerformanceObserver { attribute any supportedEntryTypes; };\n",
      },
    },
    {
      message: "AES-KW unwrapKey accepts tampered wrapped keys",
      files: { "Source/WebCore/crypto/algorithms/CryptoAlgorithmAESKW.cpp": aesKw("CryptoAlgorithmAESKW.h", "<= 0") },
    },
    {
      message: "CustomEvent.detail is null before initCustomEvent()",
      files: {
        "Source/WebCore/bindings/js/JSCustomEventCustom.cpp": customEvent("wrapped().detail().getValue(JSC::jsNull())"),
      },
    },
    {
      message: "Serialize a resizable ArrayBuffer with its maximum length",
      files: {
        [upstreamSerializer]: `${license}\n${cloneSerializer}    void write(uint64_t);\n`,
        "Source/WebCore/bindings/js/SerializedScriptValue.cpp": `${license}\n${serializedScriptValue}// Changed.\n`,
      },
    },
    {
      message: "Move PerformanceObserver to Modules/performance",
      files: {
        "Source/WebCore/page/PerformanceObserver.cpp": null,
        "Source/WebCore/Modules/performance/PerformanceObserver.cpp": upstreamAfter,
      },
    },
  ]);
  return (repositories = {
    bun: String(bun),
    webkit: String(webkit),
    [Symbol.dispose]() {
      bun[Symbol.dispose]();
      webkit[Symbol.dispose]();
    },
  });
}

test("lists the commits that touch the upstream file of a copy or the IDL of a binding, and no others", () => {
  const { bun, webkit } = tenCommits();
  expect(list(bun, webkit, "base", "main", table)).toEqual([
    // A moved file is listed under both paths. `main` does not have the old one, which is compared as `base` has it.
    "<sha> 2025-09-03 Move PerformanceObserver to Modules/performance",
    "    Source/WebCore/Modules/performance/PerformanceObserver.cpp -> src/jsc/bindings/webcore/PerformanceObserver.cpp (88% same)",
    "    Source/WebCore/page/PerformanceObserver.cpp (gone) -> src/jsc/bindings/webcore/PerformanceObserver.cpp (88% same)",
    // The two upstream files that the table names for this copy, one of them outside Source/WebCore. Each has half of
    // the copy's code, and the share is of both together. The copy is listed once, not again for its name.
    "<sha> 2025-09-03 Serialize a resizable ArrayBuffer with its maximum length",
    "    Source/JavaScriptCore/runtime/CloneSerializerBase.h -> src/jsc/bindings/webcore/SerializedScriptValue.cpp (100% same)",
    "    Source/WebCore/bindings/js/SerializedScriptValue.cpp -> src/jsc/bindings/webcore/SerializedScriptValue.cpp (100% same)",
    // Two copies under nearly the name of the upstream file. Neither has the line that the commit changes.
    "<sha> 2025-09-03 CustomEvent.detail is null before initCustomEvent()",
    "    Source/WebCore/bindings/js/JSCustomEventCustom.cpp -> src/jsc/bindings/webcore/CustomEventCustom.cpp (91% same)",
    "<sha> 2025-09-03 AES-KW unwrapKey accepts tampered wrapped keys",
    "    Source/WebCore/crypto/algorithms/CryptoAlgorithmAESKW.cpp -> src/jsc/bindings/webcrypto/CryptoAlgorithmAES_KW.cpp (75% same)",
    "<sha> 2025-09-03 Expose PerformanceObserver.supportedEntryTypes",
    "    Source/WebCore/page/PerformanceObserver.idl -> src/jsc/bindings/webcore/JSPerformanceObserver.cpp (binding)",
    // The first line of the message, the committer's date, and only the file that Bun has a copy of.
    "<sha> 2025-09-03 Schedule task on buffered PerformanceObserver",
    "    Source/WebCore/page/PerformanceObserver.cpp (gone) -> src/jsc/bindings/webcore/PerformanceObserver.cpp (88% same)",
    "",
    "Commits in base..main that touch the upstream file of a Bun copy: 6 of 10",
  ]);
});

test("a range in which no commit touches a copy prints the count alone", () => {
  const { bun, webkit } = tenCommits();
  // The four commits in the middle of the ten.
  expect(list(bun, webkit, "main~9", "main~5", table)).toEqual([
    "Commits in main~9..main~5 that touch the upstream file of a Bun copy: 0 of 4",
  ]);
});

test("a range with no commits is an error", () => {
  const { bun, webkit } = tenCommits();
  // The arguments the wrong way round, and an old base that was never set.
  expect(() => listCopyChanges(bun, webkit, "main", "base", table)).toThrow("No commit is in main..base.");
  expect(() => listCopyChanges(bun, webkit, "main", "main", table)).toThrow("No commit is in main..main.");
});

test("an upstream file that git cannot read is an error, and not a file without a copy", () => {
  const path = "Source/WebCore/page/PerformanceObserver.cpp";
  using bun = checkout({ "src/jsc/bindings/webcore/PerformanceObserver.cpp": bunCopy });
  using webkit = clone([
    { message: "base", files: { [path]: upstreamBefore } },
    { message: "Schedule task on buffered PerformanceObserver", files: { [path]: upstreamAfter } },
  ]);
  // What a clone without blobs has when it cannot fetch one: the tree names the file, and its content is not there.
  const blob = git(String(webkit), ["rev-parse", `main:${path}`]);
  const object = join(String(webkit), ".git", "objects", blob.slice(0, 2), blob.slice(2));
  chmodSync(object, 0o666);
  rmSync(object);
  expect(() => listCopyChanges(String(bun), String(webkit), "base", "main", {})).toThrow(
    `\`git show main:${path}\` failed`,
  );
});

test("a table that names a file which is not there is an error", () => {
  const webcoreFile = "Source/WebCore/bindings/js/SerializedScriptValue.cpp";
  using bun = checkout({ [bunSerializer]: `${license}\n${cloneSerializer}${serializedScriptValue}` });
  using webkit = clone([
    {
      message: "base",
      files: {
        [upstreamSerializer]: `${license}\n${cloneSerializer}`,
        [webcoreFile]: `${license}\n${serializedScriptValue}`,
      },
    },
    {
      message: "Move the serializer to CloneSerializer.h",
      files: { [upstreamSerializer]: null, "Source/JavaScriptCore/runtime/CloneSerializer.h": cloneSerializer },
      ref: "refs/heads/moved",
    },
    { message: "Another change", files: { [webcoreFile]: `${license}\n` }, ref: "refs/heads/later" },
  ]);
  const [bunRoot, dir] = [String(bun), String(webkit)];
  const removal = git(dir, ["rev-parse", "moved"]).slice(0, 12);

  // The range that removes the file lists it. After that range the entry would match nothing, and nobody would know.
  expect(list(bunRoot, dir, "base", "moved", table)).toEqual([
    "<sha> 2025-09-03 Move the serializer to CloneSerializer.h",
    `    ${upstreamSerializer} (gone) -> ${bunSerializer} (100% same)`,
    "",
    "Commits in base..moved that touch the upstream file of a Bun copy: 1 of 1",
  ]);
  expect(() => listCopyChanges(bunRoot, dir, "moved", "later", table)).toThrow(
    `\`upstreamOf\` in scripts/webcore-copies.ts:\n  ${upstreamSerializer} is gone since ${removal}.`,
  );

  // A name that upstream never had, and a copy that Bun does not have.
  const typo = { [bunSerializer]: [...table[bunSerializer], "Source/JavaScriptCore/runtime/CloneSerialiserBase.h"] };
  expect(() => listCopyChanges(bunRoot, dir, "base", "later", typo)).toThrow(
    "Source/JavaScriptCore/runtime/CloneSerialiserBase.h is in no commit of the clone.",
  );
  expect(() => listCopyChanges(bunRoot, dir, "base", "later", { "src/jsc/bindings/Gone.cpp": [] })).toThrow(
    "src/jsc/bindings/Gone.cpp is not a tracked file.",
  );

  // Upstream brings the file back. In the range before that, neither end has it and the table is right.
  const reland = {
    message: "Reland the serializer",
    files: { [upstreamSerializer]: `${license}\n${cloneSerializer}` },
  };
  addCommits(dir, [reland], "from refs/heads/main^0\n");
  expect(list(bunRoot, dir, "moved", "later", table)).toEqual([
    "<sha> 2025-09-03 Another change",
    `    ${webcoreFile} -> ${bunSerializer} (0% same)`,
    "",
    "Commits in moved..later that touch the upstream file of a Bun copy: 1 of 1",
  ]);
});

test("a file that the range adds and removes again is listed without a share", () => {
  const path = "Source/WebCore/page/PerformanceTiming.cpp";
  using bun = checkout({ "src/jsc/bindings/webcore/PerformanceTiming.cpp": bunCopy });
  using webkit = clone([
    { message: "base", files: { "Source/WebCore/page/Performance.cpp": upstreamBefore } },
    { message: "Add PerformanceTiming", files: { [path]: upstreamBefore } },
    { message: "Revert: Add PerformanceTiming", files: { [path]: null } },
  ]);

  // Neither end has the file, so there is nothing to hold Bun's file against: not when its name leads to the upstream
  // file, and not when the table does.
  const listed = [
    "<sha> 2025-09-03 Revert: Add PerformanceTiming",
    `    ${path} (gone) -> src/jsc/bindings/webcore/PerformanceTiming.cpp`,
    "<sha> 2025-09-03 Add PerformanceTiming",
    `    ${path} (gone) -> src/jsc/bindings/webcore/PerformanceTiming.cpp`,
    "",
    "Commits in base..main that touch the upstream file of a Bun copy: 2 of 2",
  ];
  expect(list(String(bun), String(webkit), "base", "main")).toEqual(listed);
  const named = { "src/jsc/bindings/webcore/PerformanceTiming.cpp": [path] };
  expect(list(String(bun), String(webkit), "base", "main", named)).toEqual(listed);
});

test("every copy that upstreamOf names is a tracked file", () => {
  const copies = Object.keys(upstreamOf);
  const { exitCode, stdout, stderr } = Bun.spawnSync({ cmd: ["git", "ls-files", "--", ...copies], cwd: root });
  expect({ exitCode, stderr: stderr.toString(), tracked: stdout.toString().trim().split("\n").sort() }).toEqual({
    exitCode: 0,
    stderr: "",
    tracked: copies.toSorted(),
  });
});

test("a file of the same name is a copy only while it shares a long line with the upstream file", () => {
  // Seven of the copy's eight lines of code are in the upstream file. The short lines (`if (isBuffered)`, `deliver();`,
  // braces) and the license are not counted.
  expect(compareToUpstream(bunCopy, upstreamAfter)).toEqual({ isCopy: true, share: 7 / 8 });
  expect(compareToUpstream(upstreamAfter, upstreamAfter)).toEqual({ isCopy: true, share: 1 });
  // `#include "Path.h"` is in both files, and is too short to make one a copy of the other.
  expect(compareToUpstream(bunPath, webcorePath("false"))).toEqual({ isCopy: false, share: undefined });
  // The license alone makes it a copy. Fewer than eight lines of code have no share: the copy, less one line.
  expect(compareToUpstream(`${license}\n#pragma once\n`, upstreamAfter)).toEqual({ isCopy: true, share: undefined });
  expect(compareToUpstream(bunCopy.replace("        m_registered = true;\n", ""), upstreamAfter)).toEqual({
    isCopy: true,
    share: undefined,
  });
  // So a file of nearly the same name needs more than the license: a quarter of its code.
  expect(compareToUpstream(bunCustom, upstreamCustom("world"))).toEqual({ isCopy: true, share: 0 });
  // A comment is not code: not one that Bun added, and not a license without an asterisk in front of its lines.
  const commented = bunCopy.replace("namespace WebCore {", "// Bun has no document here.\nnamespace WebCore {");
  expect(compareToUpstream(commented, upstreamAfter)).toEqual({ isCopy: true, share: 7 / 8 });
  const plainLicense = license.replaceAll("\n * ", "\n   ");
  expect(
    compareToUpstream(bunCopy.replace(license, plainLicense), upstreamAfter.replace(license, plainLicense)),
  ).toEqual({ isCopy: true, share: 7 / 8 });
});

// A clone for this checkout. It has every upstream file that `upstreamOf` names, and the upstream file of one more
// copy, with the copy's own text: so the two are related whatever the copy says.
const realCopy = "src/jsc/bindings/webcore/PerformanceObserver.cpp";
function cloneForThisCheckout() {
  const text = readFileSync(join(root, realCopy), "utf8");
  const named = Object.values(upstreamOf).flat();
  return clone([
    {
      message: "base",
      files: {
        ...Object.fromEntries(named.map(path => [path, "// Not changed.\n"])),
        "Source/WebCore/page/PerformanceObserver.cpp": text,
      },
    },
    {
      message: "Schedule task on buffered PerformanceObserver",
      files: { "Source/WebCore/page/PerformanceObserver.cpp": `${text}\n// The fix.\n` },
      ref: "refs/remotes/upstream/main",
    },
  ]);
}
const listedForThisCheckout = [
  "<sha> 2025-09-03 Schedule task on buffered PerformanceObserver",
  `    Source/WebCore/page/PerformanceObserver.cpp -> ${realCopy} (100% same)`,
  "",
  "Commits in base..upstream/main that touch the upstream file of a Bun copy: 1 of 1",
].join("\n");

test("the command prints the list, or says what is wrong", () => {
  using webkit = cloneForThisCheckout();
  const command = (args: string[], clone = String(webkit)) => {
    const { exitCode, stdout, stderr } = main(args, root, clone);
    return { exitCode, stdout: shas(stdout), stderr };
  };
  expect(command(["base"])).toEqual({ exitCode: 0, stdout: listedForThisCheckout, stderr: "" });

  // `bun scripts/webcore-copies.ts $OLD_BASE upstream/main` with the variable unset.
  expect(command(["upstream/main"])).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: "No commit is in upstream/main..upstream/main. Is the old base set, and is it the older of the two?",
  });
  // An argument that is missing or empty, and a clone that is not there.
  const usage = (clone: string) => ({
    exitCode: 1,
    stdout: "",
    stderr:
      "usage: bun scripts/webcore-copies.ts <old-base> [<new-base>]\n" +
      `It reads the WebKit clone at ${clone}. Set BUN_WEBKIT_PATH to use another one.`,
  });
  const nowhere = join(String(webkit), "nowhere");
  expect([command([]), command(["", "upstream/main"]), command(["base", ""]), command(["base"], nowhere)]).toEqual([
    usage(String(webkit)),
    usage(String(webkit)),
    usage(String(webkit)),
    usage(nowhere),
  ]);
});

// Each run starts a Bun, which takes seconds for a debug build on a busy machine.
test("the script finds this checkout from where it is, and the clone from $BUN_WEBKIT_PATH", async () => {
  using webkit = cloneForThisCheckout();
  const script = async (...args: string[]) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(root, "scripts", "webcore-copies.ts"), ...args],
      env: { ...bunEnv, BUN_WEBKIT_PATH: String(webkit) },
      cwd: dirname(String(webkit)),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: shas(stdout), stderr, exitCode };
  };
  expect(await Promise.all([script("base"), script()])).toEqual([
    { stdout: `${listedForThisCheckout}\n`, stderr: "", exitCode: 0 },
    {
      stdout: "",
      stderr:
        "usage: bun scripts/webcore-copies.ts <old-base> [<new-base>]\n" +
        `It reads the WebKit clone at ${webkit}. Set BUN_WEBKIT_PATH to use another one.\n`,
      exitCode: 1,
    },
  ]);
}, 30_000);
