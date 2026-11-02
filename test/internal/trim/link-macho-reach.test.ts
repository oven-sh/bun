import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { tempDir } from "harness";
import {
  addOne,
  asCStrings,
  canLink,
  compileFeatureCodeOnce,
  count,
  cxx,
  describeEachMachine,
  functionWithAltEntry,
  jumpTo,
  linked,
  linkSkipReason,
  perMachine,
  sources,
} from "./link-macho-support.ts";
import {
  entryCalling,
  equalFunction,
  expectCleanRuns,
  Extra,
  mixingFunction,
  skipNotice,
  start,
} from "./toy-program.ts";

setDefaultTimeout(60_000);

if (!canLink) skipNotice("link-macho-reach.test.ts", linkSkipReason);

compileFeatureCodeOnce();

interface ReachCase {
  more: string;
  main: string;
  retained: string[];
  removable?: string[];
  files?: Record<string, string>;
  objects?: string[];
  compileFlags?: Record<string, string[]>;
  archived?: string[];
}

const reachCases: Record<string, ReachCase> = {
  "the name of a function in another input": {
    more: `${mixingFunction("feature_target", 3)} int more(int x) { return feature_target(x); }`,
    main: `int feature_target(int); int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : feature_target(argc) == 35 ? 0 : 1; }`,
    retained: ["feature_target"],
  },
  "a function folded into an equal one of the feature": {
    more: `${equalFunction("feature_equal")} int more(int x) { return feature_equal(x); }`,
    main: `${equalFunction("retained_equal")} int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : retained_equal(argc) == 109 ? 0 : 1; }`,
    retained: ["retained_equal", "feature_equal"],
  },
  "a constant table of file-local functions": {
    more: `
      __attribute__((noinline)) static int first(int x) { return x + 10; }
      __attribute__((noinline)) static int second(int x) { return x + 20; }
      int (*const feature_handlers[2])(int) = { first, second };
      int more(int x) { return first(x) + second(x) + feature_handlers[x & 1](x); }
    `,
    main: `
      extern int (*const feature_handlers[2])(int);
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : feature_handlers[argc](argc) == 21 ? 0 : 1; }
    `,
    retained: ["first", "second", "feature_handlers"],
  },
  "an address taken through the global offset table": {
    more: `${mixingFunction("feature_target", 3)} int more(int x) { return feature_target(x); }`,
    main: `
      int feature_target(int);
      int (*volatile pointer)(int);
      int main(int argc, char **argv) { pointer = feature_target; return argc > 5 ? GUARDED(Extra, entered, argc) : pointer(argc) == 35 ? 0 : 1; }
    `,
    retained: ["feature_target"],
  },
  "a function that runs before main": {
    more: `
      int early_value;
      static volatile int seed = 5;
      __attribute__((noinline)) int feature_early(int x) { return x * 5 + 1; }
      __attribute__((constructor, noinline)) void early(void) { early_value = feature_early(seed); }
      int more(int x) { early(); return feature_early(x); }
    `,
    main: `extern int early_value; int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : early_value == 26 ? 0 : 1; }`,
    retained: ["early", "feature_early"],
  },
  "a function that another input's initializer list names": {
    more: `
      int early_value;
      static volatile int seed = 5;
      __attribute__((noinline)) int feature_early(int x) { return x * 5 + 1; }
      __attribute__((noinline)) void early(void) { early_value = feature_early(seed); }
      int more(int x) { early(); return feature_early(x); }
    `,
    main: `
      extern int early_value;
      __asm__(".section __DATA,__mod_init_func,mod_init_funcs\\n.p2align 3\\n.quad _early\\n.text\\n");
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : early_value == 26 ? 0 : 1; }
    `,
    retained: ["early", "feature_early"],
  },
  "the weak definition the linker selected": {
    more: `__attribute__((weak, noinline)) int weak_function(int x) { return x + 100; } int more(int x) { return weak_function(x); }`,
    main: `
      __attribute__((weak, noinline)) int weak_function(int x) { return x + 100; }
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : weak_function(argc) == 101 ? 0 : 1; }
    `,
    retained: ["weak_function"],
  },
  "a weak table of functions whose selected copy is in the feature's input": {
    more: `
      __attribute__((noinline)) static int first(int x) { return x + 10; }
      __attribute__((noinline)) static int second(int x) { return x + 20; }
      __attribute__((weak)) int (*const weak_handlers[2])(int) = { first, second };
      int more(int x) { return first(x) + second(x) + weak_handlers[x & 1](x); }
    `,
    main: `
      __attribute__((noinline)) static int first(int x) { return x + 10; }
      __attribute__((noinline)) static int second(int x) { return x + 20; }
      __attribute__((weak)) int (*const weak_handlers[2])(int) = { first, second };
      int main(int argc, char **argv) {
        int (*const *handlers)(int) = weak_handlers;
        __asm__ volatile("" : "+r"(handlers));
        return argc > 5 ? GUARDED(Extra, entered, argc) : handlers[argc](argc) == 21 ? 0 : 1;
      }
    `,
    retained: ["weak_handlers", "first", "second"],
  },
  "a strong definition of the feature that replaces a weak one": {
    more: `__attribute__((noinline)) int replaced(int x) { return x + 2; } int more(int x) { return replaced(x); }`,
    main: `
      __attribute__((weak, noinline)) int replaced(int x) { return x + 1; }
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : replaced(argc) == 3 ? 0 : 1; }
    `,
    retained: ["replaced"],
  },
  "the copy of an inline function the linker selected": {
    more: `
      inline __attribute__((noinline)) int shared_inline(int x) { return x + 55; }
      extern "C" int more(int x) { return shared_inline(x); }
    `,
    main: `
      inline __attribute__((noinline)) int shared_inline(int x) { return x + 55; }
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : shared_inline(argc) == 56 ? 0 : 1; }
    `,
    retained: ["_Z13shared_inlinei"],
    compileFlags: { more: cxx, main: cxx },
  },
  "the initial value of a thread-local variable": {
    more: `
      ${mixingFunction("feature_hooked", 3)}
      ${mixingFunction("feature_second_hooked", 5)}
      __thread int (*hook)(int) = feature_hooked;
      __thread int (*feature_only_hook)(int) = feature_second_hooked;
      int more(int x) { return feature_hooked(x) + feature_second_hooked(x) + hook(x) + feature_only_hook(x); }
    `,
    main: `
      void _tlv_bootstrap(void) {}
      extern __thread int (*hook)(int);
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : hook(argc) == 35 ? 0 : 1; }
    `,
    retained: ["feature_hooked", "feature_second_hooked"],
  },
  "fallthrough between names in an input without subsections": {
    more: `int whole_second(int); ${mixingFunction("feature_target", 3)} int more(int x) { return whole_second(x) + feature_target(x); }`,
    main: `int whole_first(int); int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : whole_first(argc) == 56 ? 0 : 1; }`,
    files: {
      "whole.S": `.text\n.globl _whole_first, _whole_second\n.p2align 2\n_whole_first:\n${addOne}\n_whole_second:\n${jumpTo("_feature_target")}\n`,
    },
    objects: ["feature_code", "entry", "more", "whole", "embedder", "main"],
    retained: ["whole_second", "feature_target"],
  },
  "fallthrough in the interpreter's assembly": {
    more: `
      int interpreter_second(int);
      ${mixingFunction("feature_target", 3)}
      int more(int x) { return interpreter_second(x) + feature_target(x); }
    `,
    main: `
      int interpreter_first(int);
      __asm__(${asCStrings(`.section __TEXT,__jsc_int,regular,pure_instructions\n.globl _interpreter_first, _interpreter_second\n.p2align 2\n_interpreter_first:\n${addOne}\n_interpreter_second:\n${jumpTo("_feature_target")}\n.text\n`)});
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : interpreter_first(argc) == 56 ? 0 : 1; }
    `,
    retained: ["feature_target"],
  },
  "fallthrough in a single unit of the interpreter's assembly": {
    more: `
      int unit_second(int);
      ${mixingFunction("feature_target", 3)}
      int more(int x) { return unit_second(x) + feature_target(x); }
    `,
    main: `
      int unit_first(int);
      __asm__(${asCStrings(`.section __TEXT,__jsc_wasm,regular,pure_instructions\n.globl _unit_first, _unit_second\n.p2align 2\n_unit_first:\n${addOne}\n_unit_second:\n${jumpTo("_feature_target")}\n.text\n`)});
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : unit_first(argc) == 56 ? 0 : 1; }
    `,
    retained: ["unit_second", "feature_target"],
  },
  "fallthrough into an alternative entry; an unreferenced one is removed with its function": {
    more: `
      int middle_entry(int);
      int feature_piece(int);
      ${mixingFunction("feature_target", 3)}
      __asm__(${asCStrings(functionWithAltEntry("_feature_piece", "_feature_middle_entry", "_feature_target"))});
      int more(int x) { return middle_entry(x) + feature_piece(x) + feature_target(x); }
    `,
    main: `
      int piece(int);
      __asm__(${asCStrings(functionWithAltEntry("_piece", "_middle_entry", "_feature_target"))});
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : piece(argc) == 56 ? 0 : 1; }
    `,
    retained: ["piece", "middle_entry", "feature_target"],
    removable: ["feature_piece", "feature_middle_entry"],
  },
  "an alternative entry of a function only the feature calls": {
    more: `
      int piece(int);
      ${mixingFunction("feature_target", 3)}
      int more(int x) { return piece(x) + feature_target(x); }
    `,
    main: `int middle_entry(int); int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : middle_entry(argc) == 35 ? 0 : 1; }`,
    files: { "piece.c": `__asm__(${asCStrings(functionWithAltEntry("_piece", "_middle_entry", "_feature_target"))});` },
    objects: ["feature_code", "entry", "more", "piece", "embedder", "main"],
    retained: ["piece", "middle_entry", "feature_target"],
  },
  "an alternative entry called from its own input": {
    more: `
      int piece(int);
      ${mixingFunction("feature_target", 3)}
      int more(int x) { return piece(x) + feature_target(x); }
    `,
    main: `
      int middle_entry(int);
      __asm__(${asCStrings(functionWithAltEntry("_piece", "_middle_entry", "_feature_target"))});
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : middle_entry(argc) == 35 ? 0 : 1; }
    `,
    retained: ["piece", "middle_entry", "feature_target"],
  },
  "an address inside a constant, as a label or as a symbol and offset": {
    more: `extern const long feature_constants[2]; extern const long more_feature_constants[2]; int more(int x) { return feature_constants[x & 1] + more_feature_constants[x & 1]; }`,
    main: `
      long retained_reader(void);
      extern const long *const retained_pointer;
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : retained_reader() == 2 && *retained_pointer == 4 ? 0 : 1; }
    `,
    files: {
      "inside.S": `
        .section __TEXT,__const
        .globl _feature_constants, _more_feature_constants
        .p2align 3
        _feature_constants: .quad 1
        Lsecond: .quad 2
        _more_feature_constants: .quad 3
        Lfourth: .quad 4
        .section __DATA,__const
        .globl _retained_pointer
        .p2align 3
        _retained_pointer: .quad Lfourth
        .text
        .globl _retained_reader
        .p2align 2
        _retained_reader:${perMachine("adrp x8, Lsecond@PAGE\nldr x0, [x8, Lsecond@PAGEOFF]", "movq Lsecond(%rip), %rax")}ret
        .subsections_via_symbols
      `,
    },
    objects: ["feature_code", "entry", "more", "inside", "embedder", "main"],
    retained: ["feature_constants", "more_feature_constants"],
  },
  "a walk over a section from start to end": {
    more: `
      ${mixingFunction("member_one", 3)}
      ${mixingFunction("member_two", 5)}
      __attribute__((used, section("__DATA,handler_set"))) int (*const one)(int) = member_one;
      __attribute__((used, section("__DATA,handler_set"))) int (*const two)(int) = member_two;
      int deeper(int);
      int more(int x) { return member_one(x) + member_two(x) + deeper(x); }
    `,
    files: {
      "deeper.c": `extern int (*const one)(int); extern int (*const two)(int); int deeper(int x) { return one(x) + two(x); }`,
    },
    objects: ["feature_code", "entry", "more", "deeper", "embedder", "main"],
    main: `
      extern int (*const set_start[])(int) __asm__("section$start$__DATA$handler_set");
      extern int (*const set_end[])(int) __asm__("section$end$__DATA$handler_set");
      int main(int argc, char **argv) {
        int sum = 0;
        for (int (*const *member)(int) = set_start; member < set_end; member++) sum += (*member)(argc);
        return argc > 5 ? GUARDED(Extra, entered, argc) : sum == 35 + 129 ? 0 : 1;
      }
    `,
    retained: ["member_one", "member_two"],
  },
  "an offset from the linker's section start symbol into the header of the built-in modules": {
    more: `extern const char builtins_text[20000]; int more(int x) { return builtins_text[x % 20000]; }`,
    files: {
      "builtins.S": `.section __TEXT,__bun_builtins,regular,no_dead_strip\n.globl _builtins_text\n.p2align 4\n_builtins_text:\n.fill 20000, 1, 0x61\n`,
    },
    objects: ["feature_code", "entry", "more", "embedder", "main", "builtins"],
    main: `
      extern const char builtins_start[] __asm__("section$start$__TEXT$__bun_builtins");
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : builtins_start[16] == 'a' ? 0 : 1; }
    `,
    retained: ["builtins_text"],
  },
  "a function in an archive, and its string": {
    more: `
      ${mixingFunction("feature_target", 3)}
      __attribute__((noinline)) const char *feature_words(void) { return "words that a member of an archive names too"; }
      int more(int x) { return feature_target(x) + feature_words()[x & 7]; }
    `,
    main: `int member_of_an_archive_with_long_name(int); int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : member_of_an_archive_with_long_name(argc) == 35 + 'o' ? 0 : 1; }`,
    files: {
      "member_of_an_archive_with_long_name.c": `int feature_target(int); int member_of_an_archive_with_long_name(int x) { return feature_target(x) + "words that a member of an archive names too"[x]; }`,
    },
    objects: ["feature_code", "entry", "more", "member_of_an_archive_with_long_name", "embedder", "main"],
    archived: ["member_of_an_archive_with_long_name"],
    retained: ["feature_target", "member_of_an_archive_with_long_name"],
  },
  "a no_dead_strip section": {
    more: `
      extern int (*const never_stripped)(int);
      ${mixingFunction("feature_target", 3)}
      __asm__(".section __DATA,__pinned,regular,no_dead_strip\\n.globl _never_stripped\\n.p2align 3\\n_never_stripped:\\n.quad _feature_target\\n.text\\n");
      int more(int x) { return feature_target(x) + never_stripped(x); }
    `,
    main: `int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : 0; }`,
    retained: ["feature_target"],
  },
  "constants marked used; a function marked used is removed with its caller": {
    more: `
      ${mixingFunction("marked_function_callee", 5)}
      ${mixingFunction("marked_constants_callee", 7)}
      __attribute__((used, noinline)) int marked(int x) { return marked_function_callee(x); }
      __attribute__((used)) int (*const marked_constants[1])(int) = { marked_constants_callee };
      int more(int x) { return marked(x) + marked_constants_callee(x) + (marked_constants[x] != 0); }
    `,
    main: `int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : 0; }`,
    retained: ["marked_constants", "marked_constants_callee"],
    removable: ["marked", "marked_function_callee"],
  },
  "a function in an LTO input": {
    more: `${mixingFunction("feature_target", 3)} int more(int x) { return feature_target(x); }`,
    main: `int feature_target(int); int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : feature_target(argc) == 35 ? 0 : 1; }`,
    retained: ["feature_target"],
    compileFlags: { more: ["-flto"] },
  },
  "functions in two ThinLTO inputs, one with a local symbol": {
    more: `
      int feature_other(int);
      __attribute__((noinline)) static int known_only_here(int x) { for (int i = 0; i < 3; i++) x = x * 3 + i; return x ^ 3; }
      __attribute__((noinline)) int feature_target(int x) { return known_only_here(x) + 1; }
      int more(int x) { return feature_target(x) + feature_other(x); }
    `,
    main: `
      int feature_target(int);
      int feature_other(int);
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : feature_target(argc) == 36 && feature_other(argc) == 129 ? 0 : 1; }
    `,
    files: { "other.c": mixingFunction("feature_other", 5) },
    objects: ["feature_code", "entry", "more", "other", "embedder", "main"],
    retained: ["feature_target", "known_only_here", "feature_other"],
    compileFlags: { more: ["-flto=thin"], other: ["-flto=thin"] },
  },
};

