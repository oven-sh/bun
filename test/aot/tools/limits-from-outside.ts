// bun limits-from-outside.ts <tree> [ninja.log]: edits a COPY of the two source trees, never the trees themselves, for a build of Bun whose limits are set from the environment.
// <tree> holds webkit-aot/ (or WebKit under that name) and bun-aot/ (this repository).
//
// A limit decides how fast and how large the code is, never what a program prints. Most are so high that only a large program meets them. limits.def names some, and --aot-limit lowers one of
// those in a build (../joined-programs.ts, joinedWithLimitsLowered). Many more are constants in the sources: `constexpr unsigned mostLayouts = 16;`. Here each of those becomes a value that is read
// from the environment the first time it is asked for, under the name <file>.<constant>, and the named limits are read there too:
//   AOT_LIMITS="all=1"                      every limit at min(its value, 1)
//   AOT_LIMITS="LongExpectations.mostLayouts=1,MaxDispatchCases=0"   these alone. Later words win: "all=1,MaxInlineDepth=4".
//   AOT_LIMITS="draw=<seed>"                each limit by a hash of the seed and its name: half stay, the others are at 0, 1 or 2
//   AOT_LIMITS="times=1000"                 every limit a thousand times its value (named ones: only those that protect no bit width)
//   AOT_LIMITS_SEEN=<file>                  gets a line `name standard value` the first time a process asks for a limit
// The same words go to the build of a program and to its run: the run time has limits too, and some are shared with the code.
// AOT_WAYS_FILE of joinedWithLimitsLowered takes [{ name, flags: [], env: { AOT_LIMITS } }] and runs the programs under each.
//
// State beside the tree: <tree>/../limits-from-outside/{original/.., excluded.txt, in-class.txt, rewritten.tsv, rewritten-rust.tsv}. Each call restores the originals and writes anew.
// With a ninja.log it first reads the errors of the last build: an error on the line of a declaration changes the form of that declaration (in a class: `static inline const`); an error on a
// line that names a limit (an array bound, a template argument, a static_assert, a constexpr function) puts that limit on excluded.txt. Call, build, call with the log, build, until it builds:
// about eight rounds. WITH_RUST=1 takes the constants of src/aot and src/sema/check/aot as well.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join, relative } from "path";

const [tree, log] = process.argv.slice(2);
const engine = join(tree, "webkit-aot/Source/JavaScriptCore");
const state = join(tree, "..", "limits-from-outside");
mkdirSync(join(state, "original", "none"), { recursive: true });
const listOf = (name: string) => new Set(existsSync(join(state, name)) ? readFileSync(join(state, name), "utf8").split("\n").filter(Boolean) : []);
const excluded = listOf("excluded.txt");
const inClass = listOf("in-class.txt");

const says = /(^max|^min|^most|^least|^fewest|^smallest|^largest|^shortest|^longest|Max[A-Z]|Most[A-Z]|Limit|limit|[bB]udget|[tT]hreshold|Depth|depth|[rR]ounds|[sS]teps|[fF]uel|Few|few|Many|many|Small|small|Large|large|Ways|ways|[uU]nroll|[cC]utoff|Window)/;
const saysOtherwise = /(Bits?$|Bits[A-Z]|Shift|Mask|Offset|Alignment|Align|[sS]izeIn|[bB]ytesPer|Tag$|Version|[mM]agic|[sS]tride|Index$|Register|GPR|FPR|Printed|Shown|Reported|Listed$|InText$)/;
const isFact = /Digits|maxCanonicalNumericStringLength|maxIndexLength|pastLargestInt32|OperatorOperations\.limit|smallestPageSize|Value\.maxNumberOf|maxEncodedSize|minRegExpOutputSize|Punctuation|maxGroupsInRegExpMatchOutput|ErrorMessages\.|StackTrace\.|maxConstantInArgumentThunk|maxTransitionLoad|Frequency$|RuntimeReporter\.|OperandSnapshot\.|NativeCallValidation\.|RuntimeValidation\.|percentile|mostOf$|stepsAhead|PrefetchDistance|mostUsefulThreads|GuardedPages\./;
const types = /^(unsigned|size_t|uint8_t|uint16_t|uint32_t|uint64_t|int|int32_t|int64_t|double|unsigned long|ptrdiff_t)$/;
const declaration = /^(\s*)((?:(?:static|inline|constexpr|const)\s+)+)([\w:]+(?: long)?)\s+(\w+)\s*(?:=\s*([^;{}]+?)|\{\s*([^;{}]+?)\s*\})\s*;(.*)$/;

