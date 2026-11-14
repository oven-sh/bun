/**
 * scripts/webcore-copies.ts lists the upstream WebKit commits that touch a file Bun has its own copy of. The WebKit
 * upgrade routine (.claude/commands/upgrade-webkit.md) runs it, so that an upstream fix to such a file is seen. It
 * reads two git repositories: a bun checkout and a WebKit clone. Here both are a few files with the shape of the real
 * ones.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
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

async function git(cwd: string, args: string[], stdin = "") {
  await using proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    env: bunEnv,
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} exited with ${exitCode}: ${stderr}`);
  return stdout.trim();
}

interface Commit {
  message: string;
  /** The files that the commit writes. `null` removes one. */
  files: Record<string, string | null>;
  /** A ref that stays at this commit. */
  ref?: string;
}

/**
 * Adds `commits` to the branch `to` with one git process, which makes no use of the machine's git configuration
 * (identity, signing, hooks). The first of them comes after `from`, or after nothing. The author's date is not the
 * committer's, and the objects stay loose files.
 */
async function addCommits(dir: string, commits: Commit[], { to = "refs/heads/main", from = "" } = {}) {
  const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`;
  const stream = commits.map(({ message, files, ref }, index) =>
    [
      `commit ${to}\nmark :${index + 1}\n`,
      "author Test <test@example.com> 1756728000 +0000\ncommitter Test <test@example.com> 1756900800 +0000\n",
      data(message),
      index === 0 && from !== "" ? `from ${from}\n` : "",
      ...Object.entries(files).map(([path, text]) =>
        text === null ? `D ${path}\n` : `M 100644 inline ${path}\n${data(text)}`,
      ),
      ref === undefined ? "" : `reset ${ref}\nfrom :${index + 1}\n`,
    ].join(""),
  );
  await git(dir, ["-c", "fastimport.unpackLimit=100000", "fast-import", "--quiet"], stream.join("\n"));
}

/** A WebKit clone with `commits` on `main`. The branch `base` is the first of them. */
async function clone([base, ...commits]: Commit[]) {
  const dir = tempDir("webcore-copies-webkit", {});
  await git(String(dir), ["init", "--quiet", "--initial-branch=main"]);
  await addCommits(String(dir), [{ ...base, ref: "refs/heads/base" }, ...commits]);
  return dir;
}

/** A bun checkout where `files` are tracked. */
async function checkout(files: Record<string, string>) {
  const dir = tempDir("webcore-copies-bun", files);
  await git(String(dir), ["init", "--quiet", "--initial-branch=main"]);
  await git(String(dir), ["add", "--all"]);
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

// A copy that upstream renamed: its name has an underscore that upstream's no longer has. The table names it.
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
const bunAesKw = "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_KW.cpp";
const upstreamAesKw = "Source/WebCore/crypto/algorithms/CryptoAlgorithmAESKW.cpp";

// A copy whose code upstream has in two files. Its name leads to the first. The table names the second, which is
// not under Source/WebCore, and names it for Bun's header too.
const serializedScriptValue = `RefPtr<SerializedScriptValue> SerializedScriptValue::create(JSGlobalObject& globalObject, JSValue value)
    auto serializer = CloneSerializer(globalObject, messagePorts, arrayBuffers);
    Vector<uint8_t> buffer = serializer.takeBuffer();
    return adoptRef(*new SerializedScriptValue(WTF::move(buffer)));
`;
const cloneSerializer = [
  "    void dumpString(const String& string);",
  "    void dumpBigIntData(JSBigInt* bigInt);",
  "    void write(SerializationTag tag) { writeLittleEndian<uint8_t>(m_buffer, static_cast<uint8_t>(tag)); }",
  "    void write(const String& string) { write(string.impl()); }",
  "    void dumpArrayBufferView(JSObject* object, SerializationReturnCode& code);",
  "    void dumpImmediate(JSValue value, SerializationReturnCode& code);",
  "    bool dumpIfTerminal(JSValue value, SerializationReturnCode& code);",
  "    bool startObjectInternal(JSObject* object);",
];
const upstreamSerializedScriptValue = "Source/WebCore/bindings/js/SerializedScriptValue.cpp";
const upstreamSerializer = "Source/JavaScriptCore/runtime/CloneSerializerBase.h";
const bunSerializer = "src/jsc/bindings/webcore/SerializedScriptValue.cpp";
const bunSerializerHeader = "src/jsc/bindings/webcore/SerializedScriptValue.h";
// Six of the eight lines of upstream's header are in Bun's .cpp. The first two are in Bun's .h, which has no
// license and no long line: only the table says that it is a copy.
const serializerFiles = {
  [bunSerializer]: `${license}\n${serializedScriptValue}${cloneSerializer.slice(2).join("\n")}\n`,
  [bunSerializerHeader]: `#pragma once\n${cloneSerializer.slice(0, 2).join("\n")}\n`,
};
const serializerTable = { [bunSerializer]: [upstreamSerializer], [bunSerializerHeader]: [upstreamSerializer] };
const table = { ...serializerTable, [bunAesKw]: [upstreamAesKw] };

