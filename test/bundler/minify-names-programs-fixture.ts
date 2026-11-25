// Programs for the tests of minified names. The six names of the pool meet in
// every way: shadowing, a second declaration, a block-level function in sloppy
// code, a catch binding beside a `var`, parameter scopes, a declaration behind
// a jump. A program tells what it sees through `log`. A seed gives the same
// program every time. Most seeds give a program that declares a name twice,
// which is a syntax error.
//
// `bun minify-names-programs-fixture.ts <seeds>` prints the programs of the
// seeds with minified names, as JSON.
function generateProgram(seed: number): string {
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const chance = (p: number) => rnd() < p;
  const NAMES = ["a", "b", "c", "d", "e", "f"];
  let lit = 0,
    jumps = false,
    loops = false;
  const L = () => String(++lit);
  const N = () => pick(NAMES);
  const obs = (n: string) => `try{log(show(${n}))}catch{log("E")}`;
  function expr(d: number): string {
    const k = rnd();
    if (k < 0.25) return L();
    if (k < 0.5) return N();
    if (k < 0.62) return `call(${N()})`;
    if (k < 0.76 && d < 6) return `(() => ${expr(d + 1)})`;
    if (k < 0.86 && d < 6) return `((${params(d + 1)}) => ${expr(d + 1)})`;
    if (k < 0.92) return `typeof ${N()}`;
    if (d < 6) {
      const n = chance(0.6) ? N() : "",
        ps = params(d + 1);
      const j = jumps,
        l = loops;
      jumps = true;
      loops = false;
      const body = stmts(d + 1, 2 + Math.floor(rnd() * 2));
      jumps = j;
      loops = l;
      return `(function ${n}(${ps}) {${body} return ${expr(d + 1)}})`;
    }
    return N();
  }
  function params(d: number): string {
    const n = Math.floor(rnd() * 3.2),
      out: string[] = [],
      seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      let nm = N();
      if (seen.has(nm)) continue;
      seen.add(nm);
      const k = rnd();
      if (k < 0.5) out.push(nm);
      else if (k < 0.85) out.push(`${nm} = ${expr(d + 1)}`);
      else if (k < 0.93) out.push(`{${nm}}`);
      else {
        out.push(`...${nm}`);
        break;
      }
    }
    return out.join(", ");
  }
  function stmts(d: number, n: number): string {
    const o: string[] = [];
    for (let i = 0; i < n; i++) o.push(stmt(d));
    return " " + o.join(" ") + " ";
  }
  function block(d: number): string {
    return `{${stmts(d + 1, 1 + Math.floor(rnd() * 3))}}`;
  }
  function stmt(d: number): string {
    if (d > 5) return obs(N());
    const k = rnd();
    if (k < 0.015 && jumps)
      return pick([
        `if (true) return ${expr(d)};`,
        `{ return ${expr(d)}; }`,
        `return ${expr(d)};`,
        `if (1) throw ${N()};`,
        `if (fns.length > 30) return ${N()};`,
      ]);
    if (k < 0.025 && jumps && loops) return pick([`if (true) break;`, `{ continue; }`, `break;`]);
    if (k < 0.1) return `var ${N()} = ${expr(d)};`;
    if (k < 0.13) return `var ${N()};`;
    if (k < 0.2) return `${pick(["let", "const"])} ${N()} = ${expr(d)};`;
    if (k < 0.25) return `try{${N()} = ${expr(d)}}catch{log("E")}`;
    if (k < 0.4) return obs(chance(0.7) ? N() : `call(${N()})`);
    if (k < 0.52) {
      const n = N(),
        ps = params(d);
      const j = jumps,
        l = loops;
      jumps = true;
      loops = false;
      const body = stmts(d + 1, 1 + Math.floor(rnd() * 4));
      jumps = j;
      loops = l;
      return `function ${n}(${ps}) {${body} return ${expr(d)}}`;
    }
    if (k < 0.58) return block(d);
    if (k < 0.62)
      return `if (${expr(d)}) ${chance(0.5) ? block(d) : stmt(d + 1).replace(/^(let|const|class)\b.*$/, ";")} else ${block(d)}`;
    if (k < 0.7)
      return `try ${block(d)} catch ${chance(0.85) ? `(${chance(0.85) ? N() : `{${N()}}`}) ` : ""}${block(d)}${chance(0.2) ? ` finally ${block(d)}` : ""}`;
    if (k < 0.76) {
      const v = N(),
        t = rnd();
      if (t < 0.4) {
        const l = loops;
        loops = true;
        const body = stmts(d + 1, 1 + Math.floor(rnd() * 3));
        loops = l;
        return `for (let ${v} = ${L()}, i_ = 0; i_ < 2; i_++, ${v}++) {fns.push(() => ${v});${body}}`;
      }
      if (t < 0.6) return `for (const ${v} of [${expr(d)}, ${L()}]) {fns.push(() => ${v});${stmts(d + 1, 1)}}`;
      if (t < 0.8) return `for (var ${v} of [${expr(d)}]) ${block(d)}`;
      return `for (let ${v} in {k${L()}: 1}) ${block(d)}`;
    }
    if (k < 0.82) return `fns.push(${expr(d)});`;
    if (k < 0.87) {
      const n = N();
      return `try { class ${n} ${chance(0.5) ? `extends (fns.push(() => ${N()}), ${chance(0.3) ? N() : "Object"}) ` : ""}{ static s = ${expr(d + 1)}; m(${params(d + 1)}) { return ${expr(d + 1)} } static { ${obs(N())} } } ${obs(n + ".s")}; fns.push(() => new ${n}().m()); } catch { log("CE") }`;
    }
    if (k < 0.9) return `fns.push(class ${N()} { static s = ${expr(d + 1)}; static t = ${N()}; }.s);`;
    if (k < 0.94) {
      const v = N();
      return `switch (${L()}) { case 0: let ${v} = ${expr(d)}; ${obs(v)}; break; default: {${stmts(d + 1, 2)}} }`;
    }
    if (k < 0.955) {
      const v = N();
      return `switch (${L()}) { case 0: function ${v}(${params(d + 1)}) { return ${expr(d + 1)} } ${obs(v)}; break; case 1: ${obs(v)}; default: {${stmts(d + 1, 1)}} }`;
    }
    if (k < 0.97) return `L${L()}: ${block(d)}`;
    return `log(${expr(d)} === ${expr(d)});`;
  }
  const body =
    `function ${N()}(${params(0)}) {${stmts(1, 3 + Math.floor(rnd() * 4))}}\n` + stmts(0, 4 + Math.floor(rnd() * 5));
  const names = NAMES.map(n => obs(n)).join(";");
  return `(function(){\n${body}\n${names};\nfor (var i_ = 0; i_ < fns.length && i_ < 60; i_++) { try { log(show(call(fns[i_]))) } catch { log("E") } }\n})();\n`;
}

const minifier = new Bun.Transpiler({ loader: "js", target: "browser", minify: { identifiers: true } } as any);
console.log(JSON.stringify(process.argv.slice(2).map(seed => minifier.transformSync(generateProgram(Number(seed))))));
