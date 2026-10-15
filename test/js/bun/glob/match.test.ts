// Portions of this file are derived from works under the MIT License:
//
// Copyright (c) 2014-present, Jon Schlinkert
// Copyright (c) 2023 Devon Govett
// Copyright (c) 2023 Stephen Gregoratto
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { basename, join } from "path";

describe("Glob.match", () => {
  test("WTF", () => {
    // let glob = new Glob("C:\\Users\\window\\AppData\\Local\\Temp\\testworkspace_V7osKW\\**");
    // expect(glob.match("C:\\Users\\window\\AppData\\Local\\Temp\\testworkspace_V7osKW\\packages\\malfored1")).toBeTrue();
  });

  test("single wildcard", () => {
    let glob: Glob;

    glob = new Glob("*");
    expect(glob.match("foo")).toBeTrue();
    expect(glob.match("lmao.ts")).toBeTrue();
    expect(glob.match("")).toBeTrue();
    expect(glob.match("   ")).toBeTrue();
    expect(glob.match("*")).toBeTrue();

    glob = new Glob("*.ts");
    expect(glob.match("foo.ts")).toBeTrue();
    expect(glob.match(".ts")).toBeTrue();
    expect(glob.match("")).toBeFalse();
    expect(glob.match("bar.tsx")).toBeFalse();
    expect(glob.match("foo/bar.ts")).toBeFalse();
    expect(glob.match("foo/bar/baz.ts")).toBeFalse();

    glob = new Glob("src/*/*.ts");
    expect(glob.match("src/foo/bar.ts")).toBeTrue();
    expect(glob.match("src/bar.ts")).toBeFalse();

    glob = new Glob("src/**/hehe.ts");
    expect(glob.match("src/foo/baz/lol/hehe.ts")).toBeTrue();
  });

  test("double wildcard", () => {
    let glob: Glob;

    glob = new Glob("**");
    // FIXME: should this match?
    expect(glob.match("")).toBeTrue();
    expect(glob.match("nice/wow/great/foo.ts")).toBeTrue();

    glob = new Glob("foo/**/bar");
    expect(glob.match("")).toBeFalse();
    expect(glob.match("foo/lmao/lol/bar")).toBeTrue();
    expect(glob.match("foo/lmao/lol/haha/wtf/nice/bar")).toBeTrue();
    expect(glob.match("foo/bar")).toBeTrue();

    glob = new Glob("src/**/*.ts");
    expect(glob.match("src/foo/bar/baz/nice.ts")).toBeTrue();
    expect(glob.match("src/foo/bar/nice.ts")).toBeTrue();
    expect(glob.match("src/nice.ts")).toBeTrue();

    glob = new Glob("src/foo/*/bar/**/*.ts");
    expect(glob.match("src/foo/nice/bar/baz/lmao.ts")).toBeTrue();
    expect(glob.match("src/foo/nice/bar/baz/lmao.ts")).toBeTrue();
  });

  test("comma inside a bracket class inside braces is not a branch separator", () => {
    // `[,]` is a single-character class containing a literal comma, so the
    // group has three branches: `ts`, `[,]foo`, and nothing after — not a
    // spurious `]foo` branch split off at the class-interior comma.
    expect(new Glob("x.{ts,[,]foo}").match("x.,foo")).toBeTrue();
    expect(new Glob("x.{ts,[,]foo}").match("x.]foo")).toBeFalse();
    expect(new Glob("x.{ts,[,]foo}").match("x.ts")).toBeTrue();
  });

  test("no early globstar lock-in", () => {
    // see https://github.com/oven-sh/bun/issues/14934
    expect(new Glob(`**/*abc*`).match(`a/abc`)).toBeTrue();
    expect(new Glob(`**/*.js`).match(`a/b.c/c.js`)).toBeTrue();
    expect(new Glob("/**/*a").match("/a/a")).toBeTrue();
    expect(new Glob("**/*.js").match("a/b.c/c.js")).toBeTrue();
    expect(new Glob("**/**/*.js").match("a/b.c/c.js")).toBeTrue();
    expect(new Glob("a/**/*.d").match("a/b/c.d")).toBeTrue();
    expect(new Glob("a/**/*.d").match("a/.b/c.d")).toBeTrue();
    expect(new Glob("**/*/**").match("a/b/c")).toBeTrue();
    expect(new Glob("**/*/c.js").match("a/b/c.js")).toBeTrue();
  });

  test("braces", async () => {
    let glob: Glob;

    glob = new Glob("index.{ts,tsx,js,jsx}");
    expect(glob.match("index.ts")).toBeTrue();
    expect(glob.match("index.tsx")).toBeTrue();
    expect(glob.match("index.js")).toBeTrue();
    expect(glob.match("index.jsx")).toBeTrue();
    expect(glob.match("index.jsxxxxxxxx")).toBeFalse();

    glob = new Glob("foo{bar,b*z}");
    expect(glob.match("foobar")).toBeTrue();
    expect(glob.match("foobuzz")).toBeTrue();
    expect(glob.match("foobarz")).toBeTrue();

    glob = new Glob("{a}/{b}/");
    expect(glob.match("a/b/")).toBeTrue();

    glob = new Glob("{a,b}/c/{d,e}/**/*est.ts");
    expect(glob.match("a/c/d/one/two/three.test.ts"));

    glob = new Glob("{a,{d,e}b}/c");
    expect(glob.match("a/c")).toBeTrue();

    glob = new Glob("{**/a,**/b}");
    expect(glob.match("b")).toBeTrue();

    const fixtures = [
      {
        pattern: "{src,extensions}/**/test/**/{fixtures,browser,common}/**/*.{ts,js}",
        expectedMatches: "matched-0.txt",
      },
      { pattern: "{extensions,src}/**/{media,images,icons}/**/*.{svg,png,gif,jpg}", expectedMatches: "matched-1.txt" },
      {
        pattern: "{.github,build,test}/**/{workflows,azure-pipelines,integration,smoke}/**/*.{yml,yaml,json}",
        expectedMatches: "matched-2.txt",
      },
      {
        pattern: "src/vs/{base,editor,platform,workbench}/test/{browser,common,node}/**/[a-z]*[tT]est.ts",
        expectedMatches: "matched-3.txt",
      },
      {
        pattern: "src/vs/workbench/{contrib,services}/**/*{Editor,Workspace,Terminal}*.ts",
        expectedMatches: "matched-4.txt",
      },
      {
        pattern: "{extensions,src}/**/{markdown,json,javascript,typescript}/**/*.{ts,json}",
        expectedMatches: "matched-5.txt",
      },
      {
        pattern: "**/{electron-sandbox,electron-main,browser,node}/**/{*[sS]ervice*,*[cC]ontroller*}.ts",
        expectedMatches: "matched-6.txt",
      },
      {
        pattern: "{src,extensions}/**/{common,browser,electron-sandbox}/**/*{[cC]ontribution,[sS]ervice}.ts",
        expectedMatches: "matched-7.txt",
      },
      {
        pattern: "src/vs/{base,platform,workbench}/**/{test,browser}/**/*{[mM]odel,[cC]ontroller}*.ts",
        expectedMatches: "matched-8.txt",
      },
      {
        pattern: "extensions/**/{browser,common,node}/{**/*[sS]ervice*,**/*[pP]rovider*}.ts",
        expectedMatches: "matched-9.txt",
      },
    ];

    const allFilePaths = (
      await Bun.file(join(import.meta.dir, "..", "..", "..", "fixtures", "glob", "filelist.txt")).text()
    ).split("\n");

    for (const { pattern, expectedMatches } of fixtures) {
      const shouldMatch = (
        await Bun.file(join(import.meta.dir, "..", "..", "..", "fixtures", "glob", `${expectedMatches}`)).text()
      ).split("\n");

      glob = new Glob(pattern);
      let matched: string[] = [];
      for (const filepath of allFilePaths) {
        if (glob.match(filepath)) {
          matched.push(filepath);
        }
      }

      expect(matched).toEqual(shouldMatch);
    }
  });

  test("nested braces", () => {
    let glob: Glob;

    // Basic single-level nesting
    // ("a{b,c{d,e}}f", ["abf", "acdf", "acef"]),
    glob = new Glob("a{b,c{d,e}}f");
    expect(glob.match("abf")).toBeTrue();
    expect(glob.match("acdf")).toBeTrue();
    expect(glob.match("acef")).toBeTrue();

    // Two levels deep
    glob = new Glob("x{1,2{3,4}}y");
    expect(glob.match("x1y")).toBeTrue();
    expect(glob.match("x23y")).toBeTrue();
    expect(glob.match("x24y")).toBeTrue();

    glob = new Glob("a{b,c{d,e},f}g");
    expect(glob.match("abg")).toBeTrue();
    expect(glob.match("acdg")).toBeTrue();
    expect(glob.match("aceg")).toBeTrue();
    expect(glob.match("afg")).toBeTrue();

    // Three levels deep
    glob = new Glob("1{2,3{4,5{6,7}}}8");
    expect(glob.match("128")).toBeTrue();
    expect(glob.match("1348")).toBeTrue();
    expect(glob.match("13568")).toBeTrue();
    expect(glob.match("13578")).toBeTrue();

    // Four levels deep
    glob = new Glob("{a,b{c,d{e,f{g,h}}}}i");
    expect(glob.match("ai")).toBeTrue();
    expect(glob.match("bci")).toBeTrue();
    expect(glob.match("bdei")).toBeTrue();
    expect(glob.match("bdfgi")).toBeTrue();
    expect(glob.match("bdfhi")).toBeTrue();

    // Five levels deep
    glob = new Glob("v{w,x{y,z{1,2{3,4{5,6}}}}}7");
    expect(glob.match("vw7")).toBeTrue();
    expect(glob.match("vxy7")).toBeTrue();
    expect(glob.match("vxz17")).toBeTrue();
    expect(glob.match("vxz237")).toBeTrue();
    expect(glob.match("vxz2457")).toBeTrue();
    expect(glob.match("vxz2467")).toBeTrue();

    // Six levels deep
    glob = new Glob("a{b,c{d,e{f,g{h,i{j,k{l,m}}}}}}n");
    expect(glob.match("abn")).toBeTrue();
    expect(glob.match("acdn")).toBeTrue();
    expect(glob.match("acefn")).toBeTrue();
    expect(glob.match("aceghn")).toBeTrue();
    expect(glob.match("acegijn")).toBeTrue();
    expect(glob.match("acegikln")).toBeTrue();
    expect(glob.match("acegikmn")).toBeTrue();

    // Seven levels deep
    glob = new Glob("1{2,3{4,5{6,7{8,9{a,b{c,d{e,f}}}}}}}g");
    expect(glob.match("12g")).toBeTrue();
    expect(glob.match("134g")).toBeTrue();
    expect(glob.match("1356g")).toBeTrue();
    expect(glob.match("13578g")).toBeTrue();
    expect(glob.match("13579ag")).toBeTrue();
    expect(glob.match("13579bcg")).toBeTrue();
    expect(glob.match("13579bdeg")).toBeTrue();
    expect(glob.match("13579bdfg")).toBeTrue();

    // Eight levels deep
    glob = new Glob("p{q,r{s,t{u,v{w,x{y,z{1,2{3,4{5,6}}}}}}}}7");
    expect(glob.match("pq7")).toBeTrue();
    expect(glob.match("prs7")).toBeTrue();
    expect(glob.match("prtu7")).toBeTrue();
    expect(glob.match("prtvw7")).toBeTrue();
    expect(glob.match("prtvxy7")).toBeTrue();
    expect(glob.match("prtvxz17")).toBeTrue();
    expect(glob.match("prtvxz237")).toBeTrue();
    expect(glob.match("prtvxz2457")).toBeTrue();
    expect(glob.match("prtvxz2467")).toBeTrue();

    // Nine levels deep
    glob = new Glob("a{b,c{d,e{f,g{h,i{j,k{l,m{n,o{p,q{r,s}}}}}}}}}t");
    expect(glob.match("abt")).toBeTrue();
    expect(glob.match("acdt")).toBeTrue();
    expect(glob.match("aceft")).toBeTrue();
    expect(glob.match("aceght")).toBeTrue();
    expect(glob.match("acegijt")).toBeTrue();
    expect(glob.match("acegiklt")).toBeTrue();
    expect(glob.match("acegikmnt")).toBeTrue();
    expect(glob.match("acegikmopt")).toBeTrue();
    expect(glob.match("acegikmoqrt")).toBeTrue();
    expect(glob.match("acegikmoqst")).toBeTrue();

    // Ten levels deep
    glob = new Glob("1{2,3{4,5{6,7{8,9{a,b{c,d{e,f{g,h{i,j{k,l}}}}}}}}}}m");
    expect(glob.match("12m")).toBeTrue();
    expect(glob.match("134m")).toBeTrue();
    expect(glob.match("1356m")).toBeTrue();
    expect(glob.match("13578m")).toBeTrue();
    expect(glob.match("13579am")).toBeTrue();
    expect(glob.match("13579bcm")).toBeTrue();
    expect(glob.match("13579bdem")).toBeTrue();
    expect(glob.match("13579bdfgm")).toBeTrue();
    expect(glob.match("13579bdfhim")).toBeTrue();
    expect(glob.match("13579bdfhjkm")).toBeTrue();
    expect(glob.match("13579bdfhjlm")).toBeTrue();

    // Edge cases
    // Redundant nesting
    glob = new Glob("{a,{b,c}}");
    expect(glob.match("a")).toBeTrue();
    expect(glob.match("b")).toBeTrue();
    expect(glob.match("c")).toBeTrue();

    // Empty nested group
    glob = new Glob("{a,b{}}");
    expect(glob.match("a")).toBeTrue();
    expect(glob.match("b")).toBeTrue();

    // Empty nested group with tail
    glob = new Glob("{a,b{,c{{}}}}d");
    expect(glob.match("ad")).toBeTrue();
    expect(glob.match("bcd")).toBeTrue();

    // Leading nested group
    glob = new Glob("{{a,b},c}");
    expect(glob.match("a")).toBeTrue();
    expect(glob.match("b")).toBeTrue();
    expect(glob.match("c")).toBeTrue();

    // Empty nested group in middle
    glob = new Glob("{a,b{c,d{}}}e");
    expect(glob.match("ae")).toBeTrue();
    expect(glob.match("bce")).toBeTrue();
    expect(glob.match("bde")).toBeTrue();
  });

  test("deeply nested braces do not overflow depth counters", () => {
    const opens = Buffer.alloc(300, "{").toString();
    const closes = Buffer.alloc(300, "}").toString();

    // First branch matches; skip_branch must scan past >255 nested braces to
    // find the closing brace of the outer group.
    let glob = new Glob("{a," + opens + closes + "}");
    expect(glob.match("a")).toBeTrue();
    expect(glob.match("b")).toBeFalse();

    // Deeply nested braces in the first (non-matching) branch, second branch matches.
    glob = new Glob("{" + opens + closes + ",a}");
    expect(glob.match("a")).toBeTrue();

    // Deep nest with content, surrounded by matching branches on both sides.
    glob = new Glob("{a," + opens + "x" + closes + ",b}");
    expect(glob.match("a")).toBeTrue();
    expect(glob.match("b")).toBeTrue();
    expect(glob.match("y")).toBeFalse();

    // Same shape inside a wildcard backtrack.
    glob = new Glob("*{a," + opens + closes + "}");
    expect(glob.match("za")).toBeTrue();

    // >32767 consecutive `{` overflows match_brace's group pre-scan counter.
    // The group never closes, so nothing matches.
    glob = new Glob(Buffer.alloc(40_000, "{").toString());
    expect(glob.match("a")).toBeFalse();
    expect(glob.match("{")).toBeFalse();
  });

  test("wide brace group with matching alternatives and failing tail is not quadratic", () => {
    // A group of N alternatives that each match the subject prefix, followed by
    // a tail that then fails, used to cost O(BRACE_BRANCH_BUDGET * N) because
    // every budgeted attempt re-scanned the whole group to find the closing `}`.
    // With the close-brace index cached per group that scan is O(1), so the
    // whole match() is O(N). Unfixed, each case below takes ~5 s release /
    // ~30 s ASAN; fixed, low single-digit ms. The 2 s budget is >100x headroom
    // over the fixed cost and >10x under the unfixed cost even in release.
    const budgetMs = 2000;

    for (const [label, pattern, path] of [
      ["150k '*' alternatives", "{" + Buffer.alloc(300_000, "*,").toString() + "*}b", "az"],
      ["300k literal-prefix alternatives", "{" + Buffer.alloc(600_000, "a,").toString() + "a}b", "az"],
      ["750k empty alternatives", "{" + Buffer.alloc(750_000, ",").toString() + "a}", "a"],
    ] as const) {
      const glob = new Glob(pattern);
      const t0 = performance.now();
      glob.match(path);
      const elapsed = performance.now() - t0;
      if (elapsed >= budgetMs) {
        throw new Error(`${label}: match() took ${elapsed.toFixed(0)} ms (budget ${budgetMs} ms)`);
      }
    }

    // Correctness is unchanged for the shapes above. Use smaller groups so the
    // pre-existing branch budget (which makes very wide groups return false
    // regardless of the fix) isn't hit.
    expect(new Glob("{" + Buffer.alloc(1000, "*,").toString() + "*}b").match("ab")).toBeTrue();
    expect(new Glob("{" + Buffer.alloc(1000, "*,").toString() + "*}b").match("az")).toBeFalse();
    expect(new Glob("{" + Buffer.alloc(1000, "a,").toString() + "a}b").match("ab")).toBeTrue();
    expect(new Glob("{" + Buffer.alloc(1000, "a,").toString() + "a}b").match("az")).toBeFalse();
    expect(new Glob("{" + Buffer.alloc(1000, ",").toString() + "a}").match("a")).toBeTrue();
    expect(new Glob("{" + Buffer.alloc(1000, ",").toString() + "a}").match("")).toBeTrue();
    expect(new Glob("{" + Buffer.alloc(1000, ",").toString() + "a}").match("b")).toBeFalse();
  });

  test("literal ',' or '}' after sequential brace groups", () => {
    // A `,`/`}` past the second group's `}` is a literal. Previously
    // `brace_depth` was set from the stack length (which still holds the first
    // group's frame) so the literal was treated as a separator and the whole
    // tail was skipped.
    expect(new Glob("{a,b}{c,d},x").match("ac,x")).toBeTrue();
    expect(new Glob("{a,b}{c,d},x").match("bd,x")).toBeTrue();
    expect(new Glob("{a,b}{c,d},x").match("ac")).toBeFalse();
    expect(new Glob("{a,b}{c,d}}x").match("ac}x")).toBeTrue();
    expect(new Glob("{a,b}/{c,d},x").match("a/c,x")).toBeTrue();
    expect(new Glob("{a,b}/{c,d},x").match("b/d,x")).toBeTrue();
    expect(new Glob("{a,b}/{c,d},x").match("a/c")).toBeFalse();
    // Single group followed by a literal `,` already worked; keep covered.
    expect(new Glob("{a,b},x").match("a,x")).toBeTrue();
    expect(new Glob("{a,b},x").match("b,x")).toBeTrue();
  });

  // Most of the potential bugs when dealing with non-ASCII patterns is when the
  // pattern matching algorithm wants to deal with single chars, for example
  // using the `[...]` syntax, it tries to match each char in the brackets. With
  // multi-byte string encodings this will break.
  test("non ascii", () => {
    let glob: Glob;

    glob = new Glob("😎/¢£.{ts,tsx,js,jsx}");
    expect(glob.match("😎/¢£.ts")).toBeTrue();
    expect(glob.match("😎/¢£.tsx")).toBeTrue();
    expect(glob.match("😎/¢£.js")).toBeTrue();
    expect(glob.match("😎/¢£.jsx")).toBeTrue();
    expect(glob.match("😎/¢£.jsxxxxxxxx")).toBeFalse();

    // wildcard before and after non-ascii
    glob = new Glob("*é*");
    expect(glob.match("café noir")).toBeTrue();
    expect(glob.match("café noir")).toBeTrue();
    expect(glob.match("é")).toBeTrue();
    glob = new Glob("*😎");
    expect(glob.match("😎")).toBeTrue();
    expect(glob.match("ëëëëëë😎")).toBeTrue();

    // wildcard matches non-ascii
    glob = new Glob("caf*noir");
    expect(glob.match("café noir")).toBeTrue();
    expect(glob.match("café noir")).toBeTrue();
    expect(glob.match("cafeenoir")).toBeTrue();

    // character class match non-ascii
    glob = new Glob("F[ë£a]");
    expect(glob.match("Fë")).toBeTrue();
    expect(glob.match("F£")).toBeTrue();
    expect(glob.match("Fa")).toBeTrue();

    // ? matches any single character
    glob = new Glob("?ëlmao");
    expect(glob.match("ëlmao")).toBeFalse();
    expect(glob.match("ëëlmao")).toBeTrue();
    expect(glob.match("fëlmao")).toBeTrue();
    expect(glob.match("lmao")).toBeFalse();

    // braces match non-ascii
    glob = new Glob("F{ë,£,a}");
    expect(glob.match("Fë")).toBeTrue();
    expect(glob.match("F£")).toBeTrue();
    expect(glob.match("Fa")).toBeTrue();
    expect(glob.match("Fb")).toBeFalse();
    expect(glob.match("F😎")).toBeFalse();

    // escape matches non-ascii
    glob = new Glob("\\😎");
    expect(glob.match("😎")).toBeTrue();

    // invalid surrogate pairs
    glob = new Glob("\uD83D\u0027");
    expect(glob.match("lmao")).toBeFalse();

    glob = new Glob("\uD800\uD800");
    expect(glob.match("lmao")).toBeFalse();

    glob = new Glob("*");
    expect(glob.match("\uD800\uD800")).toBeTrue();

    glob = new Glob("hello/*/friends");
    expect(glob.match("hello/\uD800\uD800/friends")).toBeTrue();

    glob = new Glob("*.{js,\uD83D\u0027}");
    expect(glob.match("runtime.node.pre.out.ts")).toBeFalse();
    expect(glob.match("runtime.node.pre.out.js")).toBeTrue();
  });

  /**
   * These tests are ported from micromatch, glob-match, globlin
   */
  describe("ported from micromatch / glob-match / globlin tests", () => {
    test("basic", () => {
      expect(new Glob("abc").match("abc")).toBe(true);
      expect(new Glob("*").match("abc")).toBe(true);
      expect(new Glob("*").match("")).toBe(true);
      expect(new Glob("**").match("")).toBe(true);
      expect(new Glob("*c").match("abc")).toBe(true);
      expect(new Glob("*b").match("abc")).toBe(false);
      expect(new Glob("a*").match("abc")).toBe(true);
      expect(new Glob("b*").match("abc")).toBe(false);
      expect(new Glob("a*").match("a")).toBe(true);
      expect(new Glob("*a").match("a")).toBe(true);
      expect(new Glob("a*b*c*d*e*").match("axbxcxdxe")).toBe(true);
      expect(new Glob("a*b*c*d*e*").match("axbxcxdxexxx")).toBe(true);
      expect(new Glob("a*b?c*x").match("abxbbxdbxebxczzx")).toBe(true);
      expect(new Glob("a*b?c*x").match("abxbbxdbxebxczzy")).toBe(false);

      expect(new Glob("a/*/test").match("a/foo/test")).toBe(true);
      expect(new Glob("a/*/test").match("a/foo/bar/test")).toBe(false);
      expect(new Glob("a/**/test").match("a/foo/test")).toBe(true);
      expect(new Glob("a/**/test").match("a/foo/bar/test")).toBe(true);
      expect(new Glob("a/**/b/c").match("a/foo/bar/b/c")).toBe(true);
      expect(new Glob("a\\*b").match("a*b")).toBe(true);
      expect(new Glob("a\\*b").match("axb")).toBe(false);

      expect(new Glob("[abc]").match("a")).toBe(true);
      expect(new Glob("[abc]").match("b")).toBe(true);
      expect(new Glob("[abc]").match("c")).toBe(true);
      expect(new Glob("[abc]").match("d")).toBe(false);
      expect(new Glob("x[abc]x").match("xax")).toBe(true);
      expect(new Glob("x[abc]x").match("xbx")).toBe(true);
      expect(new Glob("x[abc]x").match("xcx")).toBe(true);
      expect(new Glob("x[abc]x").match("xdx")).toBe(false);
      expect(new Glob("x[abc]x").match("xay")).toBe(false);
      expect(new Glob("[?]").match("?")).toBe(true);
      expect(new Glob("[?]").match("a")).toBe(false);
      expect(new Glob("[*]").match("*")).toBe(true);
      expect(new Glob("[*]").match("a")).toBe(false);

      expect(new Glob("[a-cx]").match("a")).toBe(true);
      expect(new Glob("[a-cx]").match("b")).toBe(true);
      expect(new Glob("[a-cx]").match("c")).toBe(true);
      expect(new Glob("[a-cx]").match("d")).toBe(false);
      expect(new Glob("[a-cx]").match("x")).toBe(true);

      expect(new Glob("[^abc]").match("a")).toBe(false);
      expect(new Glob("[^abc]").match("b")).toBe(false);
      expect(new Glob("[^abc]").match("c")).toBe(false);
      expect(new Glob("[^abc]").match("d")).toBe(true);
      expect(new Glob("[!abc]").match("a")).toBe(false);
      expect(new Glob("[!abc]").match("b")).toBe(false);
      expect(new Glob("[!abc]").match("c")).toBe(false);
      expect(new Glob("[!abc]").match("d")).toBe(true);
      expect(new Glob("[\\!]").match("!")).toBe(true);

      expect(new Glob("a*b*[cy]*d*e*").match("axbxcxdxexxx")).toBe(true);
      expect(new Glob("a*b*[cy]*d*e*").match("axbxyxdxexxx")).toBe(true);
      expect(new Glob("a*b*[cy]*d*e*").match("axbxxxyxdxexxx")).toBe(true);

      expect(new Glob("test.{jpg,png}").match("test.jpg")).toBe(true);
      expect(new Glob("test.{jpg,png}").match("test.png")).toBe(true);
      expect(new Glob("test.{j*g,p*g}").match("test.jpg")).toBe(true);
      expect(new Glob("test.{j*g,p*g}").match("test.jpxxxg")).toBe(true);
      expect(new Glob("test.{j*g,p*g}").match("test.jxg")).toBe(true);
      expect(new Glob("test.{j*g,p*g}").match("test.jnt")).toBe(false);
      expect(new Glob("test.{j*g,j*c}").match("test.jnc")).toBe(true);
      expect(new Glob("test.{jpg,p*g}").match("test.png")).toBe(true);
      expect(new Glob("test.{jpg,p*g}").match("test.pxg")).toBe(true);
      expect(new Glob("test.{jpg,p*g}").match("test.pnt")).toBe(false);
      expect(new Glob("test.{jpeg,png}").match("test.jpeg")).toBe(true);
      expect(new Glob("test.{jpeg,png}").match("test.jpg")).toBe(false);
      expect(new Glob("test.{jpeg,png}").match("test.png")).toBe(true);
      expect(new Glob("test.{jp\\,g,png}").match("test.jp,g")).toBe(true);
      expect(new Glob("test.{jp\\,g,png}").match("test.jxg")).toBe(false);
      expect(new Glob("test/{foo,bar}/baz").match("test/foo/baz")).toBe(true);
      expect(new Glob("test/{foo,bar}/baz").match("test/bar/baz")).toBe(true);
      expect(new Glob("test/{foo,bar}/baz").match("test/baz/baz")).toBe(false);
      expect(new Glob("test/{foo*,bar*}/baz").match("test/foooooo/baz")).toBe(true);
      expect(new Glob("test/{foo*,bar*}/baz").match("test/barrrrr/baz")).toBe(true);
      expect(new Glob("test/{*foo,*bar}/baz").match("test/xxxxfoo/baz")).toBe(true);
      expect(new Glob("test/{*foo,*bar}/baz").match("test/xxxxbar/baz")).toBe(true);
      expect(new Glob("test/{foo/**,bar}/baz").match("test/bar/baz")).toBe(true);
      expect(new Glob("test/{foo/**,bar}/baz").match("test/bar/test/baz")).toBe(false);

      expect(new Glob("*.txt").match("some/big/path/to/the/needle.txt")).toBe(false);
      expect(
        new Glob("some/**/needle.{js,tsx,mdx,ts,jsx,txt}").match("some/a/bigger/path/to/the/crazy/needle.txt"),
      ).toBe(true);
      expect(new Glob("some/**/{a,b,c}/**/needle.txt").match("some/foo/a/bigger/path/to/the/crazy/needle.txt")).toBe(
        true,
      );
      expect(new Glob("some/**/{a,b,c}/**/needle.txt").match("some/foo/d/bigger/path/to/the/crazy/needle.txt")).toBe(
        false,
      );
      expect(new Glob("a/{a{a,b},b}").match("a/aa")).toBe(true);
      expect(new Glob("a/{a{a,b},b}").match("a/ab")).toBe(true);
      expect(new Glob("a/{a{a,b},b}").match("a/ac")).toBe(false);
      expect(new Glob("a/{a{a,b},b}").match("a/b")).toBe(true);
      expect(new Glob("a/{a{a,b},b}").match("a/c")).toBe(false);
      expect(new Glob("a/{b,c[}]*}").match("a/b")).toBe(true);
      expect(new Glob("a/{b,c[}]*}").match("a/c}xx")).toBe(true);
    });

    // The below tests are based on Bash and micromatch.
    // https://github.com/micromatch/picomatch/blob/master/test/bash.js
    test("bash", () => {
      expect(new Glob("a*").match("*")).toBeFalse();
      expect(new Glob("a*").match("**")).toBeFalse();
      expect(new Glob("a*").match("\\*")).toBeFalse();
      expect(new Glob("a*").match("a/*")).toBeFalse();
      expect(new Glob("a*").match("b")).toBeFalse();
      expect(new Glob("a*").match("bc")).toBeFalse();
      expect(new Glob("a*").match("bcd")).toBeFalse();
      expect(new Glob("a*").match("bdir/")).toBeFalse();
      expect(new Glob("a*").match("Beware")).toBeFalse();
      expect(new Glob("a*").match("a")).toBeTrue();
      expect(new Glob("a*").match("ab")).toBeTrue();
      expect(new Glob("a*").match("abc")).toBeTrue();

      expect(new Glob("\\a*").match("*")).toBeFalse();
      expect(new Glob("\\a*").match("**")).toBeFalse();
      expect(new Glob("\\a*").match("\\*")).toBeFalse();

      expect(new Glob("\\a*").match("a")).toBeTrue();
      expect(new Glob("\\a*").match("a/*")).toBeFalse();
      expect(new Glob("\\a*").match("abc")).toBeTrue();
      expect(new Glob("\\a*").match("abd")).toBeTrue();
      expect(new Glob("\\a*").match("abe")).toBeTrue();
      expect(new Glob("\\a*").match("b")).toBeFalse();
      expect(new Glob("\\a*").match("bb")).toBeFalse();
      expect(new Glob("\\a*").match("bcd")).toBeFalse();
      expect(new Glob("\\a*").match("bdir/")).toBeFalse();
      expect(new Glob("\\a*").match("Beware")).toBeFalse();
      expect(new Glob("\\a*").match("c")).toBeFalse();
      expect(new Glob("\\a*").match("ca")).toBeFalse();
      expect(new Glob("\\a*").match("cb")).toBeFalse();
      expect(new Glob("\\a*").match("d")).toBeFalse();
      expect(new Glob("\\a*").match("dd")).toBeFalse();
      expect(new Glob("\\a*").match("de")).toBeFalse();
    });

    test("bash directories", () => {
      expect(new Glob("b*/").match("*")).toBeFalse();
      expect(new Glob("b*/").match("**")).toBeFalse();
      expect(new Glob("b*/").match("\\*")).toBeFalse();
      expect(new Glob("b*/").match("a")).toBeFalse();
      expect(new Glob("b*/").match("a/*")).toBeFalse();
      expect(new Glob("b*/").match("abc")).toBeFalse();
      expect(new Glob("b*/").match("abd")).toBeFalse();
      expect(new Glob("b*/").match("abe")).toBeFalse();
      expect(new Glob("b*/").match("b")).toBeFalse();
      expect(new Glob("b*/").match("bb")).toBeFalse();
      expect(new Glob("b*/").match("bcd")).toBeFalse();
      expect(new Glob("b*/").match("bdir/")).toBeTrue();
      expect(new Glob("b*/").match("Beware")).toBeFalse();
      expect(new Glob("b*/").match("c")).toBeFalse();
      expect(new Glob("b*/").match("ca")).toBeFalse();
      expect(new Glob("b*/").match("cb")).toBeFalse();
      expect(new Glob("b*/").match("d")).toBeFalse();
      expect(new Glob("b*/").match("dd")).toBeFalse();
      expect(new Glob("b*/").match("de")).toBeFalse();
    });

    test("bash escaping", () => {
      expect(new Glob("\\^").match("*")).toBeFalse();
      expect(new Glob("\\^").match("**")).toBeFalse();
      expect(new Glob("\\^").match("\\*")).toBeFalse();
      expect(new Glob("\\^").match("a")).toBeFalse();
      expect(new Glob("\\^").match("a/*")).toBeFalse();
      expect(new Glob("\\^").match("abc")).toBeFalse();
      expect(new Glob("\\^").match("abd")).toBeFalse();
      expect(new Glob("\\^").match("abe")).toBeFalse();
      expect(new Glob("\\^").match("b")).toBeFalse();
      expect(new Glob("\\^").match("bb")).toBeFalse();
      expect(new Glob("\\^").match("bcd")).toBeFalse();
      expect(new Glob("\\^").match("bdir/")).toBeFalse();
      expect(new Glob("\\^").match("Beware")).toBeFalse();
      expect(new Glob("\\^").match("c")).toBeFalse();
      expect(new Glob("\\^").match("ca")).toBeFalse();
      expect(new Glob("\\^").match("cb")).toBeFalse();
      expect(new Glob("\\^").match("d")).toBeFalse();
      expect(new Glob("\\^").match("dd")).toBeFalse();
      expect(new Glob("\\^").match("de")).toBeFalse();

      expect(new Glob("\\*").match("*")).toBeTrue();
      // expect(new Glob("\\*").match("\\*")).toBeTrue(); // This line is commented out in the original test
      expect(new Glob("\\*").match("**")).toBeFalse();
      expect(new Glob("\\*").match("a")).toBeFalse();
      expect(new Glob("\\*").match("a/*")).toBeFalse();
      expect(new Glob("\\*").match("abc")).toBeFalse();
      expect(new Glob("\\*").match("abd")).toBeFalse();
      expect(new Glob("\\*").match("abe")).toBeFalse();
      expect(new Glob("\\*").match("b")).toBeFalse();
      expect(new Glob("\\*").match("bb")).toBeFalse();
      expect(new Glob("\\*").match("bcd")).toBeFalse();
      expect(new Glob("\\*").match("bdir/")).toBeFalse();
      expect(new Glob("\\*").match("Beware")).toBeFalse();
      expect(new Glob("\\*").match("c")).toBeFalse();
      expect(new Glob("\\*").match("ca")).toBeFalse();
      expect(new Glob("\\*").match("cb")).toBeFalse();
      expect(new Glob("\\*").match("d")).toBeFalse();
      expect(new Glob("\\*").match("dd")).toBeFalse();
      expect(new Glob("\\*").match("de")).toBeFalse();

      expect(new Glob("a\\*").match("*")).toBeFalse();
      expect(new Glob("a\\*").match("**")).toBeFalse();
      expect(new Glob("a\\*").match("\\*")).toBeFalse();
      expect(new Glob("a\\*").match("a")).toBeFalse();
      expect(new Glob("a\\*").match("a/*")).toBeFalse();
      expect(new Glob("a\\*").match("abc")).toBeFalse();
      expect(new Glob("a\\*").match("abd")).toBeFalse();
      expect(new Glob("a\\*").match("abe")).toBeFalse();
      expect(new Glob("a\\*").match("b")).toBeFalse();
      expect(new Glob("a\\*").match("bb")).toBeFalse();
      expect(new Glob("a\\*").match("bcd")).toBeFalse();
      expect(new Glob("a\\*").match("bdir/")).toBeFalse();
      expect(new Glob("a\\*").match("Beware")).toBeFalse();
      expect(new Glob("a\\*").match("c")).toBeFalse();
      expect(new Glob("a\\*").match("ca")).toBeFalse();
      expect(new Glob("a\\*").match("cb")).toBeFalse();
      expect(new Glob("a\\*").match("d")).toBeFalse();
      expect(new Glob("a\\*").match("dd")).toBeFalse();
      expect(new Glob("a\\*").match("de")).toBeFalse();

      expect(new Glob("*q*").match("aqa")).toBeTrue();
      expect(new Glob("*q*").match("aaqaa")).toBeTrue();
      expect(new Glob("*q*").match("*")).toBeFalse();
      expect(new Glob("*q*").match("**")).toBeFalse();
      expect(new Glob("*q*").match("\\*")).toBeFalse();
      expect(new Glob("*q*").match("a")).toBeFalse();
      expect(new Glob("*q*").match("a/*")).toBeFalse();
      expect(new Glob("*q*").match("abc")).toBeFalse();
      expect(new Glob("*q*").match("abd")).toBeFalse();
      expect(new Glob("*q*").match("abe")).toBeFalse();
      expect(new Glob("*q*").match("b")).toBeFalse();
      expect(new Glob("*q*").match("bb")).toBeFalse();
      expect(new Glob("*q*").match("bcd")).toBeFalse();
      expect(new Glob("*q*").match("bdir/")).toBeFalse();
      expect(new Glob("*q*").match("Beware")).toBeFalse();
      expect(new Glob("*q*").match("c")).toBeFalse();
      expect(new Glob("*q*").match("ca")).toBeFalse();
      expect(new Glob("*q*").match("cb")).toBeFalse();
      expect(new Glob("*q*").match("d")).toBeFalse();
      expect(new Glob("*q*").match("dd")).toBeFalse();
      expect(new Glob("*q*").match("de")).toBeFalse();

      expect(new Glob("\\**").match("*")).toBeTrue();
      expect(new Glob("\\**").match("**")).toBeTrue();
      expect(new Glob("\\**").match("\\*")).toBeFalse();
      expect(new Glob("\\**").match("a")).toBeFalse();
      expect(new Glob("\\**").match("a/*")).toBeFalse();
      expect(new Glob("\\**").match("abc")).toBeFalse();
      expect(new Glob("\\**").match("abd")).toBeFalse();
      expect(new Glob("\\**").match("abe")).toBeFalse();
      expect(new Glob("\\**").match("b")).toBeFalse();
      expect(new Glob("\\**").match("bb")).toBeFalse();
      expect(new Glob("\\**").match("bcd")).toBeFalse();
      expect(new Glob("\\**").match("bdir/")).toBeFalse();
      expect(new Glob("\\**").match("Beware")).toBeFalse();
      expect(new Glob("\\**").match("c")).toBeFalse();
      expect(new Glob("\\**").match("ca")).toBeFalse();
      expect(new Glob("\\**").match("cb")).toBeFalse();
      expect(new Glob("\\**").match("d")).toBeFalse();
      expect(new Glob("\\**").match("dd")).toBeFalse();
      expect(new Glob("\\**").match("de")).toBeFalse();
    });

    test("bash classes", () => {
      expect(new Glob("a*[^c]").match("*")).toBeFalse();
      expect(new Glob("a*[^c]").match("**")).toBeFalse();
      expect(new Glob("a*[^c]").match("\\*")).toBeFalse();
      expect(new Glob("a*[^c]").match("a")).toBeFalse();
      expect(new Glob("a*[^c]").match("a/*")).toBeFalse();
      expect(new Glob("a*[^c]").match("abc")).toBeFalse();
      expect(new Glob("a*[^c]").match("abd")).toBeTrue();
      expect(new Glob("a*[^c]").match("abe")).toBeTrue();
      expect(new Glob("a*[^c]").match("b")).toBeFalse();
      expect(new Glob("a*[^c]").match("bb")).toBeFalse();
      expect(new Glob("a*[^c]").match("bcd")).toBeFalse();
      expect(new Glob("a*[^c]").match("bdir/")).toBeFalse();
      expect(new Glob("a*[^c]").match("Beware")).toBeFalse();
      expect(new Glob("a*[^c]").match("c")).toBeFalse();
      expect(new Glob("a*[^c]").match("ca")).toBeFalse();
      expect(new Glob("a*[^c]").match("cb")).toBeFalse();
      expect(new Glob("a*[^c]").match("d")).toBeFalse();
      expect(new Glob("a*[^c]").match("dd")).toBeFalse();
      expect(new Glob("a*[^c]").match("de")).toBeFalse();
      expect(new Glob("a*[^c]").match("baz")).toBeFalse();
      expect(new Glob("a*[^c]").match("bzz")).toBeFalse();
      expect(new Glob("a*[^c]").match("BZZ")).toBeFalse();
      expect(new Glob("a*[^c]").match("beware")).toBeFalse();
      expect(new Glob("a*[^c]").match("BewAre")).toBeFalse();
      expect(new Glob("a[X-]b").match("a-b")).toBeTrue();
      expect(new Glob("a[X-]b").match("aXb")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("*")).toBeFalse();
      expect(new Glob("[a-y]*[^c]").match("a*")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("**")).toBeFalse();
      expect(new Glob("[a-y]*[^c]").match("\\*")).toBeFalse();
      expect(new Glob("[a-y]*[^c]").match("a")).toBeFalse();
      expect(new Glob("[a-y]*[^c]").match("a123b")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("a123c")).toBeFalse();
      expect(new Glob("[a-y]*[^c]").match("ab")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("a/*")).toBeFalse();
      expect(new Glob("[a-y]*[^c]").match("abc")).toBeFalse();
      expect(new Glob("[a-y]*[^c]").match("abd")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("abe")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("b")).toBeFalse();
      expect(new Glob("[a-y]*[^c]").match("bd")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("bb")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("bcd")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("bdir/")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("Beware")).toBeFalse();
      expect(new Glob("[a-y]*[^c]").match("c")).toBeFalse();
      expect(new Glob("[a-y]*[^c]").match("ca")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("cb")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("d")).toBeFalse();
      expect(new Glob("[a-y]*[^c]").match("dd")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("dd")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("dd")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("de")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("baz")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("bzz")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("bzz")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("BZZ")).toBeFalse();
      expect(new Glob("[a-y]*[^c]").match("beware")).toBeTrue();
      expect(new Glob("[a-y]*[^c]").match("BewAre")).toBeFalse();
      expect(new Glob("a\\*b/*").match("a*b/ooo")).toBeTrue();
      expect(new Glob("a\\*?/*").match("a*b/ooo")).toBeTrue();
      expect(new Glob("a[b]c").match("*")).toBeFalse();
      expect(new Glob("a[b]c").match("**")).toBeFalse();
      expect(new Glob("a[b]c").match("\\*")).toBeFalse();
      expect(new Glob("a[b]c").match("a")).toBeFalse();
      expect(new Glob("a[b]c").match("a/*")).toBeFalse();
      expect(new Glob("a[b]c").match("abc")).toBeTrue();
      expect(new Glob("a[b]c").match("abd")).toBeFalse();
      expect(new Glob("a[b]c").match("abe")).toBeFalse();
      expect(new Glob("a[b]c").match("b")).toBeFalse();
      expect(new Glob("a[b]c").match("bb")).toBeFalse();
      expect(new Glob("a[b]c").match("bcd")).toBeFalse();
      expect(new Glob("a[b]c").match("bdir/")).toBeFalse();
      expect(new Glob("a[b]c").match("Beware")).toBeFalse();
      expect(new Glob("a[b]c").match("c")).toBeFalse();
      expect(new Glob("a[b]c").match("ca")).toBeFalse();
      expect(new Glob("a[b]c").match("cb")).toBeFalse();
      expect(new Glob("a[b]c").match("d")).toBeFalse();
      expect(new Glob("a[b]c").match("dd")).toBeFalse();
      expect(new Glob("a[b]c").match("de")).toBeFalse();
      expect(new Glob("a[b]c").match("baz")).toBeFalse();
      expect(new Glob("a[b]c").match("bzz")).toBeFalse();
      expect(new Glob("a[b]c").match("BZZ")).toBeFalse();
      expect(new Glob("a[b]c").match("beware")).toBeFalse();
      expect(new Glob("a[b]c").match("BewAre")).toBeFalse();
      expect(new Glob('a["b"]c').match("*")).toBeFalse();
      expect(new Glob('a["b"]c').match("**")).toBeFalse();
      expect(new Glob('a["b"]c').match("\\*")).toBeFalse();
      expect(new Glob('a["b"]c').match("a")).toBeFalse();
      expect(new Glob('a["b"]c').match("a/*")).toBeFalse();
      expect(new Glob('a["b"]c').match("abc")).toBeTrue();
      expect(new Glob('a["b"]c').match("abd")).toBeFalse();
      expect(new Glob('a["b"]c').match("abe")).toBeFalse();
      expect(new Glob('a["b"]c').match("b")).toBeFalse();
      expect(new Glob('a["b"]c').match("bb")).toBeFalse();
      expect(new Glob('a["b"]c').match("bcd")).toBeFalse();
      expect(new Glob('a["b"]c').match("bdir/")).toBeFalse();
      expect(new Glob('a["b"]c').match("Beware")).toBeFalse();
      expect(new Glob('a["b"]c').match("c")).toBeFalse();
      expect(new Glob('a["b"]c').match("ca")).toBeFalse();
      expect(new Glob('a["b"]c').match("cb")).toBeFalse();
      expect(new Glob('a["b"]c').match("d")).toBeFalse();
      expect(new Glob('a["b"]c').match("dd")).toBeFalse();
      expect(new Glob('a["b"]c').match("de")).toBeFalse();
      expect(new Glob('a["b"]c').match("baz")).toBeFalse();
      expect(new Glob('a["b"]c').match("bzz")).toBeFalse();
      expect(new Glob('a["b"]c').match("BZZ")).toBeFalse();
      expect(new Glob('a["b"]c').match("beware")).toBeFalse();
      expect(new Glob('a["b"]c').match("BewAre")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("*")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("**")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("\\*")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("a")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("a/*")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("abc")).toBeTrue();
      expect(new Glob("a[\\\\b]c").match("abd")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("abe")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("b")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("bb")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("bcd")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("bdir/")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("Beware")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("c")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("ca")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("cb")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("d")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("dd")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("de")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("baz")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("bzz")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("BZZ")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("beware")).toBeFalse();
      expect(new Glob("a[\\\\b]c").match("BewAre")).toBeFalse();
      expect(new Glob("a[\\b]c").match("*")).toBeFalse();
      expect(new Glob("a[\\b]c").match("**")).toBeFalse();
      expect(new Glob("a[\\b]c").match("\\*")).toBeFalse();
      expect(new Glob("a[\\b]c").match("a")).toBeFalse();
      expect(new Glob("a[\\b]c").match("a/*")).toBeFalse();
      expect(new Glob("a[\\b]c").match("abc")).toBeFalse();
      expect(new Glob("a[\\b]c").match("abd")).toBeFalse();
      expect(new Glob("a[\\b]c").match("abe")).toBeFalse();
      expect(new Glob("a[\\b]c").match("b")).toBeFalse();
      expect(new Glob("a[\\b]c").match("bb")).toBeFalse();
      expect(new Glob("a[\\b]c").match("bcd")).toBeFalse();
      expect(new Glob("a[\\b]c").match("bdir/")).toBeFalse();
      expect(new Glob("a[\\b]c").match("Beware")).toBeFalse();
      expect(new Glob("a[\\b]c").match("c")).toBeFalse();
      expect(new Glob("a[\\b]c").match("ca")).toBeFalse();
      expect(new Glob("a[\\b]c").match("cb")).toBeFalse();
      expect(new Glob("a[\\b]c").match("d")).toBeFalse();
      expect(new Glob("a[\\b]c").match("dd")).toBeFalse();
      expect(new Glob("a[\\b]c").match("de")).toBeFalse();
      expect(new Glob("a[\\b]c").match("baz")).toBeFalse();
      expect(new Glob("a[\\b]c").match("bzz")).toBeFalse();
      expect(new Glob("a[\\b]c").match("BZZ")).toBeFalse();
      expect(new Glob("a[\\b]c").match("beware")).toBeFalse();
      expect(new Glob("a[\\b]c").match("BewAre")).toBeFalse();
      expect(new Glob("a[b-d]c").match("*")).toBeFalse();
      expect(new Glob("a[b-d]c").match("**")).toBeFalse();
      expect(new Glob("a[b-d]c").match("\\*")).toBeFalse();
      expect(new Glob("a[b-d]c").match("a")).toBeFalse();
      expect(new Glob("a[b-d]c").match("a/*")).toBeFalse();
      expect(new Glob("a[b-d]c").match("abc")).toBeTrue();
      expect(new Glob("a[b-d]c").match("abd")).toBeFalse();
      expect(new Glob("a[b-d]c").match("abe")).toBeFalse();
      expect(new Glob("a[b-d]c").match("b")).toBeFalse();
      expect(new Glob("a[b-d]c").match("bb")).toBeFalse();
      expect(new Glob("a[b-d]c").match("bcd")).toBeFalse();
      expect(new Glob("a[b-d]c").match("bdir/")).toBeFalse();
      expect(new Glob("a[b-d]c").match("Beware")).toBeFalse();
      expect(new Glob("a[b-d]c").match("c")).toBeFalse();
      expect(new Glob("a[b-d]c").match("ca")).toBeFalse();
      expect(new Glob("a[b-d]c").match("cb")).toBeFalse();
      expect(new Glob("a[b-d]c").match("d")).toBeFalse();
      expect(new Glob("a[b-d]c").match("dd")).toBeFalse();
      expect(new Glob("a[b-d]c").match("de")).toBeFalse();
      expect(new Glob("a[b-d]c").match("baz")).toBeFalse();
      expect(new Glob("a[b-d]c").match("bzz")).toBeFalse();
      expect(new Glob("a[b-d]c").match("BZZ")).toBeFalse();
      expect(new Glob("a[b-d]c").match("beware")).toBeFalse();
      expect(new Glob("a[b-d]c").match("BewAre")).toBeFalse();
      expect(new Glob("a?c").match("*")).toBeFalse();
      expect(new Glob("a?c").match("**")).toBeFalse();
      expect(new Glob("a?c").match("\\*")).toBeFalse();
      expect(new Glob("a?c").match("a")).toBeFalse();
      expect(new Glob("a?c").match("a/*")).toBeFalse();
      expect(new Glob("a?c").match("abc")).toBeTrue();
      expect(new Glob("a?c").match("abd")).toBeFalse();
      expect(new Glob("a?c").match("abe")).toBeFalse();
      expect(new Glob("a?c").match("b")).toBeFalse();
      expect(new Glob("a?c").match("bb")).toBeFalse();
      expect(new Glob("a?c").match("bcd")).toBeFalse();
      expect(new Glob("a?c").match("bdir/")).toBeFalse();
      expect(new Glob("a?c").match("Beware")).toBeFalse();
      expect(new Glob("a?c").match("c")).toBeFalse();
      expect(new Glob("a?c").match("ca")).toBeFalse();
      expect(new Glob("a?c").match("cb")).toBeFalse();
      expect(new Glob("a?c").match("d")).toBeFalse();
      expect(new Glob("a?c").match("dd")).toBeFalse();
      expect(new Glob("a?c").match("de")).toBeFalse();
      expect(new Glob("a?c").match("baz")).toBeFalse();
      expect(new Glob("a?c").match("bzz")).toBeFalse();
      expect(new Glob("a?c").match("BZZ")).toBeFalse();
      expect(new Glob("a?c").match("beware")).toBeFalse();
      expect(new Glob("a?c").match("BewAre")).toBeFalse();
      expect(new Glob("*/man*/bash.*").match("man/man1/bash.1")).toBeTrue();
      expect(new Glob("[^a-c]*").match("*")).toBeTrue();
      expect(new Glob("[^a-c]*").match("**")).toBeTrue();
      expect(new Glob("[^a-c]*").match("a")).toBeFalse();
      expect(new Glob("[^a-c]*").match("a/*")).toBeFalse();
      expect(new Glob("[^a-c]*").match("abc")).toBeFalse();
      expect(new Glob("[^a-c]*").match("abd")).toBeFalse();
      expect(new Glob("[^a-c]*").match("abe")).toBeFalse();
      expect(new Glob("[^a-c]*").match("b")).toBeFalse();
      expect(new Glob("[^a-c]*").match("bb")).toBeFalse();
      expect(new Glob("[^a-c]*").match("bcd")).toBeFalse();
      expect(new Glob("[^a-c]*").match("bdir/")).toBeFalse();
      expect(new Glob("[^a-c]*").match("Beware")).toBeTrue();
      expect(new Glob("[^a-c]*").match("Beware")).toBeTrue();
      expect(new Glob("[^a-c]*").match("c")).toBeFalse();
      expect(new Glob("[^a-c]*").match("ca")).toBeFalse();
      expect(new Glob("[^a-c]*").match("cb")).toBeFalse();
      expect(new Glob("[^a-c]*").match("d")).toBeTrue();
      expect(new Glob("[^a-c]*").match("dd")).toBeTrue();
      expect(new Glob("[^a-c]*").match("de")).toBeTrue();
      expect(new Glob("[^a-c]*").match("baz")).toBeFalse();
      expect(new Glob("[^a-c]*").match("bzz")).toBeFalse();
      expect(new Glob("[^a-c]*").match("BZZ")).toBeTrue();
      expect(new Glob("[^a-c]*").match("beware")).toBeFalse();
      expect(new Glob("[^a-c]*").match("BewAre")).toBeTrue();
    });

    test("square braces", () => {
      expect(new Glob("src/*.[tj]s").match("src/foo.js")).toBeTrue();
      expect(new Glob("src/*.[tj]s").match("src/foo.ts")).toBeTrue();
      expect(new Glob("foo/ba[rz].md").match("foo/bar.md")).toBeTrue();
      expect(new Glob("foo/ba[rz].md").match("foo/baz.md")).toBeTrue();
    });

    test("bash wildmatch", () => {
      expect(new Glob("a[]-]b").match("aab")).toBeFalse();
      expect(new Glob("[ten]").match("ten")).toBeFalse();
      expect(new Glob("]").match("]")).toBeTrue();
      expect(new Glob("a[]-]b").match("a-b")).toBeTrue();
      expect(new Glob("a[]-]b").match("a]b")).toBeTrue();
      expect(new Glob("a[]]b").match("a]b")).toBeTrue();
      expect(new Glob("a[\\]a\\-]b").match("aab")).toBeTrue();
      expect(new Glob("t[a-g]n").match("ten")).toBeTrue();
      expect(new Glob("t[^a-g]n").match("ton")).toBeTrue();
    });

    test("bash slashmatch", () => {
      expect(new Glob("foo[/]bar").match("foo/bar")).toBeTrue();
      expect(new Glob("f[^eiu][^eiu][^eiu][^eiu][^eiu]r").match("foo-bar")).toBeTrue();
    });

    test("bash extra_stars", () => {
      expect(new Glob("a**c").match("bbc")).toBeFalse();
      expect(new Glob("a**c").match("abc")).toBeTrue();
      expect(new Glob("a**c").match("bbd")).toBeFalse();
      expect(new Glob("a***c").match("bbc")).toBeFalse();
      expect(new Glob("a***c").match("abc")).toBeTrue();
      expect(new Glob("a***c").match("bbd")).toBeFalse();
      expect(new Glob("a*****?c").match("bbc")).toBeFalse();
      expect(new Glob("a*****?c").match("abc")).toBeTrue();
      expect(new Glob("a*****?c").match("bbc")).toBeFalse();
      expect(new Glob("?*****??").match("bbc")).toBeTrue();
      expect(new Glob("?*****??").match("abc")).toBeTrue();
      expect(new Glob("*****??").match("bbc")).toBeTrue();
      expect(new Glob("*****??").match("abc")).toBeTrue();
      expect(new Glob("?*****?c").match("bbc")).toBeTrue();
      expect(new Glob("?*****?c").match("abc")).toBeTrue();
      expect(new Glob("?***?****c").match("bbc")).toBeTrue();
      expect(new Glob("?***?****c").match("abc")).toBeTrue();
      expect(new Glob("?***?****c").match("bbd")).toBeFalse();
      expect(new Glob("?***?****?").match("bbc")).toBeTrue();
      expect(new Glob("?***?****?").match("abc")).toBeTrue();
      expect(new Glob("?***?****").match("bbc")).toBeTrue();
      expect(new Glob("?***?****").match("abc")).toBeTrue();
      expect(new Glob("*******c").match("bbc")).toBeTrue();
      expect(new Glob("*******c").match("abc")).toBeTrue();
      expect(new Glob("*******?").match("bbc")).toBeTrue();
      expect(new Glob("*******?").match("abc")).toBeTrue();
      expect(new Glob("a*cd**?**??k").match("abcdecdhjk")).toBeTrue();
      expect(new Glob("a**?**cd**?**??k").match("abcdecdhjk")).toBeTrue();
      expect(new Glob("a**?**cd**?**??k***").match("abcdecdhjk")).toBeTrue();
      expect(new Glob("a**?**cd**?**??***k").match("abcdecdhjk")).toBeTrue();
      expect(new Glob("a**?**cd**?**??***k**").match("abcdecdhjk")).toBeTrue();
      expect(new Glob("a****c**?**??*****").match("abcdecdhjk")).toBeTrue();
    });

    test("stars", () => {
      expect(new Glob("*.js").match("a/b/c/z.js")).toBeFalse();
      expect(new Glob("*.js").match("a/b/z.js")).toBeFalse();
      expect(new Glob("*.js").match("a/z.js")).toBeFalse();
      expect(new Glob("*.js").match("z.js")).toBeTrue();
      expect(new Glob("z*.js").match("z.js")).toBeTrue();
      expect(new Glob("*/*").match("a/z")).toBeTrue();
      expect(new Glob("*/z*.js").match("a/z.js")).toBeTrue();
      expect(new Glob("a/z*.js").match("a/z.js")).toBeTrue();
      expect(new Glob("*").match("ab")).toBeTrue();
      expect(new Glob("*").match("abc")).toBeTrue();
      expect(new Glob("f*").match("bar")).toBeFalse();
      expect(new Glob("*r").match("foo")).toBeFalse();
      expect(new Glob("b*").match("foo")).toBeFalse();
      expect(new Glob("*").match("foo/bar")).toBeFalse();
      expect(new Glob("*c").match("abc")).toBeTrue();
      expect(new Glob("a*").match("abc")).toBeTrue();
      expect(new Glob("a*c").match("abc")).toBeTrue();
      expect(new Glob("*r").match("bar")).toBeTrue();
      expect(new Glob("b*").match("bar")).toBeTrue();
      expect(new Glob("f*").match("foo")).toBeTrue();
      expect(new Glob("*abc*").match("one abc two")).toBeTrue();
      expect(new Glob("a*b").match("a         b")).toBeTrue();
      expect(new Glob("*a*").match("foo")).toBeFalse();
      expect(new Glob("*a*").match("bar")).toBeTrue();
      expect(new Glob("*abc*").match("oneabctwo")).toBeTrue();
      expect(new Glob("*-bc-*").match("a-b.c-d")).toBeFalse();
      expect(new Glob("*-*.*-*").match("a-b.c-d")).toBeTrue();
      expect(new Glob("*-b*c-*").match("a-b.c-d")).toBeTrue();
      expect(new Glob("*-b.c-*").match("a-b.c-d")).toBeTrue();
      expect(new Glob("*.*").match("a-b.c-d")).toBeTrue();
      expect(new Glob("*.*-*").match("a-b.c-d")).toBeTrue();
      expect(new Glob("*.*-d").match("a-b.c-d")).toBeTrue();
      expect(new Glob("*.c-*").match("a-b.c-d")).toBeTrue();
      expect(new Glob("*b.*d").match("a-b.c-d")).toBeTrue();
      expect(new Glob("a*.c*").match("a-b.c-d")).toBeTrue();
      expect(new Glob("a-*.*-d").match("a-b.c-d")).toBeTrue();
      expect(new Glob("*.*").match("a.b")).toBeTrue();
      expect(new Glob("*.b").match("a.b")).toBeTrue();
      expect(new Glob("a.*").match("a.b")).toBeTrue();
      expect(new Glob("a.b").match("a.b")).toBeTrue();
      expect(new Glob("**-bc-**").match("a-b.c-d")).toBeFalse();
      expect(new Glob("**-**.**-**").match("a-b.c-d")).toBeTrue();
      expect(new Glob("**-b**c-**").match("a-b.c-d")).toBeTrue();
      expect(new Glob("**-b.c-**").match("a-b.c-d")).toBeTrue();
      expect(new Glob("**.**").match("a-b.c-d")).toBeTrue();
      expect(new Glob("**.**-**").match("a-b.c-d")).toBeTrue();
      expect(new Glob("**.**-d").match("a-b.c-d")).toBeTrue();
      expect(new Glob("**.c-**").match("a-b.c-d")).toBeTrue();
      expect(new Glob("**b.**d").match("a-b.c-d")).toBeTrue();
      expect(new Glob("a**.c**").match("a-b.c-d")).toBeTrue();
      expect(new Glob("a-**.**-d").match("a-b.c-d")).toBeTrue();
      expect(new Glob("**.**").match("a.b")).toBeTrue();
      expect(new Glob("**.b").match("a.b")).toBeTrue();
      expect(new Glob("a.**").match("a.b")).toBeTrue();
      expect(new Glob("a.b").match("a.b")).toBeTrue();
      expect(new Glob("*/*").match("/ab")).toBeTrue();
      expect(new Glob(".").match(".")).toBeTrue();
      expect(new Glob("a/").match("a/.b")).toBeFalse();
      expect(new Glob("/*").match("/ab")).toBeTrue();
      expect(new Glob("/??").match("/ab")).toBeTrue();
      expect(new Glob("/?b").match("/ab")).toBeTrue();
      expect(new Glob("/*").match("/cd")).toBeTrue();
      expect(new Glob("a").match("a")).toBeTrue();
      expect(new Glob("a/.*").match("a/.b")).toBeTrue();
      expect(new Glob("?/?").match("a/b")).toBeTrue();
      expect(new Glob("a/**/j/**/z/*.md").match("a/b/c/d/e/j/n/p/o/z/c.md")).toBeTrue();
      expect(new Glob("a/**/z/*.md").match("a/b/c/d/e/z/c.md")).toBeTrue();
      expect(new Glob("a/b/c/*.md").match("a/b/c/xyz.md")).toBeTrue();
      expect(new Glob("a/b/c/*.md").match("a/b/c/xyz.md")).toBeTrue();
      expect(new Glob("a/*/z/.a").match("a/b/z/.a")).toBeTrue();
      expect(new Glob("bz").match("a/b/z/.a")).toBeFalse();
      expect(new Glob("a/**/c/*.md").match("a/bb.bb/aa/b.b/aa/c/xyz.md")).toBeTrue();
      expect(new Glob("a/**/c/*.md").match("a/bb.bb/aa/bb/aa/c/xyz.md")).toBeTrue();
      expect(new Glob("a/*/c/*.md").match("a/bb.bb/c/xyz.md")).toBeTrue();
      expect(new Glob("a/*/c/*.md").match("a/bb/c/xyz.md")).toBeTrue();
      expect(new Glob("a/*/c/*.md").match("a/bbbb/c/xyz.md")).toBeTrue();
      expect(new Glob("*").match("aaa")).toBeTrue();
      expect(new Glob("*").match("ab")).toBeTrue();
      expect(new Glob("ab").match("ab")).toBeTrue();
      expect(new Glob("*/*/*").match("aaa")).toBeFalse();
      expect(new Glob("*/*/*").match("aaa/bb/aa/rr")).toBeFalse();
      expect(new Glob("aaa*").match("aaa/bba/ccc")).toBeFalse();
      expect(new Glob("aaa/*").match("aaa/bba/ccc")).toBeFalse();
      expect(new Glob("aaa/*ccc").match("aaa/bba/ccc")).toBeFalse();
      expect(new Glob("aaa/*z").match("aaa/bba/ccc")).toBeFalse();
      expect(new Glob("*/*/*").match("aaa/bbb")).toBeFalse();
      expect(new Glob("*/*jk*/*i").match("ab/zzz/ejkl/hi")).toBeFalse();
      expect(new Glob("*/*/*").match("aaa/bba/ccc")).toBeTrue();
      expect(new Glob("aaa/**").match("aaa/bba/ccc")).toBeTrue();
      expect(new Glob("aaa/*").match("aaa/bbb")).toBeTrue();
      expect(new Glob("*/*z*/*/*i").match("ab/zzz/ejkl/hi")).toBeTrue();
      expect(new Glob("*j*i").match("abzzzejklhi")).toBeTrue();
      expect(new Glob("*").match("a")).toBeTrue();
      expect(new Glob("*").match("b")).toBeTrue();
      expect(new Glob("*").match("a/a")).toBeFalse();
      expect(new Glob("*").match("a/a/a")).toBeFalse();
      expect(new Glob("*").match("a/a/b")).toBeFalse();
      expect(new Glob("*").match("a/a/a/a")).toBeFalse();
      expect(new Glob("*").match("a/a/a/a/a")).toBeFalse();
      expect(new Glob("*/*").match("a")).toBeFalse();
      expect(new Glob("*/*").match("a/a")).toBeTrue();
      expect(new Glob("*/*").match("a/a/a")).toBeFalse();
      expect(new Glob("*/*/*").match("a")).toBeFalse();
      expect(new Glob("*/*/*").match("a/a")).toBeFalse();
      expect(new Glob("*/*/*").match("a/a/a")).toBeTrue();
      expect(new Glob("*/*/*").match("a/a/a/a")).toBeFalse();
      expect(new Glob("*/*/*/*").match("a")).toBeFalse();
      expect(new Glob("*/*/*/*").match("a/a")).toBeFalse();
      expect(new Glob("*/*/*/*").match("a/a/a")).toBeFalse();
      expect(new Glob("*/*/*/*").match("a/a/a/a")).toBeTrue();
      expect(new Glob("*/*/*/*").match("a/a/a/a/a")).toBeFalse();
      expect(new Glob("*/*/*/*/*").match("a")).toBeFalse();
      expect(new Glob("*/*/*/*/*").match("a/a")).toBeFalse();
      expect(new Glob("*/*/*/*/*").match("a/a/a")).toBeFalse();
      expect(new Glob("*/*/*/*/*").match("a/a/b")).toBeFalse();
      expect(new Glob("*/*/*/*/*").match("a/a/a/a")).toBeFalse();
      expect(new Glob("*/*/*/*/*").match("a/a/a/a/a")).toBeTrue();
      expect(new Glob("*/*/*/*/*").match("a/a/a/a/a/a")).toBeFalse();
      expect(new Glob("a/*").match("a")).toBeFalse();
      expect(new Glob("a/*").match("a/a")).toBeTrue();
      expect(new Glob("a/*").match("a/a/a")).toBeFalse();
      expect(new Glob("a/*").match("a/a/a/a")).toBeFalse();
      expect(new Glob("a/*").match("a/a/a/a/a")).toBeFalse();
      expect(new Glob("a/*/*").match("a")).toBeFalse();
      expect(new Glob("a/*/*").match("a/a")).toBeFalse();
      expect(new Glob("a/*/*").match("a/a/a")).toBeTrue();
      expect(new Glob("a/*/*").match("b/a/a")).toBeFalse();
      expect(new Glob("a/*/*").match("a/a/a/a")).toBeFalse();
      expect(new Glob("a/*/*").match("a/a/a/a/a")).toBeFalse();
      expect(new Glob("a/*/*/*").match("a")).toBeFalse();
      expect(new Glob("a/*/*/*").match("a/a")).toBeFalse();
      expect(new Glob("a/*/*/*").match("a/a/a")).toBeFalse();
      expect(new Glob("a/*/*/*").match("a/a/a/a")).toBeTrue();
      expect(new Glob("a/*/*/*").match("a/a/a/a/a")).toBeFalse();
      expect(new Glob("a/*/*/*/*").match("a")).toBeFalse();
      expect(new Glob("a/*/*/*/*").match("a/a")).toBeFalse();
      expect(new Glob("a/*/*/*/*").match("a/a/a")).toBeFalse();
      expect(new Glob("a/*/*/*/*").match("a/a/b")).toBeFalse();
      expect(new Glob("a/*/*/*/*").match("a/a/a/a")).toBeFalse();
      expect(new Glob("a/*/*/*/*").match("a/a/a/a/a")).toBeTrue();
      expect(new Glob("a/*/a").match("a")).toBeFalse();
      expect(new Glob("a/*/a").match("a/a")).toBeFalse();
      expect(new Glob("a/*/a").match("a/a/a")).toBeTrue();
      expect(new Glob("a/*/a").match("a/a/b")).toBeFalse();
      expect(new Glob("a/*/a").match("a/a/a/a")).toBeFalse();
      expect(new Glob("a/*/a").match("a/a/a/a/a")).toBeFalse();
      expect(new Glob("a/*/b").match("a")).toBeFalse();
      expect(new Glob("a/*/b").match("a/a")).toBeFalse();
      expect(new Glob("a/*/b").match("a/a/a")).toBeFalse();
      expect(new Glob("a/*/b").match("a/a/b")).toBeTrue();
      expect(new Glob("a/*/b").match("a/a/a/a")).toBeFalse();
      expect(new Glob("a/*/b").match("a/a/a/a/a")).toBeFalse();
      expect(new Glob("*/**/a").match("a")).toBeFalse();
      expect(new Glob("*/**/a").match("a/a/b")).toBeFalse();
      expect(new Glob("*/**/a").match("a/a")).toBeTrue();
      expect(new Glob("*/**/a").match("a/a/a")).toBeTrue();
      expect(new Glob("*/**/a").match("a/a/a/a")).toBeTrue();
      expect(new Glob("*/**/a").match("a/a/a/a/a")).toBeTrue();
      expect(new Glob("*/").match("a")).toBeFalse();
      expect(new Glob("*/*").match("a")).toBeFalse();
      expect(new Glob("a/*").match("a")).toBeFalse();
      expect(new Glob("*").match("a/a")).toBeFalse();
      expect(new Glob("*/").match("a/a")).toBeFalse();
      expect(new Glob("*/").match("a/x/y")).toBeFalse();
      expect(new Glob("*/*").match("a/x/y")).toBeFalse();
      expect(new Glob("a/*").match("a/x/y")).toBeFalse();
      expect(new Glob("*").match("a")).toBeTrue();
      expect(new Glob("*/").match("a/")).toBeTrue();
      expect(new Glob("*{,/}").match("a/")).toBeTrue();
      expect(new Glob("*/*").match("a/a")).toBeTrue();
      expect(new Glob("a/*").match("a/a")).toBeTrue();
      expect(new Glob("a/**/*.txt").match("a.txt")).toBeFalse();
      expect(new Glob("a/**/*.txt").match("a/x/y.txt")).toBeTrue();
      expect(new Glob("a/**/*.txt").match("a/x/y/z")).toBeFalse();
      expect(new Glob("a/*.txt").match("a.txt")).toBeFalse();
      expect(new Glob("a/*.txt").match("a/b.txt")).toBeTrue();
      expect(new Glob("a/*.txt").match("a/x/y.txt")).toBeFalse();
      expect(new Glob("a/*.txt").match("a/x/y/z")).toBeFalse();
      expect(new Glob("a*.txt").match("a.txt")).toBeTrue();
      expect(new Glob("a*.txt").match("a/b.txt")).toBeFalse();
      expect(new Glob("a*.txt").match("a/x/y.txt")).toBeFalse();
      expect(new Glob("a*.txt").match("a/x/y/z")).toBeFalse();
      expect(new Glob("*.txt").match("a.txt")).toBeTrue();
      expect(new Glob("*.txt").match("a/b.txt")).toBeFalse();
      expect(new Glob("*.txt").match("a/x/y.txt")).toBeFalse();
      expect(new Glob("*.txt").match("a/x/y/z")).toBeFalse();
      expect(new Glob("a*").match("a/b")).toBeFalse();
      expect(new Glob("a/**/b").match("a/a/bb")).toBeFalse();
      expect(new Glob("a/**/b").match("a/bb")).toBeFalse();
      expect(new Glob("*/**").match("foo")).toBeFalse();
      expect(new Glob("**/").match("foo/bar")).toBeFalse();
      expect(new Glob("**/*/").match("foo/bar")).toBeFalse();
      expect(new Glob("*/*/").match("foo/bar")).toBeFalse();
      expect(new Glob("**/..").match("/home/foo/..")).toBeTrue();
      expect(new Glob("**/a").match("a")).toBeTrue();
      expect(new Glob("**").match("a/a")).toBeTrue();
      expect(new Glob("a/**").match("a/a")).toBeTrue();
      expect(new Glob("a/**").match("a/")).toBeTrue();
      expect(new Glob("**/").match("a/a")).toBeFalse();
      expect(new Glob("**/").match("a/a")).toBeFalse();
      expect(new Glob("*/**/a").match("a/a")).toBeTrue();
      expect(new Glob("*/**").match("foo/")).toBeTrue();
      expect(new Glob("**/*").match("foo/bar")).toBeTrue();
      expect(new Glob("*/*").match("foo/bar")).toBeTrue();
      expect(new Glob("*/**").match("foo/bar")).toBeTrue();
      expect(new Glob("**/").match("foo/bar/")).toBeTrue();
      expect(new Glob("**/*/").match("foo/bar/")).toBeTrue();
      expect(new Glob("*/**").match("foo/bar/")).toBeTrue();
      expect(new Glob("*/*/").match("foo/bar/")).toBeTrue();
      expect(new Glob("*/foo").match("bar/baz/foo")).toBeFalse();
      expect(new Glob("**/bar/*").match("deep/foo/bar")).toBeFalse();
      expect(new Glob("*/bar/**").match("deep/foo/bar/baz/x")).toBeFalse();
      expect(new Glob("/*").match("ef")).toBeFalse();
      expect(new Glob("foo?bar").match("foo/bar")).toBeFalse();
      expect(new Glob("**/bar*").match("foo/bar/baz")).toBeFalse();
      expect(new Glob("foo**bar").match("foo/baz/bar")).toBeFalse();
      expect(new Glob("foo*bar").match("foo/baz/bar")).toBeFalse();
      expect(new Glob("/*").match("/ab")).toBeTrue();
      expect(new Glob("/*").match("/cd")).toBeTrue();
      expect(new Glob("/*").match("/ef")).toBeTrue();
      expect(new Glob("a/**/j/**/z/*.md").match("a/b/j/c/z/x.md")).toBeTrue();
      expect(new Glob("a/**/j/**/z/*.md").match("a/j/z/x.md")).toBeTrue();
      expect(new Glob("**/foo").match("bar/baz/foo")).toBeTrue();
      expect(new Glob("**/bar/*").match("deep/foo/bar/baz")).toBeTrue();
      expect(new Glob("**/bar/**").match("deep/foo/bar/baz/")).toBeTrue();
      expect(new Glob("**/bar/*/*").match("deep/foo/bar/baz/x")).toBeTrue();
      expect(new Glob("foo/**/**/bar").match("foo/b/a/z/bar")).toBeTrue();
      expect(new Glob("foo/**/bar").match("foo/b/a/z/bar")).toBeTrue();
      expect(new Glob("foo/**/**/bar").match("foo/bar")).toBeTrue();
      expect(new Glob("foo/**/bar").match("foo/bar")).toBeTrue();
      expect(new Glob("*/bar/**").match("foo/bar/baz/x")).toBeTrue();
      expect(new Glob("foo/**/**/bar").match("foo/baz/bar")).toBeTrue();
      expect(new Glob("foo/**/bar").match("foo/baz/bar")).toBeTrue();
      expect(new Glob("**/foo").match("XXX/foo")).toBeTrue();
    });

    test("globstars", () => {
      expect(new Glob("**/*.js").match("a/b/c/d.js")).toBeTrue();
      expect(new Glob("**/*.js").match("a/b/c.js")).toBeTrue();
      expect(new Glob("**/*.js").match("a/b.js")).toBeTrue();
      expect(new Glob("a/b/**/*.js").match("a/b/c/d/e/f.js")).toBeTrue();
      expect(new Glob("a/b/**/*.js").match("a/b/c/d/e.js")).toBeTrue();
      expect(new Glob("a/b/c/**/*.js").match("a/b/c/d.js")).toBeTrue();
      expect(new Glob("a/b/**/*.js").match("a/b/c/d.js")).toBeTrue();
      expect(new Glob("a/b/**/*.js").match("a/b/d.js")).toBeTrue();
      expect(new Glob("a/b/**/*.js").match("a/d.js")).toBeFalse();
      expect(new Glob("a/b/**/*.js").match("d.js")).toBeFalse();
      expect(new Glob("**c").match("a/b/c")).toBeFalse();
      expect(new Glob("a/**c").match("a/b/c")).toBeFalse();
      expect(new Glob("a/**z").match("a/b/c")).toBeFalse();
      expect(new Glob("a/**b**/c").match("a/b/c/b/c")).toBeFalse();
      expect(new Glob("a/b/c**/*.js").match("a/b/c/d/e.js")).toBeFalse();
      expect(new Glob("a/**/b/**/c").match("a/b/c/b/c")).toBeTrue();
      expect(new Glob("a/**b**/c").match("a/aba/c")).toBeTrue();
      expect(new Glob("a/**b**/c").match("a/b/c")).toBeTrue();
      expect(new Glob("a/b/c**/*.js").match("a/b/c/d.js")).toBeTrue();
      expect(new Glob("a/**/*").match("a")).toBeFalse();
      expect(new Glob("a/**/**/*").match("a")).toBeFalse();
      expect(new Glob("a/**/**/**/*").match("a")).toBeFalse();
      expect(new Glob("**/a").match("a/")).toBeFalse();
      expect(new Glob("a/**/*").match("a/")).toBeFalse();
      expect(new Glob("a/**/**/*").match("a/")).toBeFalse();
      expect(new Glob("a/**/**/**/*").match("a/")).toBeFalse();
      expect(new Glob("**/a").match("a/b")).toBeFalse();
      expect(new Glob("a/**/j/**/z/*.md").match("a/b/c/j/e/z/c.txt")).toBeFalse();
      expect(new Glob("a/**/b").match("a/bb")).toBeFalse();
      expect(new Glob("**/a").match("a/c")).toBeFalse();
      expect(new Glob("**/a").match("a/b")).toBeFalse();
      expect(new Glob("**/a").match("a/x/y")).toBeFalse();
      expect(new Glob("**/a").match("a/b/c/d")).toBeFalse();
      expect(new Glob("**").match("a")).toBeTrue();
      expect(new Glob("**/a").match("a")).toBeTrue();
      expect(new Glob("**").match("a/")).toBeTrue();
      expect(new Glob("**/a/**").match("a/")).toBeTrue();
      expect(new Glob("a/**").match("a/")).toBeTrue();
      expect(new Glob("a/**/**").match("a/")).toBeTrue();
      expect(new Glob("**/a").match("a/a")).toBeTrue();
      expect(new Glob("**").match("a/b")).toBeTrue();
      expect(new Glob("*/*").match("a/b")).toBeTrue();
      expect(new Glob("a/**").match("a/b")).toBeTrue();
      expect(new Glob("a/**/*").match("a/b")).toBeTrue();
      expect(new Glob("a/**/**/*").match("a/b")).toBeTrue();
      expect(new Glob("a/**/**/**/*").match("a/b")).toBeTrue();
      expect(new Glob("a/**/b").match("a/b")).toBeTrue();
      expect(new Glob("**").match("a/b/c")).toBeTrue();
      expect(new Glob("**/*").match("a/b/c")).toBeTrue();
      expect(new Glob("**/**").match("a/b/c")).toBeTrue();
      expect(new Glob("*/**").match("a/b/c")).toBeTrue();
      expect(new Glob("a/**").match("a/b/c")).toBeTrue();
      expect(new Glob("a/**/*").match("a/b/c")).toBeTrue();
      expect(new Glob("a/**/**/*").match("a/b/c")).toBeTrue();
      expect(new Glob("a/**/**/**/*").match("a/b/c")).toBeTrue();
      expect(new Glob("**").match("a/b/c/d")).toBeTrue();
      expect(new Glob("a/**").match("a/b/c/d")).toBeTrue();
      expect(new Glob("a/**/*").match("a/b/c/d")).toBeTrue();
      expect(new Glob("a/**/**/*").match("a/b/c/d")).toBeTrue();
      expect(new Glob("a/**/**/**/*").match("a/b/c/d")).toBeTrue();
      expect(new Glob("a/b/**/c/**/*.*").match("a/b/c/d.e")).toBeTrue();
      expect(new Glob("a/**/f/*.md").match("a/b/c/d/e/f/g.md")).toBeTrue();
      expect(new Glob("a/**/f/**/k/*.md").match("a/b/c/d/e/f/g/h/i/j/k/l.md")).toBeTrue();
      expect(new Glob("a/b/c/*.md").match("a/b/c/def.md")).toBeTrue();
      expect(new Glob("a/*/c/*.md").match("a/bb.bb/c/ddd.md")).toBeTrue();
      expect(new Glob("a/**/f/*.md").match("a/bb.bb/cc/d.d/ee/f/ggg.md")).toBeTrue();
      expect(new Glob("a/**/f/*.md").match("a/bb.bb/cc/dd/ee/f/ggg.md")).toBeTrue();
      expect(new Glob("a/*/c/*.md").match("a/bb/c/ddd.md")).toBeTrue();
      expect(new Glob("a/*/c/*.md").match("a/bbbb/c/ddd.md")).toBeTrue();
      expect(new Glob("foo/bar/**/one/**/*.*").match("foo/bar/baz/one/image.png")).toBeTrue();
      expect(new Glob("foo/bar/**/one/**/*.*").match("foo/bar/baz/one/two/image.png")).toBeTrue();
      expect(new Glob("foo/bar/**/one/**/*.*").match("foo/bar/baz/one/two/three/image.png")).toBeTrue();
      expect(new Glob("a/b/**/f").match("a/b/c/d/")).toBeFalse();
      expect(new Glob("**").match("a")).toBeTrue();
      expect(new Glob("**").match("a/")).toBeTrue();
      expect(new Glob("a/**").match("a/")).toBeTrue();
      expect(new Glob("**").match("a/b/c/d")).toBeTrue();
      expect(new Glob("**").match("a/b/c/d/")).toBeTrue();
      expect(new Glob("**/**").match("a/b/c/d/")).toBeTrue();
      expect(new Glob("**/b/**").match("a/b/c/d/")).toBeTrue();
      expect(new Glob("a/b/**").match("a/b/c/d/")).toBeTrue();
      expect(new Glob("a/b/**/").match("a/b/c/d/")).toBeTrue();
      expect(new Glob("a/b/**/c/**/").match("a/b/c/d/")).toBeTrue();
      expect(new Glob("a/b/**/c/**/d/").match("a/b/c/d/")).toBeTrue();
      expect(new Glob("a/b/**/**/*.*").match("a/b/c/d/e.f")).toBeTrue();
      expect(new Glob("a/b/**/*.*").match("a/b/c/d/e.f")).toBeTrue();
      expect(new Glob("a/b/**/c/**/d/*.*").match("a/b/c/d/e.f")).toBeTrue();
      expect(new Glob("a/b/**/d/**/*.*").match("a/b/c/d/e.f")).toBeTrue();
      expect(new Glob("a/b/**/d/**/*.*").match("a/b/c/d/g/e.f")).toBeTrue();
      expect(new Glob("a/b/**/d/**/*.*").match("a/b/c/d/g/g/e.f")).toBeTrue();
      expect(new Glob("a/b-*/**/z.js").match("a/b-c/z.js")).toBeTrue();
      expect(new Glob("a/b-*/**/z.js").match("a/b-c/d/e/z.js")).toBeTrue();
      expect(new Glob("*/*").match("a/b")).toBeTrue();
      expect(new Glob("a/b/c/*.md").match("a/b/c/xyz.md")).toBeTrue();
      expect(new Glob("a/*/c/*.md").match("a/bb.bb/c/xyz.md")).toBeTrue();
      expect(new Glob("a/*/c/*.md").match("a/bb/c/xyz.md")).toBeTrue();
      expect(new Glob("a/*/c/*.md").match("a/bbbb/c/xyz.md")).toBeTrue();
      expect(new Glob("**/*").match("a/b/c")).toBeTrue();
      expect(new Glob("**/**").match("a/b/c")).toBeTrue();
      expect(new Glob("*/**").match("a/b/c")).toBeTrue();
      expect(new Glob("a/**/j/**/z/*.md").match("a/b/c/d/e/j/n/p/o/z/c.md")).toBeTrue();
      expect(new Glob("a/**/z/*.md").match("a/b/c/d/e/z/c.md")).toBeTrue();
      expect(new Glob("a/**/c/*.md").match("a/bb.bb/aa/b.b/aa/c/xyz.md")).toBeTrue();
      expect(new Glob("a/**/c/*.md").match("a/bb.bb/aa/bb/aa/c/xyz.md")).toBeTrue();
      expect(new Glob("a/**/j/**/z/*.md").match("a/b/c/j/e/z/c.txt")).toBeFalse();
      expect(new Glob("a/b/**/c{d,e}/**/xyz.md").match("a/b/c/xyz.md")).toBeFalse();
      expect(new Glob("a/b/**/c{d,e}/**/xyz.md").match("a/b/d/xyz.md")).toBeFalse();
      expect(new Glob("a/**/").match("a/b")).toBeFalse();
      expect(new Glob("a/**/").match("a/b/c/d")).toBeFalse();
      expect(new Glob("a/**/").match("a/bb")).toBeFalse();
      expect(new Glob("a/**/").match("a/cb")).toBeFalse();
      expect(new Glob("/**").match("/a/b")).toBeTrue();
      expect(new Glob("**/*").match("a.b")).toBeTrue();
      expect(new Glob("**/*").match("a.js")).toBeTrue();
      expect(new Glob("**/*.js").match("a.js")).toBeTrue();
      expect(new Glob("**/*.js").match("a/a.js")).toBeTrue();
      expect(new Glob("**/*.js").match("a/a/b.js")).toBeTrue();
      expect(new Glob("a/**/b").match("a/b")).toBeTrue();
      expect(new Glob("a/**b").match("a/b")).toBeTrue();
      expect(new Glob("**/*.md").match("a/b.md")).toBeTrue();
      expect(new Glob("**/*").match("a/b/c.js")).toBeTrue();
      expect(new Glob("**/*").match("a/b/c.txt")).toBeTrue();
      expect(new Glob("a/**/").match("a/b/c/d/")).toBeTrue();
      expect(new Glob("**/*").match("a/b/c/d/a.js")).toBeTrue();
      expect(new Glob("a/b/**/*.js").match("a/b/c/z.js")).toBeTrue();
      expect(new Glob("a/b/**/*.js").match("a/b/z.js")).toBeTrue();
      expect(new Glob("**/*").match("ab")).toBeTrue();
      expect(new Glob("**/*").match("ab/c")).toBeTrue();
      expect(new Glob("**/*").match("ab/c/d")).toBeTrue();
      expect(new Glob("**/*").match("abc.js")).toBeTrue();
      expect(new Glob("**/").match("a")).toBeFalse();
      expect(new Glob("**/a/*").match("a")).toBeFalse();
      expect(new Glob("**/a/*/*").match("a")).toBeFalse();
      expect(new Glob("*/a/**").match("a")).toBeFalse();
      expect(new Glob("a/**/*").match("a")).toBeFalse();
      expect(new Glob("a/**/**/*").match("a")).toBeFalse();
      expect(new Glob("**/").match("a/b")).toBeFalse();
      expect(new Glob("**/b/*").match("a/b")).toBeFalse();
      expect(new Glob("**/b/*/*").match("a/b")).toBeFalse();
      expect(new Glob("b/**").match("a/b")).toBeFalse();
      expect(new Glob("**/").match("a/b/c")).toBeFalse();
      expect(new Glob("**/**/b").match("a/b/c")).toBeFalse();
      expect(new Glob("**/b").match("a/b/c")).toBeFalse();
      expect(new Glob("**/b/*/*").match("a/b/c")).toBeFalse();
      expect(new Glob("b/**").match("a/b/c")).toBeFalse();
      expect(new Glob("**/").match("a/b/c/d")).toBeFalse();
      expect(new Glob("**/d/*").match("a/b/c/d")).toBeFalse();
      expect(new Glob("b/**").match("a/b/c/d")).toBeFalse();
      expect(new Glob("**").match("a")).toBeTrue();
      expect(new Glob("**/**").match("a")).toBeTrue();
      expect(new Glob("**/**/*").match("a")).toBeTrue();
      expect(new Glob("**/**/a").match("a")).toBeTrue();
      expect(new Glob("**/a").match("a")).toBeTrue();
      expect(new Glob("**").match("a/b")).toBeTrue();
      expect(new Glob("**/**").match("a/b")).toBeTrue();
      expect(new Glob("**/**/*").match("a/b")).toBeTrue();
      expect(new Glob("**/**/b").match("a/b")).toBeTrue();
      expect(new Glob("**/b").match("a/b")).toBeTrue();
      expect(new Glob("a/**").match("a/b")).toBeTrue();
      expect(new Glob("a/**/*").match("a/b")).toBeTrue();
      expect(new Glob("a/**/**/*").match("a/b")).toBeTrue();
      expect(new Glob("**").match("a/b/c")).toBeTrue();
      expect(new Glob("**/**").match("a/b/c")).toBeTrue();
      expect(new Glob("**/**/*").match("a/b/c")).toBeTrue();
      expect(new Glob("**/b/*").match("a/b/c")).toBeTrue();
      expect(new Glob("**/b/**").match("a/b/c")).toBeTrue();
      expect(new Glob("*/b/**").match("a/b/c")).toBeTrue();
      expect(new Glob("a/**").match("a/b/c")).toBeTrue();
      expect(new Glob("a/**/*").match("a/b/c")).toBeTrue();
      expect(new Glob("a/**/**/*").match("a/b/c")).toBeTrue();
      expect(new Glob("**").match("a/b/c/d")).toBeTrue();
      expect(new Glob("**/**").match("a/b/c/d")).toBeTrue();
      expect(new Glob("**/**/*").match("a/b/c/d")).toBeTrue();
      expect(new Glob("**/**/d").match("a/b/c/d")).toBeTrue();
      expect(new Glob("**/b/**").match("a/b/c/d")).toBeTrue();
      expect(new Glob("**/b/*/*").match("a/b/c/d")).toBeTrue();
      expect(new Glob("**/d").match("a/b/c/d")).toBeTrue();
      expect(new Glob("*/b/**").match("a/b/c/d")).toBeTrue();
      expect(new Glob("a/**").match("a/b/c/d")).toBeTrue();
      expect(new Glob("a/**/*").match("a/b/c/d")).toBeTrue();
      expect(new Glob("a/**/**/*").match("a/b/c/d")).toBeTrue();
    });

    test("utf8", () => {
      expect(new Glob("フ*/**/*").match("フォルダ/aaa.js")).toBeTrue();
      expect(new Glob("フォ*/**/*").match("フォルダ/aaa.js")).toBeTrue();
      expect(new Glob("フォル*/**/*").match("フォルダ/aaa.js")).toBeTrue();
      expect(new Glob("フ*ル*/**/*").match("フォルダ/aaa.js")).toBeTrue();
      expect(new Glob("フォルダ/**/*").match("フォルダ/aaa.js")).toBeTrue();
    });

    test("negation", () => {
      expect(new Glob("!*").match("abc")).toBeFalse();
      expect(new Glob("!abc").match("abc")).toBeFalse();
      expect(new Glob("*!.md").match("bar.md")).toBeFalse();
      expect(new Glob("foo!.md").match("bar.md")).toBeFalse();
      expect(new Glob("\\!*!*.md").match("foo!.md")).toBeFalse();
      expect(new Glob("\\!*!*.md").match("foo!bar.md")).toBeFalse();
      expect(new Glob("*!*.md").match("!foo!.md")).toBeTrue();
      expect(new Glob("\\!*!*.md").match("!foo!.md")).toBeTrue();
      expect(new Glob("!*foo").match("abc")).toBeTrue();
      expect(new Glob("!foo*").match("abc")).toBeTrue();
      expect(new Glob("!xyz").match("abc")).toBeTrue();
      expect(new Glob("*!*.*").match("ba!r.js")).toBeTrue();
      expect(new Glob("*.md").match("bar.md")).toBeTrue();
      expect(new Glob("*!*.*").match("foo!.md")).toBeTrue();
      expect(new Glob("*!*.md").match("foo!.md")).toBeTrue();
      expect(new Glob("*!.md").match("foo!.md")).toBeTrue();
      expect(new Glob("*.md").match("foo!.md")).toBeTrue();
      expect(new Glob("foo!.md").match("foo!.md")).toBeTrue();
      expect(new Glob("*!*.md").match("foo!bar.md")).toBeTrue();
      expect(new Glob("*b*.md").match("foobar.md")).toBeTrue();
      expect(new Glob("a!!b").match("a")).toBeFalse();
      expect(new Glob("a!!b").match("aa")).toBeFalse();
      expect(new Glob("a!!b").match("a/b")).toBeFalse();
      expect(new Glob("a!!b").match("a!b")).toBeFalse();
      expect(new Glob("a!!b").match("a!!b")).toBeTrue();
      expect(new Glob("a!!b").match("a/!!/b")).toBeFalse();
      expect(new Glob("!a/b").match("a/b")).toBeFalse();
      expect(new Glob("!a/b").match("a")).toBeTrue();
      expect(new Glob("!a/b").match("a.b")).toBeTrue();
      expect(new Glob("!a/b").match("a/a")).toBeTrue();
      expect(new Glob("!a/b").match("a/c")).toBeTrue();
      expect(new Glob("!a/b").match("b/a")).toBeTrue();
      expect(new Glob("!a/b").match("b/b")).toBeTrue();
      expect(new Glob("!a/b").match("b/c")).toBeTrue();
      expect(new Glob("!abc").match("abc")).toBeFalse();
      expect(new Glob("!!abc").match("abc")).toBeTrue();
      expect(new Glob("!!!abc").match("abc")).toBeFalse();
      expect(new Glob("!!!!abc").match("abc")).toBeTrue();
      expect(new Glob("!!!!!abc").match("abc")).toBeFalse();
      expect(new Glob("!!!!!!abc").match("abc")).toBeTrue();
      expect(new Glob("!!!!!!!abc").match("abc")).toBeFalse();
      expect(new Glob("!!!!!!!!abc").match("abc")).toBeTrue();
      // try expect(!match("!(*/*)", "a/a"));
      // try expect(!match("!(*/*)", "a/b"));
      // try expect(!match("!(*/*)", "a/c"));
      // try expect(!match("!(*/*)", "b/a"));
      // try expect(!match("!(*/*)", "b/b"));
      // try expect(!match("!(*/*)", "b/c"));
      // try expect(!match("!(*/b)", "a/b"));
      // try expect(!match("!(*/b)", "b/b"));
      // try expect(!match("!(a/b)", "a/b"));
      expect(new Glob("!*").match("a")).toBeFalse();
      expect(new Glob("!*").match("a.b")).toBeFalse();
      expect(new Glob("!*/*").match("a/a")).toBeFalse();
      expect(new Glob("!*/*").match("a/b")).toBeFalse();
      expect(new Glob("!*/*").match("a/c")).toBeFalse();
      expect(new Glob("!*/*").match("b/a")).toBeFalse();
      expect(new Glob("!*/*").match("b/b")).toBeFalse();
      expect(new Glob("!*/*").match("b/c")).toBeFalse();
      expect(new Glob("!*/b").match("a/b")).toBeFalse();
      expect(new Glob("!*/b").match("b/b")).toBeFalse();
      expect(new Glob("!*/c").match("a/c")).toBeFalse();
      expect(new Glob("!*/c").match("a/c")).toBeFalse();
      expect(new Glob("!*/c").match("b/c")).toBeFalse();
      expect(new Glob("!*/c").match("b/c")).toBeFalse();
      expect(new Glob("!*a*").match("bar")).toBeFalse();
      expect(new Glob("!*a*").match("fab")).toBeFalse();
      // try expect(!match("!a/(*)", "a/a"));
      // try expect(!match("!a/(*)", "a/b"));
      // try expect(!match("!a/(*)", "a/c"));
      // try expect(!match("!a/(b)", "a/b"));
      expect(new Glob("!a/*").match("a/a")).toBeFalse();
      expect(new Glob("!a/*").match("a/b")).toBeFalse();
      expect(new Glob("!a/*").match("a/c")).toBeFalse();
      expect(new Glob("!f*b").match("fab")).toBeFalse();
      // try expect(match("!(*/*)", "a"));
      // try expect(match("!(*/*)", "a.b"));
      // try expect(match("!(*/b)", "a"));
      // try expect(match("!(*/b)", "a.b"));
      // try expect(match("!(*/b)", "a/a"));
      // try expect(match("!(*/b)", "a/c"));
      // try expect(match("!(*/b)", "b/a"));
      // try expect(match("!(*/b)", "b/c"));
      // try expect(match("!(a/b)", "a"));
      // try expect(match("!(a/b)", "a.b"));
      // try expect(match("!(a/b)", "a/a"));
      // try expect(match("!(a/b)", "a/c"));
      // try expect(match("!(a/b)", "b/a"));
      // try expect(match("!(a/b)", "b/b"));
      // try expect(match("!(a/b)", "b/c"));
      expect(new Glob("!*").match("a/a")).toBeTrue();
      expect(new Glob("!*").match("a/b")).toBeTrue();
      expect(new Glob("!*").match("a/c")).toBeTrue();
      expect(new Glob("!*").match("b/a")).toBeTrue();
      expect(new Glob("!*").match("b/b")).toBeTrue();
      expect(new Glob("!*").match("b/c")).toBeTrue();
      expect(new Glob("!*/*").match("a")).toBeTrue();
      expect(new Glob("!*/*").match("a.b")).toBeTrue();
      expect(new Glob("!*/b").match("a")).toBeTrue();
      expect(new Glob("!*/b").match("a.b")).toBeTrue();
      expect(new Glob("!*/b").match("a/a")).toBeTrue();
      expect(new Glob("!*/b").match("a/c")).toBeTrue();
      expect(new Glob("!*/b").match("b/a")).toBeTrue();
      expect(new Glob("!*/b").match("b/c")).toBeTrue();
      expect(new Glob("!*/c").match("a")).toBeTrue();
      expect(new Glob("!*/c").match("a.b")).toBeTrue();
      expect(new Glob("!*/c").match("a/a")).toBeTrue();
      expect(new Glob("!*/c").match("a/b")).toBeTrue();
      expect(new Glob("!*/c").match("b/a")).toBeTrue();
      expect(new Glob("!*/c").match("b/b")).toBeTrue();
      expect(new Glob("!*a*").match("foo")).toBeTrue();
      // try expect(match("!a/(*)", "a"));
      // try expect(match("!a/(*)", "a.b"));
      // try expect(match("!a/(*)", "b/a"));
      // try expect(match("!a/(*)", "b/b"));
      // try expect(match("!a/(*)", "b/c"));
      // try expect(match("!a/(b)", "a"));
      // try expect(match("!a/(b)", "a.b"));
      // try expect(match("!a/(b)", "a/a"));
      // try expect(match("!a/(b)", "a/c"));
      // try expect(match("!a/(b)", "b/a"));
      // try expect(match("!a/(b)", "b/b"));
      // try expect(match("!a/(b)", "b/c"));
      expect(new Glob("!a/*").match("a")).toBeTrue();
      expect(new Glob("!a/*").match("a.b")).toBeTrue();
      expect(new Glob("!a/*").match("b/a")).toBeTrue();
      expect(new Glob("!a/*").match("b/b")).toBeTrue();
      expect(new Glob("!a/*").match("b/c")).toBeTrue();
      expect(new Glob("!f*b").match("bar")).toBeTrue();
      expect(new Glob("!f*b").match("foo")).toBeTrue();
      expect(new Glob("!.md").match(".md")).toBeFalse();
      expect(new Glob("!**/*.md").match("a.js")).toBeTrue();
      expect(new Glob("!**/*.md").match("b.md")).toBeFalse();
      expect(new Glob("!**/*.md").match("c.txt")).toBeTrue();
      expect(new Glob("!*.md").match("a.js")).toBeTrue();
      expect(new Glob("!*.md").match("b.md")).toBeFalse();
      expect(new Glob("!*.md").match("c.txt")).toBeTrue();
      expect(new Glob("!*.md").match("abc.md")).toBeFalse();
      expect(new Glob("!*.md").match("abc.txt")).toBeTrue();
      expect(new Glob("!*.md").match("foo.md")).toBeFalse();
      expect(new Glob("!.md").match("foo.md")).toBeTrue();
      expect(new Glob("!*.md").match("a.js")).toBeTrue();
      expect(new Glob("!*.md").match("b.txt")).toBeTrue();
      expect(new Glob("!*.md").match("c.md")).toBeFalse();
      expect(new Glob("!a/*/a.js").match("a/a/a.js")).toBeFalse();
      expect(new Glob("!a/*/a.js").match("a/b/a.js")).toBeFalse();
      expect(new Glob("!a/*/a.js").match("a/c/a.js")).toBeFalse();
      expect(new Glob("!a/*/*/a.js").match("a/a/a/a.js")).toBeFalse();
      expect(new Glob("!a/*/*/a.js").match("b/a/b/a.js")).toBeTrue();
      expect(new Glob("!a/*/*/a.js").match("c/a/c/a.js")).toBeTrue();
      expect(new Glob("!a/a*.txt").match("a/a.txt")).toBeFalse();
      expect(new Glob("!a/a*.txt").match("a/b.txt")).toBeTrue();
      expect(new Glob("!a/a*.txt").match("a/c.txt")).toBeTrue();
      expect(new Glob("!a.a*.txt").match("a.a.txt")).toBeFalse();
      expect(new Glob("!a.a*.txt").match("a.b.txt")).toBeTrue();
      expect(new Glob("!a.a*.txt").match("a.c.txt")).toBeTrue();
      expect(new Glob("!a/*.txt").match("a/a.txt")).toBeFalse();
      expect(new Glob("!a/*.txt").match("a/b.txt")).toBeFalse();
      expect(new Glob("!a/*.txt").match("a/c.txt")).toBeFalse();
      expect(new Glob("!*.md").match("a.js")).toBeTrue();
      expect(new Glob("!*.md").match("b.txt")).toBeTrue();
      expect(new Glob("!*.md").match("c.md")).toBeFalse();
      expect(new Glob("!**/a.js").match("a/a/a.js")).toBeFalse();
      expect(new Glob("!**/a.js").match("a/b/a.js")).toBeFalse();
      expect(new Glob("!**/a.js").match("a/c/a.js")).toBeFalse();
      expect(new Glob("!**/a.js").match("a/a/b.js")).toBeTrue();
      expect(new Glob("!a/**/a.js").match("a/a/a/a.js")).toBeFalse();
      expect(new Glob("!a/**/a.js").match("b/a/b/a.js")).toBeTrue();
      expect(new Glob("!a/**/a.js").match("c/a/c/a.js")).toBeTrue();
      expect(new Glob("!**/*.md").match("a/b.js")).toBeTrue();
      expect(new Glob("!**/*.md").match("a.js")).toBeTrue();
      expect(new Glob("!**/*.md").match("a/b.md")).toBeFalse();
      expect(new Glob("!**/*.md").match("a.md")).toBeFalse();
      expect(new Glob("**/*.md").match("a/b.js")).toBeFalse();
      expect(new Glob("**/*.md").match("a.js")).toBeFalse();
      expect(new Glob("**/*.md").match("a/b.md")).toBeTrue();
      expect(new Glob("**/*.md").match("a.md")).toBeTrue();
      expect(new Glob("!**/*.md").match("a/b.js")).toBeTrue();
      expect(new Glob("!**/*.md").match("a.js")).toBeTrue();
      expect(new Glob("!**/*.md").match("a/b.md")).toBeFalse();
      expect(new Glob("!**/*.md").match("a.md")).toBeFalse();
      expect(new Glob("!*.md").match("a/b.js")).toBeTrue();
      expect(new Glob("!*.md").match("a.js")).toBeTrue();
      expect(new Glob("!*.md").match("a/b.md")).toBeTrue();
      expect(new Glob("!*.md").match("a.md")).toBeFalse();
      expect(new Glob("!**/*.md").match("a.js")).toBeTrue();
      expect(new Glob("!**/*.md").match("b.md")).toBeFalse();
      expect(new Glob("!**/*.md").match("c.txt")).toBeTrue();
    });

    test("negation with leading globstar", () => {
      // `!p` must be the exact complement of `p`, including when `p` starts with `**`.
      expect(new Glob("**/a").match("a")).toBeTrue();
      expect(new Glob("**/a").match("x/y/a")).toBeTrue();
      expect(new Glob("!**/a").match("a")).toBeFalse();
      expect(new Glob("!**/a").match("x/y/a")).toBeFalse();
      expect(new Glob("!**/a").match("zzz")).toBeTrue();
      expect(new Glob("!**/a").match("x/y/b")).toBeTrue();

      // trailing globstar
      expect(new Glob("!**").match("a")).toBeFalse();
      expect(new Glob("!**").match("a/b/c")).toBeFalse();

      // `!!p` must equal `p` (involution)
      expect(new Glob("!!**/a").match("a")).toBeTrue();
      expect(new Glob("!!**/a").match("x/y/a")).toBeTrue();
      expect(new Glob("!!**/a").match("zzz")).toBeFalse();
      expect(new Glob("!!!**/a").match("a")).toBeFalse();
      expect(new Glob("!!!**/a").match("x/y/a")).toBeFalse();

      // canonical negated ignore glob
      expect(new Glob("**/node_modules/**").match("node_modules/pkg/index.js")).toBeTrue();
      expect(new Glob("!**/node_modules/**").match("node_modules/pkg/index.js")).toBeFalse();
      expect(new Glob("!**/node_modules/**").match("a/b/node_modules/pkg/index.js")).toBeFalse();
      expect(new Glob("!**/node_modules/**").match("src/index.js")).toBeTrue();

      // control: `**` not at pattern start was already correct
      expect(new Glob("!x/**/a").match("x/a")).toBeFalse();
      expect(new Glob("!x/**/a").match("x/y/a")).toBeFalse();
      expect(new Glob("!x/**/a").match("y/a")).toBeTrue();

      // negation combined with braces containing a leading globstar
      expect(new Glob("!{**/a,**/b}").match("a")).toBeFalse();
      expect(new Glob("!{**/a,**/b}").match("x/y/a")).toBeFalse();
      expect(new Glob("!{**/a,**/b}").match("x/y/b")).toBeFalse();
      expect(new Glob("!{**/a,**/b}").match("x/y/c")).toBeTrue();
    });

    test("question_mark", () => {
      expect(new Glob("?").match("a")).toBeTrue();
      expect(new Glob("?").match("aa")).toBeFalse();
      expect(new Glob("?").match("ab")).toBeFalse();
      expect(new Glob("?").match("aaa")).toBeFalse();
      expect(new Glob("?").match("abcdefg")).toBeFalse();
      expect(new Glob("??").match("a")).toBeFalse();
      expect(new Glob("??").match("aa")).toBeTrue();
      expect(new Glob("??").match("ab")).toBeTrue();
      expect(new Glob("??").match("aaa")).toBeFalse();
      expect(new Glob("??").match("abcdefg")).toBeFalse();
      expect(new Glob("???").match("a")).toBeFalse();
      expect(new Glob("???").match("aa")).toBeFalse();
      expect(new Glob("???").match("ab")).toBeFalse();
      expect(new Glob("???").match("aaa")).toBeTrue();
      expect(new Glob("???").match("abcdefg")).toBeFalse();
      expect(new Glob("a?c").match("aaa")).toBeFalse();
      expect(new Glob("a?c").match("aac")).toBeTrue();
      expect(new Glob("a?c").match("abc")).toBeTrue();
      expect(new Glob("ab?").match("a")).toBeFalse();
      expect(new Glob("ab?").match("aa")).toBeFalse();
      expect(new Glob("ab?").match("ab")).toBeFalse();
      expect(new Glob("ab?").match("ac")).toBeFalse();
      expect(new Glob("ab?").match("abcd")).toBeFalse();
      expect(new Glob("ab?").match("abbb")).toBeFalse();
      expect(new Glob("a?b").match("acb")).toBeTrue();
      expect(new Glob("a/?/c/?/e.md").match("a/bb/c/dd/e.md")).toBeFalse();
      expect(new Glob("a/??/c/??/e.md").match("a/bb/c/dd/e.md")).toBeTrue();
      expect(new Glob("a/??/c.md").match("a/bbb/c.md")).toBeFalse();
      expect(new Glob("a/?/c.md").match("a/b/c.md")).toBeTrue();
      expect(new Glob("a/?/c/?/e.md").match("a/b/c/d/e.md")).toBeTrue();
      expect(new Glob("a/?/c/???/e.md").match("a/b/c/d/e.md")).toBeFalse();
      expect(new Glob("a/?/c/???/e.md").match("a/b/c/zzz/e.md")).toBeTrue();
      expect(new Glob("a/?/c.md").match("a/bb/c.md")).toBeFalse();
      expect(new Glob("a/??/c.md").match("a/bb/c.md")).toBeTrue();
      expect(new Glob("a/???/c.md").match("a/bbb/c.md")).toBeTrue();
      expect(new Glob("a/????/c.md").match("a/bbbb/c.md")).toBeTrue();
    });

    test("braces", () => {
      expect(new Glob("{a,b,c}").match("a")).toBeTrue();
      expect(new Glob("{a,b,c}").match("b")).toBeTrue();
      expect(new Glob("{a,b,c}").match("c")).toBeTrue();
      expect(new Glob("{a,b,c}").match("aa")).toBeFalse();
      expect(new Glob("{a,b,c}").match("bb")).toBeFalse();
      expect(new Glob("{a,b,c}").match("cc")).toBeFalse();
      expect(new Glob("a/{a,b}").match("a/a")).toBeTrue();
      expect(new Glob("a/{a,b}").match("a/b")).toBeTrue();
      expect(new Glob("a/{a,b}").match("a/c")).toBeFalse();
      expect(new Glob("a/{a,b}").match("b/b")).toBeFalse();
      expect(new Glob("a/{a,b,c}").match("b/b")).toBeFalse();
      expect(new Glob("a/{a,b,c}").match("a/c")).toBeTrue();
      expect(new Glob("a{b,bc}.txt").match("abc.txt")).toBeTrue();
      expect(new Glob("foo[{a,b}]baz").match("foo{baz")).toBeTrue();
      expect(new Glob("a{,b}.txt").match("abc.txt")).toBeFalse();
      expect(new Glob("a{a,b,}.txt").match("abc.txt")).toBeFalse();
      expect(new Glob("a{b,}.txt").match("abc.txt")).toBeFalse();
      expect(new Glob("a{,b}.txt").match("a.txt")).toBeTrue();
      expect(new Glob("a{b,}.txt").match("a.txt")).toBeTrue();
      expect(new Glob("a{a,b,}.txt").match("aa.txt")).toBeTrue();
      expect(new Glob("a{a,b,}.txt").match("aa.txt")).toBeTrue();
      expect(new Glob("a{,b}.txt").match("ab.txt")).toBeTrue();
      expect(new Glob("a{b,}.txt").match("ab.txt")).toBeTrue();
      // try expect(match("{a/,}a/**", "a"));
      expect(new Glob("a{a,b/}*.txt").match("aa.txt")).toBeTrue();
      expect(new Glob("a{a,b/}*.txt").match("ab/.txt")).toBeTrue();
      expect(new Glob("a{a,b/}*.txt").match("ab/a.txt")).toBeTrue();
      // try expect(match("{a/,}a/**", "a/"));
      expect(new Glob("{a/,}a/**").match("a/a/")).toBeTrue();
      // try expect(match("{a/,}a/**", "a/a"));
      expect(new Glob("{a/,}a/**").match("a/a/a")).toBeTrue();
      expect(new Glob("{a/,}a/**").match("a/a/")).toBeTrue();
      expect(new Glob("{a/,}a/**").match("a/a/a/")).toBeTrue();
      expect(new Glob("{a/,}b/**").match("a/b/a/")).toBeTrue();
      expect(new Glob("{a/,}b/**").match("b/a/")).toBeTrue();
      expect(new Glob("a{,/}*.txt").match("a.txt")).toBeTrue();
      expect(new Glob("a{,/}*.txt").match("ab.txt")).toBeTrue();
      expect(new Glob("a{,/}*.txt").match("a/b.txt")).toBeTrue();
      expect(new Glob("a{,/}*.txt").match("a/ab.txt")).toBeTrue();
      expect(new Glob("a{,.*{foo,db},\\(bar\\)}.txt").match("a.txt")).toBeTrue();
      expect(new Glob("a{,.*{foo,db},\\(bar\\)}.txt").match("adb.txt")).toBeFalse();
      expect(new Glob("a{,.*{foo,db},\\(bar\\)}.txt").match("a.db.txt")).toBeTrue();
      expect(new Glob("a{,*.{foo,db},\\(bar\\)}.txt").match("a.txt")).toBeTrue();
      expect(new Glob("a{,*.{foo,db},\\(bar\\)}.txt").match("adb.txt")).toBeFalse();
      expect(new Glob("a{,*.{foo,db},\\(bar\\)}.txt").match("a.db.txt")).toBeTrue();
      // try expect(match("a{,.*{foo,db},\\(bar\\)}", "a"));
      expect(new Glob("a{,.*{foo,db},\\(bar\\)}").match("adb")).toBeFalse();
      expect(new Glob("a{,.*{foo,db},\\(bar\\)}").match("a.db")).toBeTrue();
      // try expect(match("a{,*.{foo,db},\\(bar\\)}", "a"));
      expect(new Glob("a{,*.{foo,db},\\(bar\\)}").match("adb")).toBeFalse();
      expect(new Glob("a{,*.{foo,db},\\(bar\\)}").match("a.db")).toBeTrue();
      expect(new Glob("{,.*{foo,db},\\(bar\\)}").match("a")).toBeFalse();
      expect(new Glob("{,.*{foo,db},\\(bar\\)}").match("adb")).toBeFalse();
      expect(new Glob("{,.*{foo,db},\\(bar\\)}").match("a.db")).toBeFalse();
      expect(new Glob("{,.*{foo,db},\\(bar\\)}").match(".db")).toBeTrue();
      expect(new Glob("{,*.{foo,db},\\(bar\\)}").match("a")).toBeFalse();
      expect(new Glob("{*,*.{foo,db},\\(bar\\)}").match("a")).toBeTrue();
      expect(new Glob("{,*.{foo,db},\\(bar\\)}").match("adb")).toBeFalse();
      expect(new Glob("{,*.{foo,db},\\(bar\\)}").match("a.db")).toBeTrue();
      expect(new Glob("a/b/**/c{d,e}/**/xyz.md").match("a/b/c/xyz.md")).toBeFalse();
      expect(new Glob("a/b/**/c{d,e}/**/xyz.md").match("a/b/d/xyz.md")).toBeFalse();
      expect(new Glob("a/b/**/c{d,e}/**/xyz.md").match("a/b/cd/xyz.md")).toBeTrue();
      expect(new Glob("a/b/**/{c,d,e}/**/xyz.md").match("a/b/c/xyz.md")).toBeTrue();
      expect(new Glob("a/b/**/{c,d,e}/**/xyz.md").match("a/b/d/xyz.md")).toBeTrue();
      expect(new Glob("a/b/**/{c,d,e}/**/xyz.md").match("a/b/e/xyz.md")).toBeTrue();
      expect(new Glob("*{a,b}*").match("xax")).toBeTrue();
      expect(new Glob("*{a,b}*").match("xxax")).toBeTrue();
      expect(new Glob("*{a,b}*").match("xbx")).toBeTrue();
      expect(new Glob("*{*a,b}").match("xba")).toBeTrue();
      expect(new Glob("*{*a,b}").match("xb")).toBeTrue();
      expect(new Glob("*??").match("a")).toBeFalse();
      expect(new Glob("*???").match("aa")).toBeFalse();
      expect(new Glob("*???").match("aaa")).toBeTrue();
      expect(new Glob("*****??").match("a")).toBeFalse();
      expect(new Glob("*****???").match("aa")).toBeFalse();
      expect(new Glob("*****???").match("aaa")).toBeTrue();
      expect(new Glob("a*?c").match("aaa")).toBeFalse();
      expect(new Glob("a*?c").match("aac")).toBeTrue();
      expect(new Glob("a*?c").match("abc")).toBeTrue();
      expect(new Glob("a**?c").match("abc")).toBeTrue();
      expect(new Glob("a**?c").match("abb")).toBeFalse();
      expect(new Glob("a**?c").match("acc")).toBeTrue();
      expect(new Glob("a*****?c").match("abc")).toBeTrue();
      expect(new Glob("*****?").match("a")).toBeTrue();
      expect(new Glob("*****?").match("aa")).toBeTrue();
      expect(new Glob("*****?").match("abc")).toBeTrue();
      expect(new Glob("*****?").match("zzz")).toBeTrue();
      expect(new Glob("*****?").match("bbb")).toBeTrue();
      expect(new Glob("*****?").match("aaaa")).toBeTrue();
      expect(new Glob("*****??").match("a")).toBeFalse();
      expect(new Glob("*****??").match("aa")).toBeTrue();
      expect(new Glob("*****??").match("abc")).toBeTrue();
      expect(new Glob("*****??").match("zzz")).toBeTrue();
      expect(new Glob("*****??").match("bbb")).toBeTrue();
      expect(new Glob("*****??").match("aaaa")).toBeTrue();
      expect(new Glob("?*****??").match("a")).toBeFalse();
      expect(new Glob("?*****??").match("aa")).toBeFalse();
      expect(new Glob("?*****??").match("abc")).toBeTrue();
      expect(new Glob("?*****??").match("zzz")).toBeTrue();
      expect(new Glob("?*****??").match("bbb")).toBeTrue();
      expect(new Glob("?*****??").match("aaaa")).toBeTrue();
      expect(new Glob("?*****?c").match("abc")).toBeTrue();
      expect(new Glob("?*****?c").match("abb")).toBeFalse();
      expect(new Glob("?*****?c").match("zzz")).toBeFalse();
      expect(new Glob("?***?****c").match("abc")).toBeTrue();
      expect(new Glob("?***?****c").match("bbb")).toBeFalse();
      expect(new Glob("?***?****c").match("zzz")).toBeFalse();
      expect(new Glob("?***?****?").match("abc")).toBeTrue();
      expect(new Glob("?***?****?").match("bbb")).toBeTrue();
      expect(new Glob("?***?****?").match("zzz")).toBeTrue();
      expect(new Glob("?***?****").match("abc")).toBeTrue();
      expect(new Glob("*******c").match("abc")).toBeTrue();
      expect(new Glob("*******?").match("abc")).toBeTrue();
      expect(new Glob("a*cd**?**??k").match("abcdecdhjk")).toBeTrue();
      expect(new Glob("a**?**cd**?**??k").match("abcdecdhjk")).toBeTrue();
      expect(new Glob("a**?**cd**?**??k***").match("abcdecdhjk")).toBeTrue();
      expect(new Glob("a**?**cd**?**??***k").match("abcdecdhjk")).toBeTrue();
      expect(new Glob("a**?**cd**?**??***k**").match("abcdecdhjk")).toBeTrue();
      expect(new Glob("a****c**?**??*****").match("abcdecdhjk")).toBeTrue();
      expect(new Glob("a/?/c/?/*/e.md").match("a/b/c/d/e.md")).toBeFalse();
      expect(new Glob("a/?/c/?/*/e.md").match("a/b/c/d/e/e.md")).toBeTrue();
      expect(new Glob("a/?/c/?/*/e.md").match("a/b/c/d/efghijk/e.md")).toBeTrue();
      expect(new Glob("a/?/**/e.md").match("a/b/c/d/efghijk/e.md")).toBeTrue();
      expect(new Glob("a/?/e.md").match("a/bb/e.md")).toBeFalse();
      expect(new Glob("a/??/e.md").match("a/bb/e.md")).toBeTrue();
      expect(new Glob("a/?/**/e.md").match("a/bb/e.md")).toBeFalse();
      expect(new Glob("a/?/**/e.md").match("a/b/ccc/e.md")).toBeTrue();
      expect(new Glob("a/*/?/**/e.md").match("a/b/c/d/efghijk/e.md")).toBeTrue();
      expect(new Glob("a/*/?/**/e.md").match("a/b/c/d/efgh.ijk/e.md")).toBeTrue();
      expect(new Glob("a/*/?/**/e.md").match("a/b.bb/c/d/efgh.ijk/e.md")).toBeTrue();
      expect(new Glob("a/*/?/**/e.md").match("a/bbb/c/d/efgh.ijk/e.md")).toBeTrue();
      expect(new Glob("a/*/ab??.md").match("a/bbb/abcd.md")).toBeTrue();
      expect(new Glob("a/bbb/ab??.md").match("a/bbb/abcd.md")).toBeTrue();
      expect(new Glob("a/bbb/ab???md").match("a/bbb/abcd.md")).toBeTrue();
    });
  });

  test("invalid input", () => {
    const glob = new Glob("nice");

    expect(
      returnError(() =>
        glob.match(
          // @ts-expect-error
          null,
        ),
      ),
    ).toBeDefined();
    expect(
      returnError(() =>
        glob.match(
          // @ts-expect-error
          true,
        ),
      ),
    ).toBeDefined();

    expect(
      returnError(() =>
        glob.match(
          // @ts-expect-error
          {},
        ),
      ),
    ).toBeDefined();
  });

  test("trailing globstar patterns", () => {
    let glob = new Glob("C:/Users/window/AppData/Local/Temp/testworkspace_V7osKW**");
    expect(glob.match("C:/Users/window/AppData/Local/Temp/testworkspace_V7osKW/packages/malfored1")).toBeFalse();

    // Trailing globstar with no slash won't match subdirectories
    // expect(new Glob("foo**").match("foo/bar/hi")).toBeFalse();
    expect(new Glob("foo**").match("foobar")).toBeTrue();
    expect(new Glob("foo**").match("foo")).toBeTrue();

    // Basic trailing globstar
    expect(new Glob("foo/**").match("foo")).toBeFalse();
    expect(new Glob("foo/**").match("foo/")).toBeTrue();
    expect(new Glob("foo/**").match("foo/bar")).toBeTrue();
    expect(new Glob("foo/**").match("foo/bar/baz")).toBeTrue();
    expect(new Glob("foo/**").match("foo/bar/baz/")).toBeTrue();
    expect(new Glob("foo/**").match("food/bar")).toBeFalse();

    // Multiple trailing globstars (should behave the same as one)
    expect(new Glob("foo/**/**").match("foo")).toBeFalse();
    expect(new Glob("foo/**/**").match("foo/")).toBeTrue();
    expect(new Glob("foo/**/**").match("foo/bar")).toBeTrue();
    expect(new Glob("foo/**/**").match("foo/bar/baz")).toBeTrue();
    expect(new Glob("foo/**/**/**").match("foo/bar/baz")).toBeTrue();

    // Trailing globstar with file extension
    expect(new Glob("foo/**/*.js").match("foo/bar.js")).toBeTrue();
    expect(new Glob("foo/**/*.js").match("foo/bar/baz.js")).toBeTrue();
    expect(new Glob("foo/**/*.js").match("foo/bar/baz/qux.js")).toBeTrue();
    expect(new Glob("foo/**/*.js").match("foo/bar.txt")).toBeFalse();
    expect(new Glob("foo/**/*.js").match("foo/bar/baz.txt")).toBeFalse();

    // Complex patterns with trailing globstars
    expect(new Glob("**/foo/**").match("foo/")).toBeTrue();
    expect(new Glob("**/foo/**").match("a/foo/")).toBeTrue();
    expect(new Glob("**/foo/**").match("a/b/foo/")).toBeTrue();
    expect(new Glob("**/foo/**").match("foo/bar")).toBeTrue();
    expect(new Glob("**/foo/**").match("a/foo/bar")).toBeTrue();
    expect(new Glob("**/foo/**").match("a/b/foo/bar/baz")).toBeTrue();

    // Edge cases
    expect(new Glob("/**").match("/")).toBeTrue();
    expect(new Glob("/**").match("/foo")).toBeTrue();
    expect(new Glob("/**").match("/foo/bar")).toBeTrue();

    // Empty segments
    expect(new Glob("foo///**").match("foo///bar")).toBeTrue();
    expect(new Glob("foo///**").match("foo/bar")).toBeFalse();

    // Dots and special characters
    expect(new Glob("./**").match(".")).toBeFalse();
    expect(new Glob("./**").match("./")).toBeTrue();
    expect(new Glob("./**").match("./foo")).toBeTrue();
    expect(new Glob("./**").match("./foo/bar")).toBeTrue();
    expect(new Glob("./**").match("../foo")).toBeFalse();

    // Unicode characters
    expect(new Glob("🎉/**").match("🎉/")).toBeTrue();
    expect(new Glob("🎉/**").match("🎉/🌟")).toBeTrue();
    expect(new Glob("🎉/**").match("🎉/🌟/✨")).toBeTrue();

    // Mixing with other glob features
    expect(new Glob("foo/{bar,baz}/**").match("foo/bar/")).toBeTrue();
    expect(new Glob("foo/{bar,baz}/**").match("foo/baz/qux")).toBeTrue();
    expect(new Glob("foo/{bar,baz}/**").match("foo/qux/")).toBeFalse();

    expect(new Glob("foo/[a-z]/**").match("foo/a/")).toBeTrue();
    expect(new Glob("foo/[a-z]/**").match("foo/z/bar")).toBeTrue();
    expect(new Glob("foo/[a-z]/**").match("foo/1/")).toBeFalse();

    // Escaped characters
    expect(new Glob("foo\\*/**").match("foo*/")).toBeTrue();
    expect(new Glob("foo\\*/**").match("foo*/bar")).toBeTrue();
    expect(new Glob("foo\\*/**").match("foobar/")).toBeFalse();

    // Very long paths
    const longPath = "a/".repeat(100);
    expect(new Glob("a/**").match(longPath)).toBeTrue();

    // Mixed case
    expect(new Glob("FoO/**").match("FoO/BaR")).toBeTrue();
    expect(new Glob("FoO/**").match("foo/bar")).toBeFalse();

    // Partial segment matches should fail
    expect(new Glob("foo/**").match("foobar/")).toBeFalse();
    expect(new Glob("foo/**").match("foobar/baz")).toBeFalse();

    // Missing slashes
    expect(new Glob("foo**").match("foo/bar")).toBeFalse();
    expect(new Glob("foo**").match("foobar")).toBeTrue();
    if (isWindows) {
      expect(new Glob("foo/**").match("foo\\bar")).toBeTrue();
    } else {
      expect(new Glob("foo/**").match("foo\\bar")).toBeFalse();
    }

    // Path traversal
    expect(new Glob("foo/**").match("foo/../bar")).toBeTrue();
    expect(new Glob("foo/**").match("foo/bar/../../baz")).toBeTrue();
    expect(new Glob("foo/**").match("foo/bar/../..")).toBeTrue();

    // Empty path segments
    expect(new Glob("foo/**//").match("foo///bar")).toBeFalse();
    expect(new Glob("foo/**").match("foo//bar")).toBeTrue();
    expect(new Glob("a/**/").match("a/b//")).toBeTrue();
    expect(new Glob("foo/**/").match("foo/bar//")).toBeTrue();

    // Unicode normalization
    expect(new Glob("foo/**").match("foo/\u0041\u030A")).toBeTrue(); // "A" with ring
    expect(new Glob("foo/**").match("foo/\u00C5")).toBeTrue(); // "Å" single character
  });

  test.each([
    ["@(a|b).js", "a.js", true],
    ["@(a|b).js", "b.js", true],
    ["@(a|b).js", "c.js", false],
    ["@(a|b).js", "ab.js", false],
    ["?(a).js", ".js", true],
    ["?(a).js", "a.js", true],
    ["?(a).js", "aa.js", false],
    ["*(a|b).js", ".js", true],
    ["*(a|b).js", "abba.js", true],
    ["*(a|b).js", "abc.js", false],
    ["+(a|b).js", ".js", false],
    ["+(a|b).js", "ab.js", true],
    ["!(a|b).js", "c.js", true],
    ["!(a|b).js", "a.js", false],
    ["!(a|b).js", "ab.js", true],
    ["!(*.test).ts", "a.ts", true],
    ["!(*.test).ts", "a.test.ts", false],
    ["*.!(test).ts", "a.spec.ts", true],
    ["*.!(test).ts", "a.test.ts", false],
    // A group doesn't cross a path separator unless an alternative has one.
    ["!(a)", "b/c", false],
    ["@(a/b|c)/d", "a/b/d", true],
    ["@(a/b|c)/d", "c/d", true],
    ["@(a/b|c)/d", "a/d", false],
    ["src/@(a|b)/**/*.ts", "src/a/x/y.ts", true],
    ["src/@(a|b)/**/*.ts", "src/c/x/y.ts", false],
    ["**/*.@(js|ts)", "a/b/c.ts", true],
    ["**/*.@(js|ts)", "a/b/c.css", false],
    // Groups nest, and they mix with braces and other wildcards.
    ["@(a|+(b|c))d", "bcbd", true],
    ["@(a|+(b|c))d", "abd", false],
    ["@(*.js|{a,b}.ts)", "x.js", true],
    ["@(*.js|{a,b}.ts)", "b.ts", true],
    ["@(*.js|{a,b}.ts)", "c.ts", false],
    ["{@(a|b),c}.js", "b.js", true],
    ["+([0-9]).txt", "123.txt", true],
    ["+([0-9]).txt", "12a.txt", false],
    // `!(` at the start of the pattern is a group, not a negation.
    ["!(a)", "b", true],
    ["!(a)", "a", false],
    ["!!(a)", "a", true],
    ["!!(a)", "b", false],
  ])("extglob: %s with %s is %p", (pattern, path, expected) => {
    expect(new Glob(pattern).match(path)).toBe(expected);
  });

  test.each([
    // Next.js route groups
    ["app/(marketing)/**", "app/(marketing)/page.tsx", true],
    ["app/(marketing)/**", "app/marketing/page.tsx", false],
    ["app/(a|b)/*.tsx", "app/(a|b)/page.tsx", true],
    ["app/(a|b)/*.tsx", "app/a/page.tsx", false],
    ["app/@modal/(.)photo/**", "app/@modal/(.)photo/page.tsx", true],
    ["a(b)", "a(b)", true],
    ["a(b)", "ab", false],
    ["(a)(b)", "(a)(b)", true],
    ["\\@(a)", "@(a)", true],
    ["\\@(a)", "a", false],
    ["@\\(a)", "@(a)", true],
    ["@(a", "@(a", true],
    ["@(a", "a", false],
    ["a)", "a)", true],
    ["a|b", "a|b", true],
  ])("parentheses without a prefix are literal: %s with %s is %p", (pattern, path, expected) => {
    expect(new Glob(pattern).match(path)).toBe(expected);
  });

  test.each([
    ["{1..3}.txt", ["1.txt", "2.txt", "3.txt"], ["0.txt", "4.txt", "01.txt", "1..3.txt", "-.txt", ".txt"]],
    ["{3..1}.txt", ["1.txt", "2.txt", "3.txt"], ["0.txt", "4.txt"]],
    ["{8..12}", ["8", "9", "10", "11", "12"], ["7", "13", "1", "08"]],
    ["{01..10}", ["01", "05", "10"], ["1", "5", "00", "11", "010"]],
    ["{-2..2}", ["-2", "-1", "0", "1", "2"], ["-3", "3", "-0", "-"]],
    ["{1..9..2}", ["1", "3", "5", "7", "9"], ["2", "4", "0", "11"]],
    ["{9..1..4}", ["9", "5", "1"], ["7", "3"]],
    ["{a..e}", ["a", "c", "e"], ["f", "A", "ab", ""]],
    ["{a..g..3}", ["a", "d", "g"], ["b", "c"]],
    ["v{1..2}/**/*.js", ["v1/a.js", "v2/a/b.js"], ["v3/a.js", "v/a.js"]],
    ["{{1..2},x}", ["1", "2", "x"], ["3", "1..2"]],
    // Not sequences
    ["{1..3,x}", ["1..3", "x"], ["1", "2"]],
    ["{1..a}", ["1..a"], ["1", "a"]],
    ["{1..}", ["1.."], ["1"]],
    ["{1\\..3}", ["1..3"], ["2"]],
  ])("brace sequence %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    expect(matches.filter(path => !glob.match(path))).toEqual([]);
    expect(others.filter(path => glob.match(path))).toEqual([]);
  });

  test("groups nest to any depth", () => {
    const depth = 200;
    expect(new Glob("{".repeat(depth) + "a,b" + "}".repeat(depth)).match("b")).toBeTrue();
    expect(new Glob("{".repeat(depth) + "a,b" + "}".repeat(depth)).match("c")).toBeFalse();
    expect(new Glob("@(".repeat(depth) + "a|b" + ")".repeat(depth)).match("b")).toBeTrue();
    expect(new Glob("+(".repeat(depth) + "a|b" + ")".repeat(depth)).match("abab")).toBeTrue();
    expect(new Glob("+(".repeat(depth) + "a|b" + ")".repeat(depth)).match("abc")).toBeFalse();
  });

  test("many repeated groups match in polynomial time", () => {
    const path = "a".repeat(200);
    expect(new Glob("*(a|aa)".repeat(20) + "b").match(path)).toBeFalse();
    expect(new Glob("*(*(*(a|aa)))b").match(path)).toBeFalse();
    expect(new Glob("{a,aa}".repeat(100) + "b").match(path)).toBeFalse();
    expect(new Glob("+(a|aa)".repeat(20)).match(path)).toBeTrue();
  });

  test.each([
    ["**/*{.test,.spec,_test}*.{ts,js}", "src/button/button_test.ts", true],
    ["**/*{.test,.spec,_test}*.{ts,js}", "src/button/button.spec.js", true],
    ["**/*{.test,.spec,_test}*.{ts,js}", "src/button/button.ts", false],
    ["*{_a,-b}", "x_a", true],
    ["*{_a,-b}", "x-b", true],
    ["*{_a,-b}", "x_b", false],
    ["*{(,)}", "x(", true],
    ["*{(,)}", "x)", true],
    ["*{(,)}", "x", false],
    ["*{],~, ,=}", "x]", true],
    ["*{],~, ,=}", "x ", true],
    ["*{],~, ,=}", "x=", true],
    ["*{],~, ,=}", "x,", false],
    ["*@(,|})", "x,", true],
    ["*@(,|})", "x}", true],
    ["*@(,|})", "x|", false],
    ["*{|,#}", "x|", true],
    ["**/{_a,b}/c", "x/_a/c", true],
    ["**/{_a,b}/c", "x/a/c", false],
  ])("alternatives can start with punctuation: %s with %s is %p", (pattern, path, expected) => {
    expect(new Glob(pattern).match(path)).toBe(expected);
  });

  test.each([
    ["{a,b", "{a,b", true],
    ["{a,b", "a", false],
    ["a{", "a{", true],
    ["[a", "[a", true],
    ["[a", "a", false],
    ["*[", "x[", true],
    ["{[a}", "[a", true],
  ])("an unclosed group or class is literal: %s with %s is %p", (pattern, path, expected) => {
    expect(new Glob(pattern).match(path)).toBe(expected);
  });

  // If one of these loops for ever again, the test times out.
  test.each([
    ["*{/,}/**/*a", "a//"],
    ["{*,}**/**/*a", "a/"],
    ["{*,a}**/**/*.ts", "src/"],
    ["{*,a}**/**/*.ts", "packages/a/src/"],
    ["**/{/,}/**/*a", "//"],
    ["{*,}/**/*{a,}.ts", "/a/"],
    ["{*,}/**/{a,}*.ts", "/a/"],
    ["{*,}/**/*{@}", "//"],
    ["c[{]{{},}/**/*{@}", "c{//"],
    ["**//!(*/)/**/*[ab]*", "a//"],
    ["{*,}/**/*a", "//"],
    ["{*,b}/**/*.ts", "a//"],
    ["{src,*}/**/*.ts", "src//"],
    ["@(*|b)/**/*.ts", "a//"],
  ])("a group before `**/*` on a path that ends with `/`: %s doesn't match %s", (pattern, path) => {
    expect(new Glob(pattern).match(path)).toBeFalse();
  });

  test.each([
    ["*{b/c,ab}/d", "ab/c/d", true],
    ["*{ab,b/c}/d", "ab/c/d", true],
    ["*{s/lib,libs}/*.ts", "libs/lib/a.ts", true],
    ["*{-ui/src,my-ui}/*.ts", "my-ui/src/a.ts", true],
    ["**/*{b/c,ab}/d", "x/ab/c/d", true],
    ["?*{b/c,ab}/d", "xab/c/d", true],
    ["*@(b/c|ab)/d", "ab/c/d", true],
    ["*{a/,b}?/", "ba/b/", true],
    ["*{b/c,ab}/d", "ab/d", true],
    ["*{b/c,ab}/d", "xb/c/d", true],
    ["*{b/c,ab}/d", "ab/c", false],
    ["a*{b/c,b}/d", "ab/c/d", true],
    ["*{b/c,a*}/d", "ab/c/d", true],
  ])("a `*` before a group with a `/` in an alternative: %s with %s is %p", (pattern, path, expected) => {
    expect(new Glob(pattern).match(path)).toBe(expected);
  });

  test.each([
    ["**/{,ab_}*[/_]/?js/[?]", "ab_//1js/?", true],
    ["**/ab_*[/_]/?js/[?]", "ab_//1js/?", true],
    ["{*,(}{*[^a]*}", "(/", true],
    ["*?()****/**/", "c", true],
    ["*{}****/**/", "c", true],
    ["*{,}****/**/", "c", true],
  ])("a group next to a class that matches `/`, or next to `****`: %s with %s is %p", (pattern, path, expected) => {
    expect(new Glob(pattern).match(path)).toBe(expected);
  });

  test.each([
    ["*{a,ba}/", ["a/", "ba/", "xa/", "xba/", "aba/"], ["/", "b/", "xb/", "xba", "xba/a"]],
    ["*.{ts,tsx,js}", ["a.ts", "a.tsx", "a.js", ".ts", "a.ts.tsx"], ["a.jsx", "a.t", "a.tsx.", "a/b.ts", "ts"]],
    ["{src,apps,packages}/**", ["src/a", "apps/", "packages/a/b/c.ts"], ["src", "srcs/a", "app/a", "lib/a", "a/src/b"]],
    ["{src,apps,packages}/**/*.ts", ["src/a.ts", "apps/a/b.ts"], ["src/a.js", "lib/a.ts", "packages.ts", "src.ts"]],
    ["packages/{a,bcd}/*", ["packages/a/x", "packages/bcd/x"], ["packages/b/x", "packages/ab/x", "packages/a/x/y"]],
    ["@(ab|cd)e", ["abe", "cde"], ["ab", "ace", "abcde"]],
    ["x{ab,cd}{ef,gh}", ["xabef", "xcdgh"], ["xabcd", "xab", "xefab"]],
    [
      "**/{src,lib}/**/{test,spec}/**/*.{ts,js}",
      ["src/test/a.ts", "a/lib/b/spec/c/d.js"],
      ["src/a.ts", "test/src/a.ts"],
    ],
    // One alternative is the start of another, so what the group takes depends on what follows it.
    ["{a,ab}c", ["ac", "abc"], ["a", "ab", "abbc"]],
    ["*{a,ab}*c", ["ac", "abc", "xabxc"], ["bc", "xa"]],
    ["{a,ab}{b,bc}", ["ab", "abb", "abc", "abbc"], ["a", "abcb"]],
  ])("groups of plain words: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    expect(matches.filter(path => !glob.match(path))).toEqual([]);
    expect(others.filter(path => glob.match(path))).toEqual([]);
  });

  test.each([
    ["package.json", ["package.json"], ["package.jso", "package.jsonc", "Package.json", "", "a/package.json"]],
    [
      "a/b/c/d/e/f/g.ts",
      ["a/b/c/d/e/f/g.ts"],
      ["a/b/c/d/e/f/g.t", "a/b/c/d/e/f/g.tsx", "a/b/c/d/e/f", "a/b/c/d/e/f//g.ts"],
    ],
    ["", [""], ["a", "/"]],
    ["/", ["/"], ["", "//", "a"]],
    ["a(b)|c,d}", ["a(b)|c,d}"], ["ab", "a(b)|c,d"]],
    ["?ndex.ts", ["index.ts", "éndex.ts", "😀ndex.ts"], ["ndex.ts", "/ndex.ts", "iindex.ts", "index.tsx", "index.t"]],
    ["a?", ["ab", "aé"], ["a", "a/", "abc"]],
    ["a/?/b", ["a/x/b", "a/é/b"], ["a//b", "a///b", "a/xy/b"]],
    ["??", ["ab", "éé", "aé", "éa"], ["a", "é", "abc", "a/", "/a"]],
    ["a?*.ts", ["ab.ts", "abc.ts", "aé.ts"], ["a.ts", "a/.ts"]],
    ["a?/**/*.ts", ["ab/c.ts", "ab/c/d.ts"], ["a/c.ts", "abc/d.ts"]],
    ["a?{b,c}", ["axb", "aéc"], ["ab", "a/b", "axd"]],
    ["a?(b", ["ax(b"], ["a", "ab", "a(b"]],
    ["!a?", ["a", "abc", "b"], ["ab"]],
  ])("a pattern that starts with plain text, `/` or `?`: %j", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    expect(matches.filter(path => !glob.match(path))).toEqual([]);
    expect(others.filter(path => glob.match(path))).toEqual([]);
  });

  test.each([
    [
      "**/__tests__/**/*.[jt]s?(x)",
      ["__tests__/a.js", "src/__tests__/a.tsx", "a/__tests__/b/c.jsx", "__tests__/a.js.ts"],
      ["__tests__/a.jsxx", "__tests__/a.css", "src/a.js", "__tests__/a.jsx/b", "__tests__/a.x"],
    ],
    ["*.ts?(x)", ["a.ts", "a.tsx", ".ts", "a.ts.tsx"], ["a.tsxx", "a.t", "a.tsx/b", "a/b.ts"]],
    ["**/*.ts?(x)", ["a.ts", "a/b.tsx"], ["a.tsxx", "a/b.tsy"]],
    ["?(x)", ["", "x"], ["xx", "y", "x/"]],
    ["?()", [""], ["a", "/"]],
    ["?(a|bc)/d", ["/d", "a/d", "bc/d"], ["b/d", "abc/d", "d", "a/bc/d"]],
    ["a?(b|cd)", ["a", "ab", "acd"], ["abcd", "ac", "abb", "a/"]],
    ["src/?(lib)/*.ts", ["src//a.ts", "src/lib/a.ts"], ["src/a.ts", "src/libs/a.ts", "src/li/a.ts"]],
    ["*?(x)", ["", "a", "x", "ax", "xx"], ["a/x", "/"]],
    ["*?(x)/", ["/", "a/", "x/", "ax/"], ["a", "a/x"]],
    ["**/?(x)", ["", "x", "a/", "a/x", "a/b/x"], ["a", "a/y", "xx"]],
    ["a?(b)c", ["ac", "abc"], ["abbc", "a", "ab"]],
    ["?(a)?(b)", ["", "a", "b", "ab"], ["ba", "aa", "abb"]],
    ["{a,?(b)}", ["", "a", "b"], ["ab", "bb"]],
    ["?(a*)", ["", "a", "ab"], ["b", "a/b"]],
    ["\\?(x)", ["?(x)"], ["", "x"]],
    ["!?(x)", ["xx", "y"], ["", "x"]],
  ])("`?(a)` is `a` or nothing: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    expect(matches.filter(path => !glob.match(path))).toEqual([]);
    expect(others.filter(path => glob.match(path))).toEqual([]);
  });

  const a30 = Buffer.alloc(30, "a").toString();
  const e28 = Buffer.alloc(28, "e").toString();
  test.each([
    [
      "*{[mM]odel,[cC]ontroller}*.ts",
      ["explorerViewModel.ts", "model.ts", "aController.ts", "Modelcontroller.x.ts"],
      ["views", "explorerView.ts", "odel.ts", "Model.tsx", "a/Model.ts"],
    ],
    [
      "src/vs/{base,platform,workbench}/**/{test,browser}/**/*{[mM]odel,[cC]ontroller}*.ts",
      [
        "src/vs/workbench/contrib/files/browser/views/explorerViewModel.ts",
        "src/vs/base/test/model.ts",
        "src/vs/base/a/browser/b/c/xController.spec.ts",
      ],
      [
        "src/vs/workbench/contrib/files/browser/views/explorerView.ts",
        "src/vs/editor/browser/model.ts",
        "src/vs/base/common/model.ts",
        "src/vs/base/browser/model/a.ts",
      ],
    ],
    ["{a,bc}d", ["ad", "bcd"], ["abcd", "d", "bd", "acd"]],
    ["x{a,bc}*", ["xa", "xbc", "xab", "xbcd"], ["x", "xb", "a", "xa/b"]],
    ["*{a,bc}d", ["ad", "bcd", "xad", "abcd", "aad"], ["d", "bd", "ada"]],
    ["{,a}b", ["b", "ab"], ["", "a", "aab"]],
    ["a{,b}c{d,e}", ["acd", "abce"], ["ac", "abcf"]],
    ["{ab,cd}x{e,fg}h", ["abxeh", "cdxfgh"], ["abxh", "adxeh"]],
    // A `*` in the group next to a `*` outside it isn't a `**`.
    ["*{*a,b}c", ["ac", "bc", "xac", "xbc"], ["c", "a/ac", "x/bc"]],
    ["{a*,b}*c", ["ac", "bc", "axc", "bxc"], ["c", "a/c", "ax/c"]],
    ["*{,a}*", ["", "a", "xay"], ["a/b", "/"]],
    ["a/*{,b}*/c", ["a/x/c", "a/b/c", "a//c"], ["a/x/y/c", "a/c"]],
    ["{?,ab}c", ["xc", "abc", "éc"], ["c", "xyc", "/c"]],
    ["{[a-c],de}f", ["af", "cf", "def"], ["df", "ef", "adef"]],
    ["{[a,b],c}d", ["ad", ",d", "bd", "cd"], ["[ad", "a,bd"]],
    ["{[!a],bc}d", ["xd", "bcd"], ["ad"]],
    ["{a,b,c,dd}e", ["ae", "dde"], ["de", "e"]],
    ["{a,b,c,d,ee}f", ["af", "eef"], ["ef", "f"]],
    ["{a,bc}é", ["aé", "bcé"], ["é", "abé"]],
    ["{a,b+}c", ["ac", "b+c"], ["bc", "bbc"]],
    ["{a,bc}}", ["a}", "bc}"], ["a", "abc}"]],
    ["{a,bc},", ["a,", "bc,"], ["a"]],
    ["{a,bc}(d)", ["a(d)", "bc(d)"], ["ad"]],
    ["!{a,bc}d", ["d", "abcd"], ["ad", "bcd"]],
    ["!!{a,bc}d", ["ad", "bcd"], ["d"]],
    ["x/!{a,bc}d", ["x/!ad", "x/!bcd"], ["x/ad", "x/d"]],
    ["{1..3}{a,bc}d", ["1ad", "3bcd"], ["4ad", "ad"]],
    ["{a,bc}{1..3}", ["a1", "bc3"], ["a4", "a"]],
    ["**/{a,bc}d/**/*.ts", ["ad/x.ts", "x/bcd/y/z.ts"], ["abcd/x.ts", "x/d/y.ts"]],
    ["**/*{a,bc}d", ["ad", "x/ybcd", "x/y/ad"], ["x/d", "ad/x"]],
    // 64 and 65 bytes
    [`${a30}{b,cd}${e28}`, [`${a30}b${e28}`, `${a30}cd${e28}`], [`${a30}${e28}`, `${a30}bcd${e28}`]],
    [`${a30}{b,cd}${e28}e`, [`${a30}b${e28}e`, `${a30}cd${e28}e`], [`${a30}${e28}e`, `${a30}bcd${e28}e`]],
  ])("a group whose alternatives differ in length: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 2; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["{x,}c*{,a}*{,a}*{,b}", ["c", "xc"], ["", "x", "xxc"]],
    ["{x,y*}c*{,a}", ["xc", "yc"], ["", "x"]],
    ["@(x|)c*(a|b)", ["c", "xc"], ["", "x"]],
    ["+(x|y)c*(a|b)", ["xc", "xyc"], ["", "xy", "c"]],
    ["?(x)c*(a|b)", ["c", "xc"], ["", "x"]],
    ["q/{x,}c*{,a}*{,b}", ["q/c", "q/xc"], ["q/", "q/x", "c"]],
  ])("%s on a long path that differs only at its start", (pattern, matches, others) => {
    const rest = Buffer.alloc(65536, "ab").toString();
    const glob = new Glob(pattern);
    expect(matches.filter(start => !glob.match(start + rest))).toEqual([]);
    expect(others.filter(start => glob.match(start + rest))).toEqual([]);
  });

  test.each([
    ["\\*.ts", ["*.ts"], ["a.ts", ".ts", "\\*.ts"]],
    ["a\\*b", ["a*b"], ["ab", "axb", "a\\*b"]],
    ["foo\\[1\\].ts", ["foo[1].ts"], ["foo1.ts", "foo\\[1\\].ts"]],
    ["\\a\\b\\n\\r\\t", ["a\b\n\r\t"], ["abnrt"]],
    ["\\?x", ["?x"], ["ax"]],
    ["\\{a,b\\}", ["{a,b}"], ["a", "b"]],
    ["\\{a,b}", ["{a,b}"], ["a", "b"]],
    ["\\a{b,c}", ["ab", "ac"], ["a", "a{b,c}"]],
    ["\\a{b,cd}e", ["abe", "acde"], ["ae"]],
    ["\\a*{b,cd}", ["ab", "axcd"], ["a", "axc"]],
    ["\\é", ["é"], ["e", "\\é"]],
    ["a\\/b", ["a/b"], ["a\\/b", "ab"]],
    ["a\\", ["a\\"], ["a"]],
    ["\\!a", ["!a"], ["a", "b"]],
    ["\\\\a", ["\\a"], ["a", "\\\\a"]],
  ])("a pattern that starts with an escape: %j", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["*/*/*/*", ["a/b/c/d", "ab/cd/ef/gh", "///", "a///"], ["a/b/c", "a/b/c/d/e", "abc"]],
    ["*/", ["a/", "/", "abc/"], ["a", "a/b", "a//"]],
    ["a*/b", ["a/b", "axy/b"], ["a/x/b", "b/b", "a"]],
    ["**/*/x", ["a/x", "a/b/x", "/x"], ["x", "a/b"]],
    ["**/*/**/*", ["a/b", "a/b/c/d"], ["a"]],
    ["*/é", ["a/é", "日本/é"], ["a/e"]],
  ])("a `*` before a `/`: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["*[a-z].ts", ["index.ts", "a.ts", "1a.ts"], [".ts", "A.ts", "a1.ts", "a/b.ts"]],
    ["*[0-9]*", ["component12.ts", "1", "a1"], ["componentxx.ts", "", "a/1"]],
    ["*[!a-z]*", ["component.ts", "A", "é"], ["component", ""]],
    ["*[é日]x", ["aéx", "日x", "é日x"], ["ax", "éy"]],
    ["*[/]b", ["a/b", "/b"], ["ab"]],
    ["*[!x]b", ["ab", "a/b", "xab"], ["xb", "b"]],
    ["*[a", ["x[a", "[a"], ["a", "xa"]],
    ["*[]]", ["x]", "]"], ["x"]],
    ["**/*[A-Z]*.ts", ["src/components/button/indexView.ts", "A.ts"], ["src/components/button/indexview.ts", "A/b.ts"]],
    ["*[ab]*[cd]", ["ac", "xaxd", "bbcc"], ["a", "ca", "a/c"]],
  ])("a `*` before a class: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["**/é*/*.ts", ["src/école/a.ts", "é/a.ts", "a/b/éc/d.ts"], ["src/ecole/a.ts", "src/aé/a.ts"]],
    ["**/日本", ["日本", "a/日本", "a/b/日本"], ["a/日", "a/日本語"]],
  ])("text that isn't ASCII after `**/`: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["{src/**,lib/**}", ["src/a", "lib/a/b.ts", "src/"], ["src", "test/a", "a/src/b"]],
    ["{**/*.ts,**/*.js}", ["a.ts", "src/a/b.js"], ["a.css", "src/a.tsx"]],
    ["{a/b,c}/d", ["a/b/d", "c/d"], ["a/d", "b/d", "a/b/c/d"]],
    ["x/{a/b,c}", ["x/a/b", "x/c"], ["x/a", "a/b", "x/a/b/c"]],
    ["x{a/b,c}d", ["xa/bd", "xcd"], ["xd", "xa/d"]],
    ["{a,b/**}", ["a", "b/", "b/c/d"], ["b", "a/c"]],
    ["{**,a}/b", ["b", "a/b", "x/y/b"], ["a", "x/y"]],
    ["{a/**,b}/c", ["a/c", "a/x/c", "b/c"], ["a", "b/x/c"]],
    ["{a/**/*,b}", ["a/x", "a/x/y", "b"], ["a", "c"]],
    ["{a/**,b}/*", ["a/x", "a/x/y", "b/x"], ["b", "b/x/y"]],
    ["{a/,b}**", ["a/x", "bx", "b", "a/"], ["c"]],
    ["{a/**,b**}", ["a/x/y", "bx", "b"], ["c", "a"]],
    ["a{**/b,c}", ["ac"], ["b"]],
    ["{a/*,b}/{c/d,e}", ["a/x/c/d", "b/e", "a/x/e"], ["a/c/d", "b/c"]],
    ["!{src/**,lib/**}", ["test/a", "src"], ["src/a", "lib/a/b"]],
    ["*/{a/b,c}", ["x/a/b", "x/c"], ["x/a", "a/b"]],
    ["**/{a/b,c}/d", ["a/b/d", "x/c/d", "x/y/a/b/d"], ["x/a/d"]],
  ])("a group with a `/` or a `**`: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["{a,bb}{c,dd}", ["ac", "add", "bbc", "bbdd"], ["a", "abb", "bc"]],
    ["{a,bb}{c,dd}{e,ff}", ["ace", "bbddff"], ["ac", "bbdde f"]],
    ["{a,bb}{c,dd}{e,ff}{g,hh}", ["aceg", "bbddffhh"], ["ace"]],
    ["{a,{b,c}}", ["a", "b", "c"], ["d", "ab", ""]],
    ["{a,{b,{c,d}}}x", ["ax", "bx", "cx", "dx"], ["x", "abx"]],
    ["{a,{b,cc}d}e", ["ae", "bde", "ccde"], ["be", "de"]],
    ["{a,{b}}c", ["ac", "bc"], ["c", "{b}c"]],
    ["{a,{1..3}}c", ["ac", "2c"], ["4c", "1..3c"]],
    ["{*.ts,*.js}", ["index.js", "a.ts", ".ts"], ["index.css", "a/b.ts"]],
    ["{foo,bar,bazz}.ts", ["foo.ts", "bazz.ts"], ["baz.ts", ".ts"]],
    ["a{,b}c", ["ac", "abc"], ["a", "abbc"]],
    ["{,a}*", ["", "a", "abc", "x"], ["a/b"]],
  ])("several groups, and groups in groups: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["[abc]", ["a", "b", "c"], ["d", "", "ab", "/", "é"]],
    ["[!abc]", ["d", "é", "/"], ["a", "", "de"]],
    ["[^abc]x", ["dx", "éx"], ["ax", "x"]],
    ["[a-z][0-9]", ["k7", "a0"], ["7k", "k", "k77", "K7"]],
    ["[a-c]*[x-z]", ["abcxyz", "ax", "bz"], ["a", "dx", "ab", "a/x"]],
    ["[[:alpha:]]*", ["a]", ":]x", "[]"], ["hello", "a", "]"]],
    ["[]a]b", ["]b", "ab"], ["b", "[]a]b"]],
    ["[a-]b", ["ab", "-b"], ["bb"]],
    ["[\\]]a", ["]a"], ["\\a", "a"]],
    ["[é]a", ["éa"], ["ea", "a"]],
    ["[a", ["[a"], ["a", ""]],
    ["a[", ["a["], ["a"]],
    ["[/]a", ["/a"], ["a", "//a"]],
    ["a[b/]c", ["abc", "a/c"], ["ac"]],
    ["[ab]{c,d}", ["ac", "bd"], ["cc", "a"]],
    ["[ab]{c,de}f", ["acf", "bdef"], ["af"]],
  ])("a pattern that starts with a class: %j", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["!!a", ["a"], ["b", "", "!a"]],
    ["!a", ["b", "", "ab"], ["a"]],
    ["!!!a", ["b"], ["a"]],
    ["!*.ts", ["a.js", "a/b.ts", ""], ["a.ts", ".ts"]],
    ["!**/*.ts", ["a.js", "a/b.js"], ["a.ts", "a/b.ts"]],
    ["!a/**", ["b/c", "a"], ["a/", "a/b"]],
    ["!", ["a"], [""]],
    ["!!", [""], ["a"]],
    ["![a]", ["b", ""], ["a"]],
    ["!?", ["", "ab"], ["a"]],
  ])("a pattern that starts with `!`: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["*", ["", "a", "abc", "é"], ["a/b", "/"]],
    ["a*", ["a", "abc"], ["b", "a/b", ""]],
    ["?*", ["a", "ab", "éb"], ["", "/a", "a/b"]],
    ["*?", ["a", "ab", "é", "aé"], ["", "a/", "/", "a/b"]],
    ["*??", ["ab", "abc", "éé"], ["a", "é", "a/b"]],
    ["*?.ts", ["index.ts", "a.ts", "é.ts"], [".ts", "a/.ts", "index.tsx"]],
    ["*.ts", ["a.ts", ".ts", "a.b.ts", "é.ts"], ["a.js", "ts", "a/b.ts", "a.ts/"]],
    ["*.[jt]s", ["a.ts", "a.js", ".js", "é.js"], ["a.cs", "a.tsx", "a/b.ts"]],
    ["*.[jt]sx", ["a.tsx"], ["a.ts", "a.csx"]],
    ["*[0-9].log", ["server12.log", "1.log"], ["server.log", ".log", "a/1.log"]],
    ["*[a-z]?", ["ab", "xa1", "aé"], ["a", "1", "A1"]],
    ["*[!a]", ["b", "ab", "é"], ["a", "", "ba"]],
    ["*(", ["(", "a("], ["a", ""]],
    ["*()", [""], ["a", "()"]],
    ["*)", [")", "a)"], ["a"]],
    ["*a|b", ["a|b", "xa|b"], ["a", "b"]],
    ["src/*.ts", ["src/a.ts", "src/.ts"], ["src/a/b.ts", "a.ts", "src/a.js"]],
    ["日本/*.ts", ["日本/a.ts", "日本/語.ts"], ["日/a.ts", "日本/a.js", "日本語/a.ts"]],
  ])("a `*` and then only single characters: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["**", ["", "a", "a/b", "/", ".a/.b"], []],
    ["a/**", ["a/", "a/b", "a/b/c"], ["a", "b/a", "ab/"]],
    ["a/**/**", ["a/", "a/b/c"], ["a"]],
    ["**/**", ["", "a", "a/b"], []],
    ["a/**/b", ["a/b", "a/x/b", "a/x/y/b", "a//b"], ["a/xb", "ab", "a/b/", "a/b/c", "b"]],
    ["**/b", ["b", "a/b", "/b"], ["ab", "b/", "b/a"]],
    ["**/a/b", ["a/b", "x/a/b"], ["xa/b", "a/b/c", "a/xb"]],
    ["**/?", ["a", "x/a", "x/é"], ["", "ab", "x/", "x/ab"]],
    ["**/[ab]/c", ["a/c", "x/b/c"], ["c/c", "xa/c"]],
    ["**/*.ts", ["a.ts", "a/b.ts", ".ts", "a/.ts", "ソース/ボタン.ts"], ["a.js", "a.ts/b", "ts"]],
    ["**/**/*.ts", ["a.ts", "a/b/c.ts"], ["a.js"]],
    [
      "src/**/*.test.ts",
      ["src/a.test.ts", "src/a/b/c.test.ts", "src/.test.ts"],
      ["lib/a.test.ts", "src/a.ts", "src.test.ts"],
    ],
    ["**/*?", ["a", "x/a", "x/é"], ["", "x/"]],
    ["**/*[ab]", ["a", "x/yb"], ["c", "x/", "a/c"]],
    ["**/*", ["a", "a/b", "a/b/c"], [""]],
    ["**/", ["", "a/", "a/b/"], ["a", "a/b"]],
    ["**/*.*", ["a.b", "a/b/c.d", "."], ["a", "a.b/c"]],
    ["a**", ["a", "ab"], ["a/b", "b"]],
    ["**a", ["a", "ba"], ["b/a", "b"]],
    ["***", ["", "a"], ["a/b"]],
    ["**(a)", ["", "a", "xa", "aa"], ["a/a"]],
  ])("`**` and what follows it: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["*語*", ["日本語テキスト", "語", "a語"], ["日本テキスト", "", "語/a"]],
    ["*é*", ["café noir", "é"], ["cafe noir", "a/é"]],
    ["*é", ["é", "aé", "éé"], ["éa", "e"]],
    ["a*日本/*", ["a日本/x", "axx日本/"], ["a日/x", "a/日本/x"]],
  ])("text that isn't ASCII after a `*`: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["**/a/*.ts", ["a/c.ts", "x/a/c.ts", "x/y/a/.ts"], ["a/x/c.ts", "c.ts", "x/a/c.js", "xa/c.ts"]],
    ["**/[ab]/?.ts", ["b/q.ts", "x/y/b/q.ts"], ["x/b/y/q.ts", "x/c/q.ts", "b/.ts"]],
    ["**/\\*.ts", ["*.ts", "a/*.ts"], ["a/b.ts", "a/*.js"]],
    ["**/a/", ["a/", "x/a/"], ["a", "x/a", "a/x/"]],
    ["**/{a,bc}.ts", ["a.ts", "x/y/bc.ts"], ["x/b.ts", "a.ts/x"]],
    ["**/{a),b/c}/d", ["x/a)/d", "x/b/c/d", "b/c/d"], ["x/b/d", "x/a/d"]],
    ["**/(a/b", ["(a/b", "x/(a/b"], ["x/a/b"]],
    ["**/a)/b", ["a)/b", "x/y/a)/b"], ["x/a/b"]],
    ["**/!{.,$)],/-/}ts/x", ["a/a/!$)]ts/x", "!.ts/x", "a/!/-/ts/x"], ["a/!ts/x"]],
    ["x/**/{,}{),/ }/*", ["x/ba/)/-", "x/)/a"], ["x/ba/-"]],
    ["**/x/!{é,}*", ["q/x/!a", "x/!é", "x/!"], ["q/x/a"]],
    ["**/[!a]/b", ["c/b", "x/c/b"], ["a/b", "x/a/b"]],
    ["a/**/b/**/c/*.ts", ["a/b/c/x.ts", "a/1/b/2/3/c/x.ts"], ["a/b/x.ts", "a/b/c/d/x.ts"]],
    [
      "**/node_modules/**",
      ["node_modules/a", "a/node_modules/b", "a/b/node_modules/", "/node_modules/a"],
      ["node_modules", "a/node_modules", "xnode_modules/a", "node_modules_x/a", "a/node_modulesx/b", "src/a.ts", ""],
    ],
    ["!**/node_modules/**", ["src/a.ts", "node_modules"], ["a/node_modules/b", "node_modules/a"]],
    ["**/a/b/**", ["a/b/c", "x/a/b/", "a/a/b/c"], ["a/b", "a/x/b/c", "x/a/bc/d"]],
    ["a/**/b", ["a/b", "a/x/b", "a/x/y/b", "a/b/b"], ["a/xb", "ab", "a/b/c", "b", "a/"]],
    ["a/**/b/c", ["a/b/c", "a/x/b/c", "a/b/b/c"], ["a/b/x/c", "a/xb/c", "a/b/c/d"]],
    ["a/**/b/**/c", ["a/b/c", "a/x/b/y/c", "a/b/b/c/c", "a/b/x/y/c"], ["a/c/b", "a/b", "a/xb/c", "a/b/xc"]],
    ["**/a/**/b/**", ["a/b/c", "x/a/y/b/z", "a/a/b/b/"], ["a/b", "b/a/c", "a/xb/c"]],
    ["**/{a,ab}/**", ["a/x", "ab/x", "x/ab/y", "x/a/"], ["abc/x", "a", "ab", "xa/y", "x/aab/y"]],
    [
      "**/{src,lib}/**/{test,spec}/**/*.{ts,js}",
      ["src/test/a.ts", "packages/a/src/x/test/y/z.ts", "lib/spec/x/a.js", "x/lib/src/spec/a.ts"],
      ["src/a.ts", "test/src/a.ts", "src/test/a.css", "src/tests/a.ts", "src/test/ts"],
    ],
    ["**/{a,b}/c/**", ["a/c/x", "x/b/c/", "a/b/c/d"], ["a/x/c/d", "c/a/x", "a/c"]],
    ["**/{1..3}/**", ["1/a", "x/2/a", "3/"], ["4/a", "1..3/a", "1"]],
    ["**/{a,}/**", ["a/x", "x//y", "x/a/", "/x"], ["x/y", "x"]],
    ["**/{a}/**", ["a/x", "x/a/y"], ["{a}/x", "b/x"]],
    ["**/x{a,b}/**", ["xa/c", "y/xb/c"], ["x/c", "xab/c", "a/c"]],
    ["x/**/{a,b}/**/*[!a]", ["x/a/b", "x/y/b/c/d", "x/a/b/"], ["x/a/a", "x/a/ba", "x/c/d"]],
  ])("what follows the last `**/` matches the last segments: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["*[!abc]", ["d", "xyzd", "abcd"], ["", "xyzb", "a"]],
    ["*[!a]", ["x/", "b", "ab", "é"], ["xa", "x/a", "a", "a/b/"]],
    ["*\\*", ["*", "ab*"], ["ab", "a*b"]],
    ["*\\[a\\]", ["[a]", "x[a]"], ["xa", "x[a"]],
    ["*?.ts", ["a.ts", "index.ts", "é.ts"], [".ts", "a.js", "a/.ts"]],
    ["*?", ["a", "ab", "é", "😀"], ["", "/", "a/", "a/b"]],
    ["?*", ["a", "ab", "é", "😀x"], ["", "/", "/a", "a/b"]],
    ["*??", ["ab", "abc", "éé"], ["", "a", "a/b"]],
    ["*?[ab]/x", ["ca/x", "xxcb/x"], ["a/x", "cc/x", "ca/y"]],
    ["*?[^/]_*1", ["_xa_aab1", "ab_1"], ["a_1", "ab_2"]],
    ["*[0-9].log", ["1.log", "server12.log"], ["server.log", "1.logs", "a/1.log"]],
    ["*?.ts", ["ab.ts", "a.ts", "index.ts", "é.ts"], [".ts", "a/b.ts"]],
    ["[a-c]*[x-z]", ["ax", "abcxyz", "az"], ["a", "a/z", "dx", "abc"]],
    ["a*[bc]?", ["abx", "axcx"], ["ab", "a/bx", "abxy"]],
    ["*\\*?", ["*a", "x*a"], ["*", "a*", "", "x*/"]],
    ["*[+-9]/x", ["a1/x", "a//x"], ["aa/x"]],
    ["*{a,}", ["", "a", "xx", "xxa"], ["x/a"]],
    ["*{,a}/y", ["/y", "xxa/y", "xx/y"], ["xxa", "x/x/y"]],
    ["*{a,bc}", ["a", "xbc", "xxa"], ["xb", "xc", "x/a"]],
    ["*{ab,c}*", ["ab", "xxabyy", "c", "xcy"], ["xxbyy", "a", "x/c"]],
    ["*{abcdef,cd}*f", ["abcdef", "cdf", "abcdeff"], ["abcde", "cd"]],
    ["*{abcdef,cd}*e", ["abcde", "cde"], ["abcdef", "cd"]],
    ["*?()*", ["", "a", "ab"], ["a/b"]],
    ["**o", ["o", "foo"], ["fo/o", "fa"]],
    ["**o*", ["o", "foo", "oy"], ["f/o", "fa"]],
  ])("where a `*` can stop: %s", (pattern, matches, others) => {
    const long = Buffer.alloc(100, "n").toString();
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
      if (pattern.startsWith("*")) expect(matches.filter(path => !glob.match(long + path))).toEqual([]);
    }
  });

  test.each([
    ["{a/b,c/d}/e", ["a/b/e", "c/d/e"], ["c/e", "a/d/e", "a/b/e/f"]],
    ["{a,a/b}/c", ["a/c", "a/b/c"], ["a/b", "b/c"]],
    ["{,/}{}", ["", "/"], ["a"]],
    ["src/{a,b/c}/*.ts", ["src/a/x.ts", "src/b/c/x.ts"], ["src/b/x.ts", "src/c/x.ts"]],
    ["{a?,b?}", ["ax", "bx"], ["a", "cx", "b/", "axx"]],
    ["{a?,b?}.ts", ["ax.ts", "bé.ts"], ["cx.ts", "a.ts"]],
    ["{[ab],c}x", ["ax", "bx", "cx"], ["dx", "x"]],
    ["{a,{b,c}}", ["a", "b", "c"], ["d", "", "ab"]],
    ["{a,b{c,d}}e", ["ae", "bce", "bde"], ["be", "bcde"]],
    ["{a,b{c,{d,e}}}", ["a", "bc", "bd", "be"], ["b", "bf"]],
    ["a{,b}c", ["ac", "abc"], ["adc", "a", "abbc"]],
    ["{a,b}{c,d}", ["ac", "bd", "ad"], ["a", "abcd", "cd"]],
    ["x{a,ab}b/{c,d}", ["xab/c", "xabb/d"], ["xb/c", "xab/e", "xabbb/c"]],
    ["{a/**/b,c}/d", ["a/b/d", "a/x/y/b/d", "c/d"], ["a/d", "a/b", "c/x/d", "a/x/b/d/d"]],
    ["{src/**,lib/**}", ["src/a", "lib/a/b.ts", "src/"], ["src", "lib", "test/a", "srcx/a"]],
    ["{**/*.ts,**/*.js}", ["a.ts", "x/y/a.js"], ["a.css", "x/a.tsx", "ts"]],
    ["x/{**/a,b}", ["x/a", "x/y/a", "x/b"], ["x/y/b", "xa", "x/"]],
    ["x{**/a,b}", ["xb", "x/a", "xy/a", "x/y/a", "xa"], ["ya", "x"]],
    ["{a/**,b}c", ["bc", "a/c", "a/xc"], ["a/x/c", "ac", "a/"]],
    ["{a*,b}*c", ["ac", "axc", "bc", "bxc"], ["a/c", "c"]],
    ["{a/**/*,b}", ["a/x", "a/x/y", "b", "a/"], ["a", "c"]],
    ["{a,b/**}/c", ["a/c", "b/c", "b/x/c", "b/x/y/c"], ["c", "a/x/c"]],
    ["!{a/**/b,c}", ["d", "a/x"], ["a/b", "c", "a/x/b"]],
    ["x{a,bc}*", ["xa", "xbcd", "xab"], ["xb", "ybc"]],
    ["{a,ab}*c", ["ac", "abc", "abxc"], ["ab", "bc"]],
    ["{a,ab}c", ["ac", "abc"], ["abbc", "c"]],
    ["{a,ab}bc", ["abc", "abbc"], ["ac", "abbbc"]],
    ["**/{a?,b?}/**", ["ax/c", "x/bx/c/d"], ["x/cx/d", "x/a/d"]],
    ["é{a,{b,c}}é", ["éaé", "écé"], ["édé", "éé"]],
    ["é{*.a,*.b}é", ["é.aé", "éx.bé"], ["éx.cé"]],
    ["日本/{a?,b?}.ts", ["日本/bx.ts"], ["日本/cx.ts", "日/bx.ts"]],
    ["é?é", ["éqé", "ééé"], ["é/é", "éé"]],
    ["{a,bc}\\n", ["a\n", "bc\n"], ["an", "a", "b\n"]],
    ["*{a,bc}\\n", ["a\n", "xbc\n"], ["xan", "xb\n"]],
    ["*{a,bc}\\.x", ["a.x", "xbc.x"], ["ax", "xb.x"]],
  ])("groups that the loop takes by itself: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["é{,a}é", ["éé", "éaé"], ["ébé", "é", "éaaé", "eae"]],
    ["日本/*.ts", ["日本/a.ts", "日本/語.ts", "日本/.ts"], ["日/a.ts", "日本/a.js", "日本語/a.ts"]],
    ["*語*", ["語", "日本語テキスト", "a語b"], ["日本テキスト", "", "語/a"]],
    ["?", ["a", "é", "語", "😀", "\u0900", "\ud7a3", "\u{10000}", "\u{10ffff}", "\ufffd"], ["", "éé", "a😀", "/"]],
    ["??", ["aé", "éa", "語😀", "😀😀"], ["é", "😀", "aéa"]],
    ["a?b", ["aéb", "a語b", "a😀b"], ["ab", "aééb", "a/b"]],
    ["[!a]", ["é", "😀", "b"], ["a", "éé"]],
    ["[a-c]*", ["aé", "b語語"], ["é", "éa"]],
    ["*.ts", ["ソース.ts", "é.ts"], ["ソース.js", "ソ/ース.ts"]],
    ["**/*.ts", ["ソース/コンポーネント/ボタン.ts", "é/a.ts"], ["ソース/ボタン.js"]],
    ["**/é/**", ["é/a", "a/é/b", "語/é/😀"], ["e/a", "éé/a", "a/é"]],
    ["{é,語}*{a,😀}", ["éa", "語x😀", "é😀"], ["a😀", "éx"]],
    ["+(é|a)", ["é", "éaé"], ["", "éb", "語"]],
    ["!(é)", ["a", "éé", "語"], ["é"]],
    ["[é語]x", ["éx", "語x"], ["ax", "😀x"]],
    ["\\éx", ["éx"], ["ex", "語x"]],
  ])("characters of several bytes, however often it's asked: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 40; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each(["a?b", "a*b", "a[!x]b", "*?b", "a{?,xy}b", "a語b", "a+(?)b"])(
    "%s gives the same answers for every character once it has been asked often",
    pattern => {
      const glob = new Glob(pattern);
      for (let round = 0; round < 40; round++) glob.match("axb");
      const differs = [];
      // The first and the last character of each range of first and second bytes in UTF-8, and some in between.
      const edges = [0x80, 0x800, 0x1000, 0xd000, 0xd800, 0xe000, 0x10000, 0x40000, 0x100000, 0x110000];
      const codes = edges.flatMap(edge => [edge - 1, edge]).slice(0, -1);
      for (let code = 0xa1; code < 0x110000; code += code < 0x3000 ? 61 : 7919) codes.push(code);
      for (const code of codes) {
        if (code >= 0xd800 && code <= 0xdfff) continue;
        const character = String.fromCodePoint(code);
        for (const path of ["a" + character + "b", "a" + character + character + "b", "a" + character]) {
          if (glob.match(path) !== new Glob(pattern).match(path)) differs.push(path);
        }
      }
      expect(differs).toEqual([]);
    },
  );

  test.each([
    ["**/*[!a]*{a,b}", ["/abc/aa", "x//abc/aa", "b/x//abc/aa"], ["/abc/ac", "c/cc"]],
    ["**/*[^b]*@(a|b)", ["abc/b", "x/abc/b"], ["abc/c", "b"]],
    ["*[^b]*{a,b}/x", ["abc/ab/x", "ca/x"], ["cc/x", "abc/cc/x"]],
    ["a/**/*[^/]*[!a]*{a,b}", ["a/bcaa", "a/x/bc/a"], ["a/aa", "b/bcaa"]],
    ["**/*[!a]*[^/]/**/*{,b}/*", ["b/./.a/é", "2/x//y/z", "a}/n/../"], ["a/a", "aa"]],
    ["**/*[^b]**a*/**/{a,b}*/*", ["1/a/aa/aa", "1/a/aa/aa/x"], ["1/c/cc/cc"]],
    ["**/*[!a]*[+-9]/**/*/{*a,b}/b", ["a,b/2/ba//a/b", "x/2/ba//a/b"], ["x/2/c/c/c"]],
    ["**/*[!a]*[!a]/**/*/{,b}/*/*", ["ab/ab/x//x/+", "ab/ab/x//x/y"], ["aa/aa"]],
  ])("a group after a `*` and a class that can match a separator: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 12; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["\\{a,b\\}", ["{a,b}"], ["a", "b", "{a,b", "{a,b}x", ""]],
    ["\\*.ts", ["*.ts"], ["a.ts", ".ts", "*.tsx", "x*.ts"]],
    ["a\\[b\\].ts", ["a[b].ts"], ["ab.ts", "a[b]xts", "a[b].t"]],
    ["é\\*é", ["é*é"], ["éxé", "é*", "*é"]],
    ["a\\tb", ["a\tb"], ["atb", "a\\tb"]],
    ["!\\*a", ["b", "*b"], ["*a"]],
    ["a+b@c", ["a+b@c"], ["aab@c", "a+b@"]],
    ["a\\/b", ["a/b"], ["a\\/b", "ab"]],
    ["[!abc]", ["d", "/", "é"], ["a", "b", "dd", ""]],
    ["[^a]b", ["cb", "/b"], ["ab", "b"]],
    ["a[!b]c", ["axc", "a/c"], ["abc", "ac"]],
    ["?[!a]?", ["xbx", "x/x"], ["xax", "x/", "/b/"]],
    ["[/]a", ["/a"], ["aa", "a"]],
  ])("a pattern with only one way to match, however often it's asked: %s", (pattern, matches, others) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 40; round++) {
      expect(matches.filter(path => !glob.match(path) || !new Glob(pattern).match(path))).toEqual([]);
      expect(others.filter(path => glob.match(path) || new Glob(pattern).match(path))).toEqual([]);
    }
  });

  test.each([
    ["*[éa]", "é", "ü"],
    ["*\\é", "é", "ü"],
    ["*[語a]", "語", "誰"],
  ])("%s tells characters apart after a long path", (pattern, matching, other) => {
    const glob = new Glob(pattern);
    for (let round = 0; round < 40; round++) glob.match("x");
    const long = Buffer.alloc(600, "x").toString();
    expect([long + matching, long + other, "x" + matching, "x" + other].map(path => glob.match(path))).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  test("a group can be anywhere in a long pattern", () => {
    for (let before = 50; before <= 270; before++) {
      const any = Buffer.alloc(before, "?").toString();
      const text = Buffer.alloc(before, "a").toString();
      expect([
        before,
        new Glob(any + "+(+(a))+(b)").match(text + "abb"),
        new Glob(any + "+(+(a))+(b)").match(text + "a"),
        new Glob(any + "*(a|b)!(a|b)c").match(text + "abxc"),
        new Glob(any + "*(a|b)!(a|b)c").match(text + "abx"),
        new Glob(any + "{x*,[yz]}@(1|{2..4})").match(text + "xx3"),
        new Glob(any + "{x*,[yz]}@(1|{2..4})").match(text + "z5"),
      ]).toEqual([before, true, false, true, false, true, false]);
    }
  });

  test.each([
    ["+(a|b)", "ab", "", true],
    ["+(a|b)", "ab", "c", false],
    ["*(a|b)", "ab", "", true],
    ["*(a|ab)", "ab", "", true],
    ["*(a/)", "a/", "", true],
    ["+(a*)", "ab", "", true],
    ["+(a*)c", "ab", "", false],
    ["*(*a)", "ba", "", true],
    ["@(+(a|b)|c)", "ab", "", true],
    ["*!(a|b)*!(a|b)", "1", "", true],
    ["*!(a|b)*!(a|b)x", "1", "", false],
    ["*{1..9}*{1..9}", "1", "", true],
    ["*{1..9}*{1..9}x", "1", "", false],
    ["*{1..9}*{1..9}", "a", "", false],
    ["+(?)*{1..9}x", "1", "", false],
    ["*!(.d).ts", "a", ".ts", true],
    ["*!(.d).ts", "a", ".js", false],
    ["!(*.d).ts", "a", ".ts", true],
    ["!(*.d).ts", "a", ".d.ts", false],
    ["**/{a,b}/**/{a,b}/x", "a/b/", "x", true],
    ["**/{a,b}/**/{a,b}/x", "a/b/", "y", false],
    ["*{a,b}*{a,b}c", "ab", "c", true],
    ["*{a,b}*{a,b}c", "ab", "", false],
    ["*{*a,*b}x", "ab", "", false],
    ["{*a,*b}*x", "ab", "", false],
    ["{src,lib}/**/{test,spec}/**/*.{ts,js}", "src/test/", "x.ts", true],
    ["{src,lib}/**/{test,spec}/**/*.{ts,js}", "src/test/", "x.css", false],
  ])("%s with 100 KB of %j and then %j is %p", (pattern, repeated, end, expected) => {
    const length = 100_000 - (100_000 % repeated.length);
    expect(new Glob(pattern).match(Buffer.alloc(length, repeated).toString() + end)).toBe(expected);
  });

  test("10,000 groups in a row", () => {
    const glob = new Glob(Buffer.alloc(50_000, "{a,b}").toString());
    expect(glob.match(Buffer.alloc(10_000, "ab").toString())).toBeTrue();
    expect(glob.match(Buffer.alloc(10_001, "ab").toString())).toBeFalse();
    expect(glob.match(Buffer.alloc(9_999, "ab").toString())).toBeFalse();
    expect(glob.match(Buffer.alloc(9_999, "ab").toString() + "c")).toBeFalse();
  });

  // A `Glob` that is asked often, or about a long path, changes how it matches.
  describe.each([
    ["**/*.ts", /^(.*\/)?[^/]*\.ts$/],
    ["*.{ts,tsx,js}", /^[^/]*\.(ts|tsx|js)$/],
    ["{a,b,c}/**/*.{js,ts,tsx}", /^[abc]\/(.*\/)?[^/]*\.(js|ts|tsx)$/],
    ["{src,a}/**", /^(src|a)\//],
    ["**/*{f,.d}*.ts", /^(.*\/)?[^/]*(f|\.d)[^/]*\.ts$/],
    ["**/!(*.d).ts", /^(.*\/)?(?![^/]*\.d\.ts$)[^/]*\.ts$/],
    ["**/+([a-z]).@(ts|js)", /^(.*\/)?[a-z]+\.(ts|js)$/],
    ["**/?.{ts,css}", /^(.*\/)?[^/]\.(ts|css)$/],
    ["**/__tests__/**/*.[jt]s?(x)", /^(.*\/)?__tests__\/(.*\/)?[^/]*\.[jt]sx?$/],
    ["?(a|src)/**/*.ts?(x)", /^(a|src)?\/(.*\/)?[^/]*\.tsx?$/],
    ["?/**/f.?s", /^[^/]\/(.*\/)?f\.[^/]s$/],
    ["**/[!/]*.ts", /^(.*\/)?[^/]+\.ts$/],
    ["!**/*.ts", /^(?!(.*\/)?[^/]*\.ts$)/],
  ])("%s", (pattern, expected) => {
    const deep = Buffer.alloc(600, "x/").toString();
    const folders = [
      "",
      "a/",
      "b/",
      "c/x/",
      "d/",
      "src/",
      "src/a/b/",
      "a/é/",
      ".a/",
      "a/__tests__/",
      "a/" + deep,
      deep,
    ];
    const names = ["f.js", "f.ts", "f.tsx", "f.d.ts", "f.css", "ts", ".ts", "ü.ts"];
    const paths = folders.flatMap(folder => names.map(name => folder + name));

    test.each([
      ["short paths first", paths],
      ["long paths first", [...paths].reverse()],
    ])("gives the same answers however often it's asked, %s", (_, paths) => {
      const glob = new Glob(pattern);
      const matches = paths.filter(path => expected.test(path));
      expect(matches.length).toBeWithin(1, paths.length);
      for (let round = 0; round < 3; round++) {
        expect(paths.filter(path => glob.match(path))).toEqual(matches);
      }
    });
  });
});

describe("a Glob outlives the string that it was made from", () => {
  const files = { "a.ts": "", "ab.ts": "", "a.js": "", "café.txt": "", "a日本b.txt": "" };
  const ext = ["t", "s"].join("");
  const long = Buffer.alloc(1000, "x").toString() + "a?*.ts" + Buffer.alloc(1000, "y").toString();

  function collect() {
    Bun.gc(true);
    const garbage: string[] = [];
    for (let i = 0; i < 2000; i++) garbage.push(Buffer.alloc(16 + (i % 64), String(i)).toString());
    Bun.gc(true);
    return garbage.length;
  }

  test.each([
    ["a rope", () => new Glob("*" + "." + ext), ["a.ts", "ab.ts"]],
    ["a substring of a long string", () => new Glob((long + ext).slice(1000, 1006)), ["ab.ts"]],
    ["Latin-1 text that isn't ASCII", () => new Glob(["*", String.fromCharCode(0xe9), "*"].join("")), ["café.txt"]],
    ["UTF-16 text", () => new Glob(["*", String.fromCharCode(0x65e5, 0x672c), "*"].join("")), ["a日本b.txt"]],
    ["an empty string", () => new Glob(ext.slice(2)), []],
  ])("%s", (_, make, expected) => {
    using dir = tempDir("glob-pattern-lifetime", files);
    const glob = make();
    for (let round = 0; round < 2; round++) {
      expect(collect()).toBe(2000);
      expect(Object.keys(files).filter(name => glob.match(name))).toEqual(expected);
      expect([...glob.scanSync({ cwd: String(dir) })].sort()).toEqual(expected);
    }
    expect(glob.match("")).toBe(expected.length === 0);
  });

  test("two Globs made from one string", () => {
    const make = () => {
      const text = ["*", ext].join(".");
      return [new Glob(text), new Glob(text)];
    };
    const globs = make();
    expect(collect()).toBe(2000);
    expect(globs.map(glob => Object.keys(files).filter(name => glob.match(name)))).toEqual([
      ["a.ts", "ab.ts"],
      ["a.ts", "ab.ts"],
    ]);
    globs.pop();
    expect(collect()).toBe(2000);
    expect(globs[0].match("a.ts")).toBeTrue();
    expect(globs[0].match("a.js")).toBeFalse();
  });
});

// `Glob#match` treats a segment that starts with `.` like any other. `bun lint` uses the same matcher with minimatch's rules for
// the patterns in rule options: `import/order` reports the import in each of these files if the pattern matches its path.
async function matchedLikeMinimatch(pattern: string, dot: boolean, paths: string[]) {
  const group = `{ pattern = ${JSON.stringify(pattern)}, group = "builtin", position = "before", patternOptions = { dot = ${dot} } }`;
  const code = (path: string) =>
    `import fs from "fs";\nimport a from ${JSON.stringify(path)};\nexport default [fs, a];\n`;
  using dir = tempDir("glob-dot-segments", {
    "bunfig.toml": `[lint.rules]\n"import/order" = ["error", { pathGroups = [${group}], pathGroupsExcludedImportTypes = [] }]\n`,
    ...Object.fromEntries(paths.map((path, index) => [`${index}.js`, code(path)])),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "lint", "-f", "json", "."],
    env: { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (!stdout.startsWith("[")) throw new Error(`exit code ${exitCode}\n${stdout}\n${stderr}`);
  const results: { filePath: string; messages: { ruleId: string }[] }[] = JSON.parse(stdout);
  const reported = results.filter(it => it.messages.some(message => message.ruleId === "import/order"));
  const indexes = reported.map(it => parseInt(basename(it.filePath)));
  return paths.filter((_, index) => indexes.includes(index));
}

// The expected paths are what minimatch 10.2.6 matches.
test.concurrent.each([
  ["**/.", true, ["a/b/.", "a/.b//.", "/.//."], ["a/b/.", "a/.b//."]],
  ["**/.", false, ["a/b/.", "a/.b//.", "/.//."], ["a/b/."]],
  ["**/.ts", true, ["a/b/.ts", "a/.b/.ts", "a/./b/.ts", "a/../b/.ts"], ["a/b/.ts", "a/.b/.ts"]],
  ["**/.ts", false, ["a/b/.ts", "a/.b/.ts", "a/./b/.ts", "a/../b/.ts"], ["a/b/.ts"]],
  ["{**,a}/", true, ["a/", "b/", "/../"], ["a/", "b/"]],
  ["{**,a}/", false, ["a/", "b/", "/../"], ["a/", "b/"]],
  ["**/!(x).ts", true, ["a/b/c.ts", "a/b/.ts", "a/.b/c.ts", "a/../c.ts"], ["a/b/c.ts", "a/b/.ts", "a/.b/c.ts"]],
  ["**/!(x).ts", false, ["a/b/c.ts", "a/b/.ts", "a/.b/c.ts", "a/../c.ts"], ["a/b/c.ts"]],
])("dot segments: %s with dot = %p", async (pattern, dot, paths, expected) => {
  expect(await matchedLikeMinimatch(pattern, dot, paths)).toEqual(expected);
});

function returnError(cb: () => any): Error | undefined {
  try {
    cb();
  } catch (err) {
    // @ts-expect-error
    return err;
  }
  return undefined;
}
