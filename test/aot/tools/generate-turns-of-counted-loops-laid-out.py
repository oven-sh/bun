#!/usr/bin/env python3
"""generate-turns-of-counted-loops-laid-out.py <folder>: all 203; ../parallel/turns-of-counted-loops-laid-out/ holds 3 of them: ONE SHAPE OF COUNTED LOOP A PROGRAM, each run at every length from 0 past two groups of turns, so that every remainder is met. Printed: one line a length."""
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
LENGTHS = "[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 24, 25, 31, 32, 33, 63, 64, 65, 100, 1000]"
made = []
def program(name, text):
    made.append(name)
    open(os.path.join(out, name + ".ts"), "w").write(text.strip() + "\n")

def over(name, function, make, call="run(input)", more=""):
    program(name, f"""
{function}
{more}
const lengths = {LENGTHS};
function once(length: number): void {{
  {make}
  console.log(length, {call});
}}
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
""")

# ---- views: reads
VIEWS = ["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array"]
for v in VIEWS:
    fill = "input[i] = (i * 37 + 11) % 251 - 100;" if not v.startswith("Float") else "input[i] = ((i * 37 + 11) % 251 - 100) / 8;"
    make = f"const input = new {v}(length); for (let i = 0; i < length; i++) {fill}"
    over(f"sum-of-{v}", f"function run(view: {v}): number {{ let t = 0; for (let i = 0; i < view.length; i++) t += view[i]; return t; }}", make)
    over(f"largest-of-{v}", f"function run(view: {v}): number {{ let m = -1e9; for (let i = 0; i < view.length; i++) {{ if (view[i] > m) m = view[i]; }} return m; }}", make)
    over(f"xor-of-{v}", f"function run(view: {v}): number {{ let t = 0; for (let i = 0; i < view.length; i++) t ^= view[i]; return t; }}", make)
    over(f"fill-of-{v}", f"function run(view: {v}): number {{ for (let i = 0; i < view.length; i++) view[i] = i * 3 - 7; let t = 0; for (let i = 0; i < view.length; i++) t = (t * 31 + view[i]) % 1000003; return t; }}", f"const input = new {v}(length);")
    over(f"each-of-{v}-takes-the-one-in-front", f"function run(view: {v}): string {{ for (let i = 1; i < view.length; i++) view[i] = view[i] + view[i - 1]; return view.join(); }}", make.replace("- 100", "- 120").replace("% 251", "% 7"), call="run(input).length + ':' + run(input).slice(-40)")
    over(f"each-of-{v}-takes-the-one-behind", f"function run(view: {v}): string {{ const last = view.length - 1; for (let i = 0; i < last; i++) view[i] = view[i + 1]; return view.join(); }}", make, call="run(input).slice(-60)")
    over(f"sum-of-two-{v}-into-a-third", f"function run(a: {v}, b: {v}, c: {v}): string {{ for (let i = 0; i < a.length; i++) c[i] = a[i] + b[i]; return c.join(); }}", make + f" const other = new {v}(length); for (let i = 0; i < length; i++) other[i] = i % 5; const third = new {v}(length);", call="run(input, other, third).slice(-60)")

# ---- views that share their bytes
over("bytes-written-are-read-as-words-in-the-next-turn", "function run(bytes: Uint8Array, words: Uint16Array): number { let t = 0; for (let i = 0; i < bytes.length; i++) { bytes[i] = i + 1; t += words[i >> 1]; } return t; }",
     "const buffer = new ArrayBuffer((length + 1) & ~1); const input = new Uint8Array(buffer, 0, length); const words = new Uint16Array(buffer);", call="run(input, words)")
over("words-written-are-read-as-bytes-in-the-same-turn", "function run(words: Uint32Array, bytes: Uint8Array): number { let t = 0; for (let i = 0; i < words.length; i++) { words[i] = 0x01020304 + i; t += bytes[i * 4] + bytes[i * 4 + 3] * 3; } return t; }",
     "const buffer = new ArrayBuffer(length * 4); const input = new Uint32Array(buffer); const bytes = new Uint8Array(buffer);", call="run(input, bytes)")
over("one-view-handed-over-twice", "function run(a: Uint8Array, b: Uint8Array): number { let t = 0; for (let i = 1; i < a.length; i++) { a[i] = b[i - 1] + 1; t += b[i]; } return t; }",
     "const input = new Uint8Array(length); if (length) input[0] = 5;", call="run(input, input)")