const renderBox = `${license}\n// Bun has this file too, but not where the copies are.\n`;

const shas = (text: string) => text.replace(/^[0-9a-f]{4,64} /gm, "<sha> ");
const list = (bun: string, webkit: string, oldBase: string, newBase: string, names: Record<string, string[]> = {}) =>
  shas(formatCopyChanges(listCopyChanges(bun, webkit, oldBase, newBase, names), `${oldBase}..${newBase}`)).split("\n");

// Eight upstream commits and the Bun files that go with them. No test changes these two repositories.
let repositories: { bun: string; webkit: string };
const directories: Disposable[] = [];
afterAll(() => directories.forEach(directory => directory[Symbol.dispose]()));
beforeAll(async () => {
  const bun = await checkout({
    "src/jsc/bindings/webcore/PerformanceObserver.cpp": bunCopy,
    "src/jsc/bindings/webcore/JSPerformanceObserver.cpp": `#include "JSPerformanceObserver.h"\n`,
    [bunAesKw]: aesKw("CryptoAlgorithmAES_KW.h", "< 0"),
    ...serializerFiles,
    "src/jsc/bindings/Path.cpp": bunPath,
    "src/runtime/RenderBox.cpp": renderBox,
    // Git prints a name like this one in quotes, with its bytes as numbers, unless it is told not to.
    "src/jsc/bindings/webcore/Straße.h": "#pragma once\n",
  });
  directories.push(bun);
  const webkit = await clone([
    {
      message: "base",
      files: {
        "Source/WebCore/page/PerformanceObserver.cpp": upstreamBefore,
        "Source/WebCore/page/PerformanceObserver.idl": "interface PerformanceObserver {};\n",
        [upstreamAesKw]: aesKw("CryptoAlgorithmAESKW.h", "< 0"),
        [upstreamSerializedScriptValue]: `${license}\n${serializedScriptValue}`,
        [upstreamSerializer]: `${license}\n${cloneSerializer.join("\n")}\n`,
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
      message: "Not listed: Bun's file of this name is not where the copies are",
      files: { "Source/WebCore/rendering/RenderBox.cpp": `${renderBox}// Changed.\n` },
    },
    {
      message: "Not listed: Bun's file of this name is not a copy",
      files: { "Source/WebCore/platform/graphics/Path.cpp": webcorePath("rule == WindRule::NonZero") },
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
      files: { [upstreamAesKw]: aesKw("CryptoAlgorithmAESKW.h", "<= 0") },
    },
    {
      message: "Serialize a resizable ArrayBuffer with its maximum length",
      files: {
        [upstreamSerializer]: `${license}\n${cloneSerializer.join("\n")}\n    void write(uint64_t);\n`,
        [upstreamSerializedScriptValue]: `${license}\n${serializedScriptValue}// Changed.\n`,
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
  directories.push(webkit);
  repositories = { bun: String(bun), webkit: String(webkit) };
});

test("lists the commits that touch the upstream file of a copy or the IDL of a binding, and no others", () => {
  const { bun, webkit } = repositories;
  expect(list(bun, webkit, "base", "main", table)).toEqual([
    // A moved file is listed under both paths. `main` does not have the old one. `base` does not have the new one,
    // which is compared as the commit that adds it has it: with the fix, so the copy has less of it.
    "<sha> 2025-09-03 Move PerformanceObserver to Modules/performance",
    "    Source/WebCore/Modules/performance/PerformanceObserver.cpp -> src/jsc/bindings/webcore/PerformanceObserver.cpp (70% same)",
    "    Source/WebCore/page/PerformanceObserver.cpp (gone) -> src/jsc/bindings/webcore/PerformanceObserver.cpp (88% same)",
    // The table names the first file for two copies. Each has its own part of that file. The name of the copy leads
    // to the second file, which has fewer than eight lines of code, so no share.
    "<sha> 2025-09-03 Serialize a resizable ArrayBuffer with its maximum length",
    `    ${upstreamSerializer} -> ${bunSerializer} (75% same), ${bunSerializerHeader} (25% same)`,
    `    ${upstreamSerializedScriptValue} -> ${bunSerializer}`,
    // The share is of the file as `base` has it: the copy has seven of its eight lines. It has one fewer of the
    // lines that `main` has, because it does not have this fix.
    "<sha> 2025-09-03 AES-KW unwrapKey accepts tampered wrapped keys",
    `    ${upstreamAesKw} -> ${bunAesKw} (88% same)`,
    "<sha> 2025-09-03 Expose PerformanceObserver.supportedEntryTypes",
    "    Source/WebCore/page/PerformanceObserver.idl -> src/jsc/bindings/webcore/JSPerformanceObserver.cpp (binding)",
    // The first line of the message, the committer's date, and only the file that Bun has a copy of.
    "<sha> 2025-09-03 Schedule task on buffered PerformanceObserver",
    "    Source/WebCore/page/PerformanceObserver.cpp (gone) -> src/jsc/bindings/webcore/PerformanceObserver.cpp (88% same)",
    "",
    "Commits in base..main that touch the upstream file of a Bun copy: 5 of 8",
  ]);
});

test("a range in which no commit touches a copy prints the count alone", () => {
  const { bun, webkit } = repositories;
  // The three commits that are not listed.
  expect(list(bun, webkit, "main~7", "main~4", table)).toEqual([
    "Commits in main~7..main~4 that touch the upstream file of a Bun copy: 0 of 3",
  ]);
  // The AES-KW commit, without the table: a name that is nearly the same leads to no copy.
  expect(list(bun, webkit, "main~3", "main~2")).toEqual([
    "Commits in main~3..main~2 that touch the upstream file of a Bun copy: 0 of 1",
  ]);
});

test("a range with no commits is an error", () => {
  const { bun, webkit } = repositories;
  // The arguments the wrong way round, and an old base that was never set.
  expect(() => listCopyChanges(bun, webkit, "main", "base", table)).toThrow("No commit is in main..base.");
  expect(() => listCopyChanges(bun, webkit, "main", "main", table)).toThrow("No commit is in main..main.");
});

test("an upstream file that git cannot read is an error, and not a file without a copy", async () => {
  const path = "Source/WebCore/page/PerformanceObserver.cpp";
  using bun = await checkout({ "src/jsc/bindings/webcore/PerformanceObserver.cpp": bunCopy });
  using webkit = await clone([
    { message: "base", files: { [path]: upstreamBefore } },
    { message: "Schedule task on buffered PerformanceObserver", files: { [path]: upstreamAfter } },
  ]);
  // What a clone without blobs has when it cannot fetch one: the tree names the file, and its content is not there.
  const blob = await git(String(webkit), ["rev-parse", `base:${path}`]);
  const object = join(String(webkit), ".git", "objects", blob.slice(0, 2), blob.slice(2));
  chmodSync(object, 0o666);
  rmSync(object);
  expect(() => listCopyChanges(String(bun), String(webkit), "base", "main", {})).toThrow(
    `\`git show base:${path}\` failed`,
  );
});

test("a tracked file that the working tree does not have is an error", async () => {
  const { webkit } = repositories;
  const path = "src/jsc/bindings/webcore/PerformanceObserver.cpp";
  using bun = await checkout({ [path]: bunCopy, "src/jsc/bindings/webcore/Performance.cpp": bunCopy });
  rmSync(join(String(bun), path));
  // Without the error, the commits that touch its upstream file would not be listed, and nothing would say so.
  expect(() => listCopyChanges(String(bun), webkit, "base", "main", {})).toThrow(
    `These tracked files are not in the working tree of ${bun}:\n  ${path}`,
  );
});

test("a table that names a file which upstream no longer has is an error", async () => {
  using bun = await checkout(serializerFiles);
  using webkit = await clone([
    {
      message: "base",
      files: {
        [upstreamSerializer]: `${license}\n${cloneSerializer.join("\n")}\n`,
        [upstreamSerializedScriptValue]: `${license}\n${serializedScriptValue}`,
      },
    },
    {
      message: "Move the serializer to CloneSerializer.h",
      files: {
        [upstreamSerializer]: null,
        "Source/JavaScriptCore/runtime/CloneSerializer.h": cloneSerializer.join("\n"),
      },
      ref: "refs/heads/moved",
    },
    {
      message: "Another change",
      files: { [upstreamSerializedScriptValue]: `${license}\n// Changed.\n${serializedScriptValue}` },
      ref: "refs/heads/later",
    },
  ]);
  const [bunRoot, dir, table] = [String(bun), String(webkit), serializerTable];
  const removal = (await git(dir, ["rev-parse", "moved"])).slice(0, 12);
  const gone = `\`upstreamOf\` in scripts/webcore-copies.ts:\n  ${upstreamSerializer} is gone since ${removal}.`;

  // The range that removes the file lists it. After that range the entry would match nothing, and nobody would know.
  expect(list(bunRoot, dir, "base", "moved", table)).toEqual([
    "<sha> 2025-09-03 Move the serializer to CloneSerializer.h",
    `    ${upstreamSerializer} (gone) -> ${bunSerializer} (75% same), ${bunSerializerHeader} (25% same)`,
    "",
    "Commits in base..moved that touch the upstream file of a Bun copy: 1 of 1",
  ]);
  expect(() => listCopyChanges(bunRoot, dir, "moved", "later", table)).toThrow(gone);

  // Two commits that still have the file do not change that. The upgrade goes to neither: a release branch of
  // upstream that left before the move, and the fork, which kept the file when it merged `later`.
  const withFile = { message: "Keep the serializer", files: { [upstreamSerializer]: `${license}\n` } };
  await addCommits(dir, [withFile], { to: "refs/remotes/upstream/safari-branch", from: "refs/heads/base" });
  await addCommits(dir, [withFile], { to: "refs/remotes/origin/main", from: "refs/heads/later" });
  expect(() => listCopyChanges(bunRoot, dir, "moved", "later", table)).toThrow(gone);

  // A name that upstream never had, and a copy that Bun does not have.
  const typo = "Source/JavaScriptCore/runtime/CloneSerialiserBase.h";
  expect(() => listCopyChanges(bunRoot, dir, "base", "later", { [bunSerializer]: [typo] })).toThrow(
    `${typo} is not in the history of base, and no later upstream commit has it.`,
  );
  expect(() => listCopyChanges(bunRoot, dir, "base", "later", { "src/jsc/bindings/Gone.cpp": [] })).toThrow(
    "src/jsc/bindings/Gone.cpp is not a tracked file.",
  );

  // Upstream brings the file back after `later`. In the range before that, neither end has it and the table is right.
  // The table can also name the file that the copy's name leads to: the copy is then listed once.
  const reland = { message: "Reland the serializer", files: { [upstreamSerializer]: `${license}\n` } };
  await addCommits(dir, [reland], { to: "refs/remotes/upstream/main", from: "refs/heads/later" });
  const both = { ...table, [bunSerializer]: [upstreamSerializer, upstreamSerializedScriptValue] };
  expect(list(bunRoot, dir, "moved", "later", both)).toEqual([
    "<sha> 2025-09-03 Another change",
    `    ${upstreamSerializedScriptValue} -> ${bunSerializer}`,
    "",
    "Commits in moved..later that touch the upstream file of a Bun copy: 1 of 1",
  ]);
});

test("a file that the range adds and removes again is compared as the commit that adds it has it", async () => {
  const path = "Source/WebCore/page/PerformanceTiming.cpp";
  const unrelated = "Source/WebCore/platform/graphics/Path.cpp";
  using bun = await checkout({
    "src/jsc/bindings/webcore/PerformanceTiming.cpp": bunCopy,
    "src/jsc/bindings/Path.cpp": bunPath,
  });
  using webkit = await clone([
    { message: "base", files: { "Source/WebCore/page/Performance.cpp": upstreamBefore } },
    { message: "Add PerformanceTiming", files: { [path]: upstreamBefore, [unrelated]: webcorePath("false") } },
    { message: "Revert: Add PerformanceTiming", files: { [path]: null, [unrelated]: null } },
  ]);

  // Neither end has the two files. Bun's Path.cpp is not a copy of the one that was added, and is not listed.
  const listed = [
    "<sha> 2025-09-03 Revert: Add PerformanceTiming",
    `    ${path} (gone) -> src/jsc/bindings/webcore/PerformanceTiming.cpp (88% same)`,
    "<sha> 2025-09-03 Add PerformanceTiming",
    `    ${path} (gone) -> src/jsc/bindings/webcore/PerformanceTiming.cpp (88% same)`,
    "",
    "Commits in base..main that touch the upstream file of a Bun copy: 2 of 2",
  ];
  expect(list(String(bun), String(webkit), "base", "main")).toEqual(listed);
  // The table can name such a file.
  const named = { "src/jsc/bindings/webcore/PerformanceTiming.cpp": [path] };
  expect(list(String(bun), String(webkit), "base", "main", named)).toEqual(listed);
});

test("every copy that upstreamOf names is a tracked file", async () => {
  const copies = Object.keys(upstreamOf);
  expect((await git(root, ["ls-files", "--", ...copies])).split("\n").sort()).toEqual(copies.toSorted());
});

test("a file of the same name is a copy only while it shares a long line with the upstream file", () => {
  // The copy has seven of the eight lines of code of the upstream file. The short lines (`if (isBuffered)`,
  // `deliver();`, braces) and the license are not counted. The fix is two more lines that the copy does not have.
  expect(compareToUpstream(bunCopy, upstreamBefore)).toEqual({ isCopy: true, share: 7 / 8 });
  expect(compareToUpstream(bunCopy, upstreamAfter)).toEqual({ isCopy: true, share: 7 / 10 });
  expect(compareToUpstream(upstreamAfter, upstreamAfter)).toEqual({ isCopy: true, share: 1 });
  // `#include "Path.h"` is in both files, and is too short to make one a copy of the other.
  expect(compareToUpstream(bunPath, webcorePath("false"))).toEqual({ isCopy: false, share: undefined });
  // The license alone makes it a copy.
  expect(compareToUpstream(`${license}\n#pragma once\n`, upstreamBefore)).toEqual({ isCopy: true, share: 0 });
  // An upstream file with fewer than eight lines of code has no share: the file, less one line.
  const sevenLines = upstreamBefore.replace("        m_registered = true;\n", "");
  expect(compareToUpstream(bunCopy, sevenLines)).toEqual({ isCopy: true, share: undefined });
  // A comment is not code: not a line of its own, and not a license without an asterisk in front of its lines.
  const commented = upstreamBefore.replace("namespace WebCore {", "// Workers have no document.\nnamespace WebCore {");
  expect(compareToUpstream(bunCopy, commented)).toEqual({ isCopy: true, share: 7 / 8 });
  const plainLicense = license.replaceAll("\n * ", "\n   ");
  expect(
    compareToUpstream(bunCopy.replace(license, plainLicense), upstreamBefore.replace(license, plainLicense)),
  ).toEqual({ isCopy: true, share: 7 / 8 });
});

// A clone for this checkout. It has every upstream file that `upstreamOf` names, and the upstream file of one more
// copy, with the copy's own text: so the two are related whatever the copy says.
const realCopy = "src/jsc/bindings/webcore/PerformanceObserver.cpp";
async function cloneForThisCheckout() {
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

test("the command prints the list, or says what is wrong", async () => {
  using webkit = await cloneForThisCheckout();
  const command = (args: string[], clone = String(webkit)) => {
    const { exitCode, stdout, stderr } = main(args, root, clone);
    return { exitCode, stdout: shas(stdout), stderr };
  };
  expect(command(["base", "upstream/main"])).toEqual({ exitCode: 0, stdout: listedForThisCheckout, stderr: "" });
  expect(command(["upstream/main", "base"])).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: "No commit is in upstream/main..base. Is the old base the older of the two?",
  });

  // A revision that is missing or empty, and a clone that is not there. The checklist's command has one argument
  // when `$OLD_BASE` is not set.
  const usage = (clone: string) => ({
    exitCode: 1,
    stdout: "",
    stderr:
      "usage: bun scripts/webcore-copies.ts <old-base> <new-base>\n" +
      `It reads the WebKit clone at ${clone}. Set BUN_WEBKIT_PATH to use another one.`,
  });
  const nowhere = join(String(webkit), "nowhere");
  expect([
    command([]),
    command(["upstream/main"]),
    command(["", "upstream/main"]),
    command(["base", ""]),
    command(["base", "upstream/main"], nowhere),
  ]).toEqual([
    usage(String(webkit)),
    usage(String(webkit)),
    usage(String(webkit)),
    usage(String(webkit)),
    usage(nowhere),
  ]);
});

async function script(clone: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(root, "scripts", "webcore-copies.ts"), ...args],
    env: { ...bunEnv, BUN_WEBKIT_PATH: clone },
    cwd: dirname(clone),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: shas(stdout), stderr, exitCode };
}

// These two are not concurrent: two debug builds of Bun that start together take longer than one after the other.
test("the script finds this checkout from where it is, and the clone from $BUN_WEBKIT_PATH", async () => {
  using webkit = await cloneForThisCheckout();
  expect(await script(String(webkit), "base", "upstream/main")).toEqual({
    stdout: `${listedForThisCheckout}\n`,
    stderr: "",
    exitCode: 0,
  });
});

test("the script prints what is wrong to stderr, and exits with 1", async () => {
  using directory = tempDir("webcore-copies-no-arguments", {});
  expect(await script(String(directory))).toEqual({
    stdout: "",
    stderr:
      "usage: bun scripts/webcore-copies.ts <old-base> <new-base>\n" +
      `It reads the WebKit clone at ${directory}. Set BUN_WEBKIT_PATH to use another one.\n`,
    exitCode: 1,
  });
});
