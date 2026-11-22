import { expect, setDefaultTimeout, test } from "bun:test";
import { isMusl, tempDir } from "harness";
import {
  canLink,
  compileFeatureCodeOnce,
  cxx,
  cxxStart,
  describeLink,
  expectRetained,
  hasCxxRuntime,
  linked,
  linkSkipReason,
  mainReturning,
  objectsWithMore,
  sources,
  switchFunction,
} from "./link-elf-support.ts";
import { entryCalling, equalFunction, expectCleanRuns, Extra, skipNotice, start } from "./toy-program.ts";

setDefaultTimeout(60_000);

const testFile = "link-elf-reach.test.ts";
if (!canLink) skipNotice(testFile, linkSkipReason);
else {
  if (!hasCxxRuntime) {
    skipNotice(testFile, "clang cannot link the C++ runtime: the case with a catch clause does not run");
  }
  if (isMusl) skipNotice(testFile, "musl has no ifunc: the case with an ifunc does not run");
}

compileFeatureCodeOnce();

interface ReachCase {
  more: string;
  main: string;
  retained: string[];
  compileFlags?: Record<string, string[]>;
  linkFlags?: string[];
  skip?: boolean;
}

const reachCases: Record<string, ReachCase> = {
  "a function folded into an equal one of the feature": {
    more: `${equalFunction("feature_equal")} int more(int x) { return feature_equal(x); }`,
    main: `${equalFunction("retained_equal")} ${mainReturning("retained_equal(argc) == 109 ? 0 : 1")}`,
    retained: ["retained_equal", "feature_equal"],
  },
  "a jump table, and one folded into an equal one of the feature": {
    more: `
      extern volatile int seen;
      int note(int);
      ${switchFunction("feature_choice")}
      int more(int x) { return feature_choice(x); }
    `,
    main: `
      volatile int seen;
      __attribute__((noinline)) int note(int value) { seen = value; return value; }
      ${switchFunction("retained_choice")}
      ${mainReturning("retained_choice(argc) == 12 && retained_choice(argc + 6) == 7 ? 0 : 1")}
    `,
    retained: ["retained_choice", "note"],
  },
  "a table of functions in data that retained code reads": {
    more: `
      __attribute__((noinline)) static int first(int x) { return x + 10; }
      __attribute__((noinline)) static int second(int x) { return x + 20; }
      int (*const feature_handlers[2])(int) = { first, second };
      int more(int x) { return feature_handlers[x & 1](x); }
    `,
    main: `
      extern int (*const feature_handlers[2])(int);
      ${mainReturning("feature_handlers[argc](argc) == 21 ? 0 : 1")}
    `,
    retained: ["first", "second"],
  },
  "a function that runs before main": {
    more: `
      int early_value;
      static volatile int seed = 5;
      __attribute__((noinline)) int feature_early(int x) { return x * 5 + 1; }
      __attribute__((constructor)) static void early(void) { early_value = feature_early(seed); }
      int more(int x) { return feature_early(x); }
    `,
    main: `extern int early_value; ${mainReturning("early_value == 26 ? 0 : 1")}`,
    retained: ["early", "feature_early"],
  },
  "an ifunc resolver that runs when the program is loaded": {
    more: `
      static volatile int selector;
      __attribute__((noinline)) static int chosen_one(int x) { return x + 40; }
      __attribute__((noinline)) static int chosen_two(int x) { return x + 41; }
      static int (*resolve_chosen(void))(int) { return selector ? chosen_two : chosen_one; }
      int chosen(int) __attribute__((ifunc("resolve_chosen")));
      int more(int x) { return chosen(x); }
    `,
    main: mainReturning("0"),
    retained: ["resolve_chosen", "chosen_one", "chosen_two"],
    skip: isMusl,
  },
  "a name that the link command defines": {
    more: `
      __attribute__((noinline)) int feature_target(int x) { return x * 3 + 4; }
      int more(int x) { return feature_target(x); }
    `,
    main: `int renamed(int); ${mainReturning("renamed(argc) == 7 ? 0 : 1")}`,
    retained: ["feature_target"],
    linkFlags: ["-Wl,--defsym=renamed=feature_target"],
  },
  "a name that the link command wraps": {
    more: `
      __attribute__((noinline)) int __wrap_plain(int x) { return x * 3 + 4; }
      int more(int x) { return __wrap_plain(x); }
    `,
    main: `int plain(int); ${mainReturning("plain(argc) == 7 ? 0 : 1")}`,
    retained: ["__wrap_plain"],
    linkFlags: ["-Wl,--wrap=plain"],
  },
  "a walk over a section from start to stop": {
    more: `
      __attribute__((noinline)) static int member_one(int x) { return x + 1; }
      __attribute__((noinline)) static int member_two(int x) { return x + 2; }
      __attribute__((used, retain, section("member_set"))) static int (*const one)(int) = member_one;
      __attribute__((used, retain, section("member_set"))) static int (*const two)(int) = member_two;
      int more(int x) { return member_one(x) + member_two(x); }
    `,
    main: `
      typedef int (*const member)(int);
      extern member __start_member_set[];
      extern member __stop_member_set[];
      __attribute__((noinline)) int sum_of_members(int x) {
        int sum = 0;
        for (member *next = __start_member_set; next < __stop_member_set; next++) sum += (*next)(x);
        return sum;
      }
      ${mainReturning("sum_of_members(argc) == 5 ? 0 : 1")}
    `,
    retained: ["member_one", "member_two"],
  },
  "the initial value of a thread-local variable": {
    more: `
      __attribute__((noinline)) int feature_hooked(int x) { return x + 7; }
      __thread int (*hook)(int) = feature_hooked;
      int more(int x) { return feature_hooked(x) + hook(x); }
    `,
    main: `extern __thread int (*hook)(int); ${mainReturning("hook(argc) == 8 ? 0 : 1")}`,
    retained: ["feature_hooked"],
  },
  "the weak definition the linker selected": {
    more: `
      __attribute__((weak, noinline)) int weak_function(int x) { return x + 100; }
      int more(int x) { return weak_function(x); }
    `,
    main: `
      __attribute__((weak, noinline)) int weak_function(int x) { return x + 100; }
      ${mainReturning("weak_function(argc) == 101 ? 0 : 1")}
    `,
    retained: ["weak_function"],
  },
  "a strong definition of the feature that replaces a weak one": {
    more: `__attribute__((noinline)) int replaced(int x) { return x + 2; } int more(int x) { return replaced(x); }`,
    main: `
      __attribute__((weak, noinline)) int replaced(int x) { return x + 1; }
      ${mainReturning("replaced(argc) == 3 ? 0 : 1")}
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
      ${mainReturning("shared_inline(argc) == 56 ? 0 : 1")}
    `,
    retained: ["_Z13shared_inlinei"],
    compileFlags: { more: cxx, main: cxx },
  },
  "a string that the linker merged with an equal one": {
    more: `
      __attribute__((noinline)) const char *feature_words(void) { return "the same words in both"; }
      int more(int x) { return feature_words()[x & 7]; }
    `,
    main: `
      __attribute__((noinline)) const char *retained_words(void) { __asm__ volatile(""); return "the same words in both"; }
      ${mainReturning("retained_words()[argc + 3] == 's' ? 0 : 1")}
    `,
    retained: ["retained_words"],
  },
  "an address taken through the global offset table": {
    more: `
      __attribute__((noinline)) int feature_target(int x) { return x * 3 + 4; }
      int more(int x) { return feature_target(x); }
    `,
    main: `
      int feature_target(int);
      int (*volatile pointer)(int);
      __attribute__((noinline)) int calls_pointer(int x) { pointer = feature_target; return pointer(x); }
      ${mainReturning("calls_pointer(argc) == 7 ? 0 : 1")}
    `,
    retained: ["feature_target"],
    compileFlags: { main: ["-fPIC"] },
  },
  "a type that only a catch clause names": {
    more: `
      struct Boom { int why; };
      extern "C" int more(int x) { if (x > 100) throw Boom{x}; return x; }
    `,
    main: `
      struct Boom { int why; };
      struct Unrelated { int why; };
      __attribute__((noinline)) static void fails(int x) { throw Unrelated{x}; }
      int main(int argc, char **argv) {
        try {
          if (argc > 5) return GUARDED(Extra, entered, argc);
          fails(argc);
        } catch (const Boom &) {
          return 2;
        } catch (const Unrelated &unrelated) {
          return unrelated.why - 1;
        }
        return 3;
      }
    `,
    retained: ["_ZTI4Boom", "_ZTS4Boom"],
    compileFlags: { more: ["-x", "c++"], main: ["-x", "c++"] },
    linkFlags: ["-lstdc++"],
    skip: !hasCxxRuntime,
  },
};

describeLink("retained code reaches a feature's code by", () => {
  for (const [name, reach] of Object.entries(reachCases)) {
    test.skipIf(reach.skip === true)(name, async () => {
      const isCxx = reach.compileFlags?.main?.includes("c++") === true;
      using dir = tempDir("trim-elf-reach", {
        ...sources,
        "entry.c": entryCalling("more"),
        "more.c": reach.more,
        "main.c": (isCxx ? cxxStart : start) + reach.main,
      });
      const { compileFlags, linkFlags } = reach;
      const result = await linked(String(dir), { objects: objectsWithMore, compileFlags, linkFlags });
      expectRetained(result, reach.retained);
      const removable = ["feature_code", "feature_code_0", "feature_code_1499"];
      expect(removable.map(result.featuresOf)).toEqual(removable.map(() => [Extra]));
      expectCleanRuns(result);
    });
  }
});