function filesBelow(folder: string, into: string[] = []): string[] {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "tests" && entry.name !== "schema") filesBelow(path, into);
    } else if (/\.(cpp|h)$/.test(entry.name) && !/TestCommands|LimitFromOutside/.test(entry.name)) into.push(path);
  }
  return into;
}

const original = (path: string) => join(state, "original", relative(tree, path));
function textOf(path: string): string {
  if (existsSync(original(path))) return readFileSync(original(path), "utf8");
  return readFileSync(path, "utf8");
}
function write(path: string, before: string, after: string) {
  if (!existsSync(original(path))) {
    mkdirSync(dirname(original(path)), { recursive: true });
    writeFileSync(original(path), before);
  }
  if (readFileSync(path, "utf8") !== after) writeFileSync(path, after);
}

const keyOf = (path: string, name: string) => `${basename(path).replace(/^AOT/, "").replace(/\.(cpp|h)$/, "")}.${name}`;

if (log) {
  const rewritten = new Map<string, string[]>();
  for (const line of readFileSync(join(state, "rewritten.tsv"), "utf8").split("\n").filter(Boolean)) {
    const [key, file, number] = line.split("\t");
    rewritten.set(key, [file, number]);
  }
  const names = new Map<string, string[]>();
  for (const key of rewritten.keys()) names.set(key.slice(key.indexOf(".") + 1), [...(names.get(key.slice(key.indexOf(".") + 1)) ?? []), key]);
  let toClass = 0, out = 0, unexplained = 0;
  const seen = new Set<string>();
  for (const match of readFileSync(log, "utf8").matchAll(/^(\S+?\.(?:cpp|h)):(\d+):\d+: (error|note): (.*)$/gm)) {
    const [, file, number, kind, message] = match;
    if (seen.has(file + ":" + number)) continue;
    seen.add(file + ":" + number);
    const path = file.startsWith("/") ? file.replace(/^.*\/webkit-aot\//, join(tree, "webkit-aot") + "/") : join(engine, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8").split("\n")[Number(number) - 1] ?? "";
    const declared = /limitFromOutside<[^>]+>\("([^"]+)"/.exec(text)?.[1];
    if (declared && kind === "error") {
      if (!inClass.has(declared) && /in-class|inline|static data member|non-static|storage class/.test(message)) (inClass.add(declared), toClass++);
      else (excluded.add(declared), out++);
      continue;
    }
    const found = [...text.matchAll(/\b[A-Za-z_]\w*\b/g)].flatMap(word => names.get(word[0]) ?? []);
    // A name that several files declare: the one of this file, or of a header.
    const mine = found.filter(key => rewritten.get(key)![0] === relative(tree, path) || rewritten.get(key)![0].endsWith(".h"));
    for (const key of mine) if (!excluded.has(key)) (excluded.add(key), out++);
    if (kind === "error" && mine.length === 0) (unexplained++, console.log(`UNEXPLAINED ${file}:${number}: ${message.slice(0, 140)} | ${text.trim().slice(0, 120)}`));
  }
  writeFileSync(join(state, "excluded.txt"), [...excluded].sort().join("\n") + "\n");
  writeFileSync(join(state, "in-class.txt"), [...inClass].sort().join("\n") + "\n");
  console.log(`from the log: ${toClass} are members of classes, ${out} more are excluded, ${unexplained} errors name no limit`);
}