over("views-that-overlap-by-one", "function run(a: Uint8Array, b: Uint8Array): number { let t = 0; for (let i = 0; i < a.length; i++) { a[i] = t + 1; t += b[i]; } return t; }",
     "const whole = new Uint8Array(length + 1); whole[0] = 3; const input = whole.subarray(1); const b = whole.subarray(0, length);", call="run(input, b)")
over("part-of-a-view", "function run(view: Uint8Array): number { let t = 0; for (let i = 0; i < view.length; i++) t += view[i]; return t; }",
     "const whole = new Uint8Array(length + 9); for (let i = 0; i < whole.length; i++) whole[i] = i * 7 + 1; const input = whole.subarray(5, 5 + length);")

# ---- texts
TEXTS = {
    "bytes": "let input = ''; for (let i = 0; i < length; i++) input += i % 7 ? 'a' : ' ';",
    "latin-1": "let input = ''; for (let i = 0; i < length; i++) input += i % 3 ? '\\u00e9' : ' ';",
    "wide": "let input = ''; for (let i = 0; i < length; i++) input += i % 5 ? '\\u03a9' : ' ';",
    "wide-at-the-end-alone": "let input = ''; for (let i = 0; i < length; i++) input += i === length - 1 ? '\\u4e16' : i % 4 ? 'x' : ' ';",
    "a-slice": "let whole = '###'; for (let i = 0; i < length; i++) whole += i % 6 ? 'b' : ' '; whole += '###'; const input = whole.slice(3, 3 + length);",
    "a-wide-slice": "let whole = '\\u03a9##'; for (let i = 0; i < length; i++) whole += i % 6 ? 'b' : ' '; whole += '###'; const input = whole.slice(3, 3 + length);",
    "two-halves-joined": "let left = ''; let right = ''; for (let i = 0; i < length; i++) { if (i < length >> 1) left += i % 3 ? 'l' : ' '; else right += i % 4 ? 'r' : ' '; } const input = left + right;",
}
for t, make in TEXTS.items():
    over(f"spaces-counted-in-{t}", "function run(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) === 32) n++; } return n; }", make)
    over(f"code-units-summed-in-{t}", "function run(s: string): number { let t = 0; for (let i = 0; i < s.length; i++) t += s.charCodeAt(i); return t; }", make)
    over(f"hash-of-{t}", "function run(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }", make)
    over(f"code-units-below-a-bound-in-{t}", "function run(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) < 98) n += 2; else n -= 1; } return n; }", make)
over("one-function-reads-bytes-and-wide-texts-in-turn", "function run(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) === 32) n++; } return n; }",
     "let input = ''; let wide = ''; for (let i = 0; i < length; i++) { input += i % 7 ? 'a' : ' '; wide += i % 3 ? '\\u03a9' : ' '; }", call="run(input), run(wide), run(input + wide), run(wide + input)")
over("two-texts-compared-by-code-unit", "function run(a: string, b: string): number { let n = 0; for (let i = 0; i < a.length; i++) { if (a.charCodeAt(i) === b.charCodeAt(i)) n++; } return n; }",
     "let input = ''; let other = ''; for (let i = 0; i < length; i++) { input += i % 7 ? 'a' : 'b'; other += i % 3 ? 'a' : '\\u03a9'; }", call="run(input, other), run(other, input), run(input, input)")

# ---- lists
LISTS = {
    "small-integers": "const input: number[] = []; for (let i = 0; i < length; i++) input.push(i & 255);",
    "fractions": "const input: number[] = []; for (let i = 0; i < length; i++) input.push(i / 4 + 0.125);",
    "integers-and-then-a-fraction": "const input: number[] = []; for (let i = 0; i < length; i++) input.push(i === length - 1 ? 0.5 : i);",
    "a-hole": "const input: number[] = []; for (let i = 0; i < length; i++) input.push(i); if (length > 2) delete input[length - 2];",
    "a-hole-among-fractions": "const input: number[] = []; for (let i = 0; i < length; i++) input.push(i + 0.5); if (length > 9) delete input[9];",
    "NaN": "const input: number[] = []; for (let i = 0; i < length; i++) input.push(i === 11 ? NaN : i);",
    "minus-zero": "const input: number[] = []; for (let i = 0; i < length; i++) input.push(-0);",
    "large-integers": "const input: number[] = []; for (let i = 0; i < length; i++) input.push(2147483647 - i);",
    "beyond-int32": "const input: number[] = []; for (let i = 0; i < length; i++) input.push(4294967296 * (i + 1));",
    "near-2-to-the-53": "const input: number[] = []; for (let i = 0; i < length; i++) input.push(i ? 1 : 9007199254740990);",
}
for l, make in LISTS.items():
    over(f"sum-of-list-of-{l}", "function run(list: number[]): number { let t = 0; for (let i = 0; i < list.length; i++) t += list[i]; return t; }", make, call="Object.is(run(input), -0) ? '-0' : run(input)")
    over(f"product-of-signs-of-list-of-{l}", "function run(list: number[]): number { let t = 1; for (let i = 0; i < list.length; i++) { if (list[i] < 3) t = -t; } return t; }", make)
    over(f"list-of-{l}-doubled-in-place", "function run(list: number[]): string { for (let i = 0; i < list.length; i++) list[i] = list[i] * 2; return list.join(); }", make, call="run(input).slice(-70)")