describeEachMachine("Mach-O $name", machine => {
  describe("retained code reaches a feature's code by", () => {
    for (const [name, reach] of Object.entries(reachCases)) {
      test(name, async () => {
        using dir = tempDir("trim-macho-reach", {
          ...sources,
          "entry.c": entryCalling("more"),
          "more.c": reach.more,
          "main.c": (reach.compileFlags?.main === cxx ? `extern "C" { ${start} }` : start) + reach.main,
          ...reach.files,
        });
        const { featuresOf, programResult, trimmedResult } = await linked(machine, String(dir), {
          archived: reach.archived,
          objects: reach.objects ?? ["feature_code", "entry", "more", "embedder", "main"],
          compileFlags: reach.compileFlags,
        });
        expect(Object.fromEntries(reach.retained.map(name => [name, featuresOf(name)]))).toEqual(
          Object.fromEntries(reach.retained.map(name => [name, undefined])),
        );
        const removable = ["feature_code", "feature_code_0", `feature_code_${count - 1}`, ...(reach.removable ?? [])];
        expect(Object.fromEntries(removable.map(name => [name, featuresOf(name)]))).toEqual(
          Object.fromEntries(removable.map(name => [name, [Extra]])),
        );
        expectCleanRuns({ programResult, trimmedResult });
      });
    }
  });
});
