// Every kind of object gets elements of every kind of storage, then names written in the text, in turns: a function a kind, so that each site meets one kind; four objects a cell, so that what the first has taught serves the others.
type Rec = { a: number; b: string };
class Inst { p = 1; q = "q"; m() { return this.p; } }
class Wide { f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; f5 = 5; f6 = 6; f7 = 7; f8 = 8; f9 = 9; }
function plainFunction() { return 1; }
const kinds: Array<[string, () => any]> = [
  ["record", () => { const r: Rec = { a: 1, b: "b" }; return r; }],
  ["instance", () => new Inst()],
  ["wide instance", () => new Wide()],
  ["function", () => function () { return 2; }],
  ["arrow", () => () => 3],
  ["bound", () => plainFunction.bind(null)],
  ["class", () => class Local { static s = 1; }],
  ["prototype of a class", () => (class Local2 { m() { return 1; } }).prototype],
  ["prototype of a function", () => (function F() {}).prototype],
  ["untyped literal", () => JSON.parse('{"a":1,"b":"b"}')],
  ["method", () => ({ m() { return 4; } }).m],
  ["async function", () => async function () {}],
  ["generator function", () => function* () {}],
];
const elements: Array<[string, (o: any) => void]> = [
  ["none", () => {}],
  ["int32", o => { o[7] = 7; }],
  ["double", o => { o[0] = 0.5; o[1] = 1.5; }],
  ["values", o => { o[0] = "s"; o[2] = {}; }],
  ["sparse", o => { o[100000] = "far"; o[3] = 3; }],
  ["largest index", o => { o[4294967294] = "last"; o[4294967295] = "a name"; }],
  ["deleted", o => { o[5] = 5; delete o[5]; }],
  ["defined", o => { try { Object.defineProperty(o, "4", { value: "d", writable: true, enumerable: true, configurable: true }); } catch (e) { o[4] = "d"; } }],
];
function fill0(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}
function fill1(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}
function fill2(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}
function fill3(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}
function fill4(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}
function fill5(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}
function fill6(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}
function fill7(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}
function fill8(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}
function fill9(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}
function fill10(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}
function fill11(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}
function fill12(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}
function check(o: any, count: number): string {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += o["n" + i] === i * 3 ? 1 : 0;
  const indices = Object.keys(o).filter(key => /^\d+$/.test(key)).map(key => key + "=" + String(o[key] && typeof o[key] === "object" ? "o" : o[key])).join();
  return sum + "/" + count + " " + indices;
}
const fills = [fill0, fill1, fill2, fill3, fill4, fill5, fill6, fill7, fill8, fill9, fill10, fill11, fill12];
let lines = 0, digest = 0;
const kept: any[] = [];
for (let k = 0; k < kinds.length; k++) {
  const [kind, make] = kinds[k];
  for (const [how, store] of elements) {
    for (const at of [0, 6, 33]) {
      let said = "";
      for (let turn = 0; turn < 4; turn++) {
        const o = make();
        try { fills[k](o, at, store); said += check(o, 40) + "|"; } catch (e) { said += (e as Error).constructor.name + "|"; }
        kept.push(o);
      }
      const line = kind + " | " + how + " | " + at + ": " + said;
      for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
      lines++;
      if (at === 6) console.log(line);
    }
  }
}
let again = 0;
for (const o of kept) again += check(o, 40).startsWith("40/40") ? 1 : 0;
console.log(lines, digest, again);