over("sum-that-starts-at-minus-zero", "function run(list: number[]): number { let t = -0; for (let i = 0; i < list.length; i++) t += list[i]; return t; }", LISTS["minus-zero"], call="Object.is(run(input), -0) ? '-0' : run(input)")
over("list-written-past-its-end", "function run(from: number[], to: number[]): string { for (let i = 0; i < from.length; i++) to[i] = from[i] + 1; return to.length + ':' + to.join(); }", LISTS["small-integers"] + " const to: number[] = [];", call="run(input, to).slice(-60)")
over("each-of-a-list-takes-the-one-in-front", "function run(list: number[]): string { for (let i = 1; i < list.length; i++) list[i] = list[i] + list[i - 1]; return list.join(); }", LISTS["small-integers"], call="run(input).slice(-60)")
over("a-list-of-integers-is-given-a-fraction-half-way", "function run(list: number[]): number { let t = 0; for (let i = 0; i < list.length; i++) { list[i] = i === 5 ? 0.25 : list[i]; t += list[i]; } return t; }", LISTS["small-integers"])
over("one-list-handed-over-twice", "function run(a: number[], b: number[]): number { let t = 0; for (let i = 1; i < a.length; i++) { a[i] = b[i - 1] + 1; t += b[i]; } return t; }", LISTS["small-integers"], call="run(input, input)")

# ---- counters and bounds
def counted(name, function, calls):
    program(name, function + "\n" + "\n".join(f"console.log({c});" for c in calls))
NS = [-3, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 17, 24, 25, 100, 1001]
counted("counter-summed", "function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += i; return t; }", [f"run({n})" for n in NS])
counted("counter-hashed", "function run(n: number): number { let t = 7; for (let i = 0; i < n; i++) t = (t * 31 + i) | 0; return t; }", [f"run({n})" for n in NS])
counted("counter-read-behind-the-loop", "function run(n: number): number { let t = 0; let i = 0; for (; i < n; i++) t += 2; return i * 100000 + t; }", [f"run({n})" for n in NS])
counted("counter-starts-above-zero", "function run(from: number, n: number): number { let t = 0; for (let i = from; i < n; i++) t += i * i; return t; }", [f"run({a}, {n})" for a in (1, 3, 7, 8, 9) for n in NS])
counted("counter-starts-below-zero", "function run(from: number, n: number): number { let t = 0; for (let i = from; i < n; i++) t += i; return t; }", [f"run({a}, {n})" for a in (-1, -7, -8, -9, -20) for n in NS])
counted("bound-at-the-largest-int32", "function run(from: number, n: number): number { let t = 0; for (let i = from | 0; i < (n | 0); i++) t += i % 10; return t; }", [f"run({2147483647 - d}, 2147483647)" for d in range(0, 20)] + [f"run({2147483640 - d}, 2147483646)" for d in range(0, 12)])
counted("bound-at-the-least-int32", "function run(from: number, n: number): number { let t = 0; for (let i = from | 0; i < (n | 0); i++) t += 1; return t; }", [f"run(-2147483648, {-2147483648 + d})" for d in range(0, 20)])
counted("bound-beyond-int32", "function run(from: number, n: number): number { let t = 0; for (let i = from; i < n; i++) t += i % 7; return t; }", [f"run({4294967296 - d}, 4294967300)" for d in range(0, 20)])
counted("bound-is-a-fraction", "function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += i; return t; }", [f"run({n}.5)" for n in range(0, 20)] + ["run(NaN)", "run(Infinity > 1 ? 12.25 : 0)"])
for c in (0, 1, 6, 7, 8, 9, 15, 16, 17, 40):
    counted(f"bound-written-as-{c}", f"function run(view: Uint8Array): number {{ let t = 0; for (let i = 0; i < {c}; i++) t += view[i]; return t; }}\nconst view = new Uint8Array(64); for (let i = 0; i < 64; i++) view[i] = i * 5 + 1;", ["run(view)"])