const rows: string[] = [];
let kept = 0;
for (const path of filesBelow(join(engine, "aot"))) {
  const before = textOf(path);
  let changed = false;
  const lines = before.split("\n");
  lines.forEach((line, index) => {
    const match = declaration.exec(line);
    if (!match) return;
    const [, indent, specifiers, type, name, assigned, braced, rest] = match;
    const value = assigned ?? braced;
    if (!specifiers.includes("constexpr") || !types.test(type) || !says.test(name) || saysOtherwise.test(name) || !/\d/.test(value) || /LimitID|sizeof|numeric_limits|offsetof|alignof/.test(value)) return;
    // What follows from another constant, or is one less than a power of two, is the width of a format. What the language or a format says is no limit either.
    if (/[A-Za-z_]{3,}|- 1\b|<< 31/.test(value.replace(/\b(KB|MB|GB)\b/g, "")) || isFact.test(keyOf(path, name))) return;
    const key = keyOf(path, name);
    if (excluded.has(key)) return void kept++;
    lines[index] = `${indent}static ${inClass.has(key) ? "inline " : ""}const ${type} ${name} = ::JSC::AOT::limitFromOutside<${type}>("${key}", ${value});${rest}`;
    rows.push([key, relative(tree, path), index + 1, type, value].join("\t"));
    changed = true;
  });
  if (!changed) {
    if (existsSync(original(path))) write(path, before, before);
    continue;
  }
  // Behind the last #include of the head, or behind #pragma once.
  let at = lines.findIndex(line => /^#include "config\.h"/.test(line));
  if (at < 0) at = lines.findIndex(line => /^#pragma once/.test(line));
  lines.splice(at + 1, 0, `#include "AOTLimitFromOutside.h"`);
  write(path, before, lines.join("\n"));
}
// The inserted line moves what is below it by one.
writeFileSync(join(state, "rewritten.tsv"), rows.map(row => row.split("\t")).map(([key, file, number, ...more]) => [key, file, Number(number) + 1, ...more].join("\t")).join("\n") + "\n");

writeFileSync(
  join(engine, "aot/support/AOTLimitFromOutside.h"),
  `#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace JSC { namespace AOT {

inline bool findLimitFromOutside(const char* name, double standard, bool mayRise, double& value)
{
    bool found = false;
    if (const char* words = getenv("AOT_LIMITS")) {
        size_t length = strlen(name);
        for (const char* word = words; *word;) {
            const char* end = strchr(word, ',');
            if (!end)
                end = word + strlen(word);
            const char* equals = static_cast<const char*>(memchr(word, '=', end - word));
            if (equals) {
                size_t wordLength = equals - word;
                double number = strtod(equals + 1, nullptr);
                if (wordLength == length && !memcmp(word, name, length)) {
                    value = number;
                    found = true;
                } else if (wordLength == 3 && !memcmp(word, "all", 3)) {
                    value = number < standard ? number : standard;
                    found = true;
                } else if (wordLength == 5 && !memcmp(word, "times", 5)) {
                    if (mayRise && standard * number < 4e9) {
                        value = standard * number;
                        found = true;
                    }
                } else if (wordLength == 4 && !memcmp(word, "draw", 4)) {
                    uint64_t hash = 1469598103934665603ull ^ static_cast<uint64_t>(number);
                    for (const char* c = name; *c; ++c)
                        hash = (hash ^ static_cast<unsigned char>(*c)) * 1099511628211ull;
                    hash ^= hash >> 29;
                    unsigned drawn = hash % 6;
                    if (drawn < 3) {
                        value = drawn < standard ? drawn : standard;
                        found = true;
                    } else
                        found = false;
                }
            }
            word = *end ? end + 1 : end;
        }
    }
    if (const char* seen = getenv("AOT_LIMITS_SEEN")) {
        if (FILE* file = fopen(seen, "a")) {
            fprintf(file, "%s %.17g %.17g\\n", name, standard, found ? value : standard);
            fclose(file);
        }
    }
    return found;
}

template<typename T> inline T limitFromOutside(const char* name, T standard)
{
    double value = 0;
    return findLimitFromOutside(name, static_cast<double>(standard), true, value) ? static_cast<T>(value) : standard;
}

} } // namespace JSC::AOT
`,
);

function edit(path: string, old: string, replacement: string, isOutsideTheLoop = false) {
  const pristine = textOf(path);
  const now = isOutsideTheLoop ? pristine : readFileSync(path, "utf8");
  if (now.split(old).length !== 2) throw new Error(`${path}: ${JSON.stringify(old)} is there ${now.split(old).length - 1} times`);
  write(path, pristine, now.replace(old, () => replacement));
}
const named = `[&] { double value = 0; return canBeLowered(limit) && findLimitFromOutside(Wire::nameOf(limit).characters(), static_cast<double>(standard), protectsOf(limit) != Wire::Protects::BitWidth, value) ? static_cast<uint64_t>(value) : standard; }()`;
edit(
  join(engine, "aot/support/AOTLimits.cpp"),
  `        m_values[static_cast<size_t>(limit)] = defaultLimitValue(limit, architecture);`,
  `    {\n        uint64_t standard = defaultLimitValue(limit, architecture);\n        m_values[static_cast<size_t>(limit)] = ${named};\n    }`,
);
{
  const path = join(engine, "aot/support/AOTLimits.cpp");
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace(`#include "AOTLimits.h"\n`, `#include "AOTLimits.h"\n#include "AOTLimitFromOutside.h"\n`).replace(`    RELEASE_ASSERT(value <= (*this)[limit]);\n`, ``));
}
edit(
  join(engine, "aot/runtime/AOTRuntimeCounters.cpp"),
  `    return defaultLimitValue(limit, hostArchitecture());\n}`,
  `    uint64_t standard = defaultLimitValue(limit, hostArchitecture());\n    return ${named};\n}`,
);
{
  const path = join(engine, "aot/runtime/AOTRuntimeCounters.cpp");
  const text = readFileSync(path, "utf8");
  if (!text.includes("AOTLimitFromOutside.h")) writeFileSync(path, text.replace(`#include "config.h"\n`, `#include "config.h"\n#include "AOTLimitFromOutside.h"\n`));
}
edit(
  join(tree, "bun-aot/src/aot/statistics/limit_values.rs"),
  `            values: LimitId::ALL.map(|limit| limit.value(architecture)),`,
  `            values: LimitId::ALL.map(|limit| {
                let standard = limit.value(architecture);
                if !can_be_lowered(limit) {
                    return standard;
                }
                let name = format!("{limit:?}");
                let mut value = standard;
                for word in std::env::var("AOT_LIMITS").unwrap_or_default().split(',') {
                    let Some((key, number)) = word.split_once('=') else { continue };
                    let Ok(number) = number.parse::<u64>() else { continue };
                    if key == name {
                        value = number;
                    } else if key == "all" {
                        value = standard.min(number);
                    } else if key == "times" {
                        if limit.protects() != crate::ir::generated::Protects::BitWidth && standard.saturating_mul(number) < 4_000_000_000 {
                            value = standard * number;
                        }
                    } else if key == "draw" {
                        let mut hash = 1469598103934665603u64 ^ number;
                        for byte in name.bytes() {
                            hash = (hash ^ u64::from(byte)).wrapping_mul(1099511628211);
                        }
                        hash ^= hash >> 29;
                        value = if hash % 6 < 3 { standard.min(hash % 6) } else { standard };
                    }
                }
                value
            }),`,
  true,
);

// Rust: `const MAX_X: usize = 8;` becomes a static that is read from outside once, and every use in the file (for a `pub` one: in every file) becomes `(*MAX_X)`.
const rustFiles: string[] = [];
(function below(folder: string) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) entry.name === "tests" || entry.name === "generated" || below(path);
    else if (entry.name.endsWith(".rs") && entry.name !== "tests.rs" && entry.name !== "limit_values.rs") rustFiles.push(path);
  }
})(process.env.WITH_RUST ? join(tree, "bun-aot/src/aot") : join(state, "original", "none"));
(function below(folder: string) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) entry.name === "tests" || below(path);
    else if (entry.name.endsWith(".rs") && entry.name !== "tests.rs") rustFiles.push(path);
  }
})(process.env.WITH_RUST ? join(tree, "bun-aot/src/sema/check/aot") : join(state, "original", "none"));
const rustDeclaration = /^(\s*)((?:pub(?:\([a-z]+\))? )?)const ((?:MAX|MIN|MOST|FEWEST)_[A-Z0-9_]+): (usize|u8|u16|u32|u64|i32|i64) = ([0-9_]+(?: << [0-9]+)?);(.*)$/;
const rustFact = /PRINTED|SHOWN|LISTED|IN_TEXT|SAFE_INTEGER|DIGITS|NUMERIC_STRING|SUBJECT_BYTES|SOURCE_BYTES|NAMED_TYPES|READERS/;
const helper = `
#[allow(dead_code)]
fn limit_from_outside(name: &str, standard: u64) -> u64 {
    let mut value = standard;
    for word in std::env::var("AOT_LIMITS").unwrap_or_default().split(',') {
        let Some((key, number)) = word.split_once('=') else { continue };
        let Ok(number) = number.parse::<u64>() else { continue };
        if key == name {
            value = number;
        } else if key == "all" {
            value = standard.min(number);
        } else if key == "times" {
            value = standard.saturating_mul(number).min(4_000_000_000);
        } else if key == "draw" {
            let mut hash = 1469598103934665603u64 ^ number;
            for byte in name.bytes() {
                hash = (hash ^ u64::from(byte)).wrapping_mul(1099511628211);
            }
            hash ^= hash >> 29;
            value = if hash % 6 < 3 { standard.min(hash % 6) } else { standard };
        }
    }
    value
}
`;
if (log) {
  let out = 0;
  for (const match of readFileSync(log, "utf8").matchAll(/-->\s+(\S+\.rs):(\d+):\d+/g)) {
    const path = join(tree, "bun-aot", match[1].replace(/^.*\/bun-aot\//, ""));
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8").split("\n")[Number(match[2]) - 1] ?? "";
    for (const word of text.matchAll(/\b(?:MAX|MIN|MOST|FEWEST)_[A-Z0-9_]+\b/g))
      for (const key of [`${relative(join(tree, "bun-aot/src"), path)}.${word[0]}`, `pub.${word[0]}`]) if (!excluded.has(key)) (excluded.add(key), out++);
  }
  writeFileSync(join(state, "excluded.txt"), [...excluded].sort().join("\n") + "\n");
  console.log(`from the log, Rust: ${out} keys more are excluded`);
}
const rustRows: string[] = [];
const shared = new Set<string>();
const texts = new Map(rustFiles.map(path => [path, textOf(path)]));
const rewrittenTexts = new Map<string, string>();
for (const [path, before] of texts) {
  const own = new Set<string>();
  const lines = before.split("\n").map(line => {
    const match = rustDeclaration.exec(line);
    if (!match || rustFact.test(match[3])) return line;
    const [, indent, visibility, name, type, value, rest] = match;
    const file = relative(join(tree, "bun-aot/src"), path);
    if (excluded.has(`${file}.${name}`) || excluded.has(`pub.${name}`)) return line;
    (visibility ? shared : own).add(name);
    own.add(name);
    rustRows.push(`${file}.${name}\t${value}`);
    return `${indent}${visibility}static ${name}: std::sync::LazyLock<${type}> = std::sync::LazyLock::new(|| limit_from_outside("${file}.${name}", ${value}) as ${type});${rest}`;
  });
  if (own.size) rewrittenTexts.set(path, lines.map(line => (/static [A-Z_0-9]+: std::sync::LazyLock/.test(line) ? line : line.replace(new RegExp(`\\b(${[...own].join("|")})\\b`, "g"), "(*$1)"))).join("\n") + helper);
}
for (const [path, before] of texts) {
  let after = rewrittenTexts.get(path) ?? before;
  if (shared.size && !rewrittenTexts.has(path)) after = after.split("\n").map(line => (/^\s*(pub )?use /.test(line) || /^\s*[A-Za-z_:]*[A-Z_0-9]+,?$/.test(line) ? line : line.replace(new RegExp(`(?<![*A-Z_0-9])\\b((?:[a-z_]+::)*(?:${[...shared].join("|")}))\\b`, "g"), "(*$1)"))).join("\n");
  if (after !== before || existsSync(original(path))) write(path, before, after);
}
writeFileSync(join(state, "rewritten-rust.tsv"), rustRows.join("\n") + "\n");
console.log(`${rustRows.length} limits of the Rust side are read from outside`);
console.log(`${rows.length} limits without a name are read from outside (${inClass.size} as members of classes); ${kept} stay as they are (excluded.txt)`);