counted("two-values-change-places", "function run(n: number): string { let a = 0; let b = 1; for (let i = 0; i < n; i++) { const next = (a + b) % 1000003; a = b; b = next; } return a + ',' + b; }", [f"run({n})" for n in NS])
counted("three-values-go-round", "function run(n: number): string { let a = 1; let b = 2; let c = 3; for (let i = 0; i < n; i++) { const first = a; a = b; b = c; c = first + i; } return a + ',' + b + ',' + c; }", [f"run({n})" for n in NS])
counted("a-value-goes-round-as-it-is", "function run(n: number, k: number): number { let t = 0; let same = k; for (let i = 0; i < n; i++) { t += same; same = same; } return t + same; }", [f"run({n}, 3)" for n in NS])
counted("fractions-are-added-in-the-order-written", "function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += 0.1; return t; }", [f"run({n})" for n in NS])
counted("fractions-and-the-counter", "function run(n: number): number { let t = 0.3; for (let i = 0; i < n; i++) t = t * 0.5 + i; return t; }", [f"run({n})" for n in NS])
counted("several-sums", "function run(n: number): string { let a = 0; let b = 0; let c = 1; let d = 0.5; for (let i = 0; i < n; i++) { a += i; b ^= i * 3; c = (c * 7) % 1009; d += 0.25; } return [a, b, c, d].join(); }", [f"run({n})" for n in NS])
counted("two-arms", "function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) { if (i & 1) t += i; else t -= 2; } return t; }", [f"run({n})" for n in NS])
counted("an-arm-within-an-arm", "function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) { if (i & 1) { if (i & 2) t += i; else t += 100; } } return t; }", [f"run({n})" for n in NS])
counted("one-of-two-values", "function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += i % 3 === 0 ? i : 1; return t; }", [f"run({n})" for n in NS])
counted("steps-of-two", "function run(n: number): number { let t = 0; for (let i = 0; i < n; i += 2) t += i; return t; }", [f"run({n})" for n in NS])
counted("counts-down", "function run(n: number): number { let t = 0; for (let i = n; i > 0; i--) t += i; return t; }", [f"run({n})" for n in NS])
counted("up-to-and-with-the-bound", "function run(n: number): number { let t = 0; for (let i = 0; i <= n; i++) t += i; return t; }", [f"run({n})" for n in NS])
counted("left-early", "function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) { if (i === 11) break; t += i; } return t; }", [f"run({n})" for n in NS])
counted("a-turn-cut-short", "function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) { if (i % 5 === 2) continue; t += i; } return t; }", [f"run({n})" for n in NS])
counted("returns-out-of-a-turn", "function run(view: Uint8Array, wanted: number): number { for (let i = 0; i < view.length; i++) { if (view[i] === wanted) return i; } return -1; }\nconst view = new Uint8Array(40); for (let i = 0; i < 40; i++) view[i] = i * 3;", [f"run(view, {w})" for w in (0, 3, 21, 24, 27, 60, 117, 118)])
counted("counter-stepped-in-the-turn-too", "function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) { if (i % 4 === 1) i++; t += i; } return t; }", [f"run({n})" for n in NS])
counted("bound-changed-in-the-turn", "function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) { if (i === 3) n -= 2; t += i; } return t; }", [f"run({n})" for n in NS])
counted("a-loop-within-a-loop", "function run(rows: number, columns: number, cells: Float64Array): number { let t = 0; for (let r = 0; r < rows; r++) { for (let c = 0; c < columns; c++) t += cells[r * columns + c] * (r + 1); } return t; }\nconst cells = new Float64Array(400); for (let i = 0; i < 400; i++) cells[i] = i % 13;", [f"run({r}, {c}, cells)" for r in (0, 1, 3, 8) for c in (0, 1, 7, 8, 9, 16, 17, 40)])
counted("the-bound-of-the-inner-loop-is-the-outer-counter", "function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < i; j++) t += j ^ i; } return t; }", [f"run({n})" for n in NS if n < 200])
counted("under-a-handler", "function run(view: Uint8Array): number { let t = 0; try { for (let i = 0; i < view.length; i++) t += view[i]; } catch (error) { t = -1; } return t; }\nconst view = new Uint8Array(37); for (let i = 0; i < 37; i++) view[i] = i;", ["run(view)", "run(view.subarray(0, 8))", "run(view.subarray(3, 10))"])
counted("in-a-generator", "function* run(view: Uint8Array) { let t = 0; for (let i = 0; i < view.length; i++) t += view[i]; yield t; for (let i = 0; i < view.length; i++) t += view[i] * 2; yield t; }\nconst view = new Uint8Array(37); for (let i = 0; i < 37; i++) view[i] = i;", ["[...run(view)].join()", "[...run(view.subarray(0, 9))].join()"])
counted("in-an-async-function", "async function run(view: Uint8Array) { let t = 0; for (let i = 0; i < view.length; i++) t += view[i]; await null; for (let i = 0; i < view.length; i++) t += view[i] * 2; return t; }\nconst view = new Uint8Array(37); for (let i = 0; i < 37; i++) view[i] = i;", ["await run(view)", "await run(view.subarray(0, 9))"])
counted("the-sum-is-captured", "function run(view: Uint8Array): number { let t = 0; const read = () => t; for (let i = 0; i < view.length; i++) t += view[i]; return read(); }\nconst view = new Uint8Array(37); for (let i = 0; i < 37; i++) view[i] = i;", ["run(view)", "run(view.subarray(0, 8))"])
counted("many-turns", "function run(view: Uint8Array, rounds: number): number { let t = 0; for (let r = 0; r < rounds; r++) { for (let i = 0; i < view.length; i++) t += view[i]; } return t; }\nconst view = new Uint8Array(100003); for (let i = 0; i < view.length; i++) view[i] = i;", ["run(view, 30)"])
counted("a-view-whose-buffer-shrinks-between-loops", "function run(view: Uint8Array): number { let t = 0; for (let i = 0; i < view.length; i++) t += view[i] + 1; return t; }\nconst buffer = new ArrayBuffer(40, { maxByteLength: 80 }); const view = new Uint8Array(buffer);", ["run(view)", "(buffer.resize(19), run(view))", "(buffer.resize(72), run(view))", "(buffer.resize(0), run(view))"])
# ---- what is made on the spot and written in the loop
for v in ["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array"]:
    counted(f"fresh-{v}-filled-and-summed", f"function run(n: number): number {{ const made = new {v}(n); for (let i = 0; i < made.length; i++) made[i] = i * 3 - 7; let t = 0; for (let i = 0; i < made.length; i++) t += made[i]; return t; }}", [f"run({n})" for n in NS if n >= 0])
    counted(f"fresh-{v}-each-takes-the-one-in-front", f"function run(n: number): number {{ const made = new {v}(n); if (n) made[0] = 1; for (let i = 1; i < made.length; i++) made[i] = made[i - 1] + i; let t = 0; for (let i = 0; i < made.length; i++) t = (t * 31 + made[i]) | 0; return t; }}", [f"run({n})" for n in NS if n >= 0])
    counted(f"fresh-{v}-each-takes-the-one-behind", f"function run(n: number): number {{ const made = new {v}(n); for (let i = 0; i < made.length; i++) made[i] = i + 1; const last = made.length - 1; for (let i = 0; i < last; i++) made[i] = made[i + 1] * 2; let t = 0; for (let i = 0; i < made.length; i++) t = (t * 31 + made[i]) | 0; return t; }}", [f"run({n})" for n in NS if n >= 0])
counted("fresh-bytes-read-as-words-while-written", "function run(n: number): number { const bytes = new Uint8Array(n * 2); const words = new Uint16Array(bytes.buffer); let t = 0; for (let i = 0; i < bytes.length; i++) { bytes[i] = i + 1; t += words[i >> 1]; } return t; }", [f"run({n})" for n in NS if n >= 0])
counted("fresh-list-filled-and-summed", "function run(n: number): number { const made: number[] = []; for (let i = 0; i < n; i++) made[i] = i * 3; let t = 0; for (let i = 0; i < made.length; i++) t += made[i]; return t; }", [f"run({n})" for n in NS])
counted("fresh-list-each-takes-the-one-in-front", "function run(n: number): number { const made: number[] = new Array(n > 0 ? n : 0).fill(1); for (let i = 1; i < made.length; i++) made[i] = made[i - 1] + i; let t = 0; for (let i = 0; i < made.length; i++) t = (t * 31 + made[i]) | 0; return t; }", [f"run({n})" for n in NS])
counted("fresh-list-doubled-in-place", "function run(n: number): number { const made: number[] = []; for (let i = 0; i < n; i++) made.push(i); for (let i = 0; i < made.length; i++) made[i] = made[i] * 2; let t = 0; for (let i = 0; i < made.length; i++) t += made[i]; return t; }", [f"run({n})" for n in NS])
counted("remainders-and-quotients", "function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += (i % 7) * 3 + ((i / 3) | 0); return t; }", [f"run({n})" for n in NS])
print(len(made), "programs")
