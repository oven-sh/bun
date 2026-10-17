// Objects are given seventy properties one by one, with a call between any two stores, so that their storage outside the cell is doubled again and again; every value is read back, while other objects are made and collected.
let ticks = 0;
function tick(value) {
  ++ticks;
  return ticks % 7 === 0 ? { boxed: value } : ticks % 5 === 0 ? "s" + value : value;
}
function fill(o, i0) {
  o.p0 = tick(i0 + 0);
  o.p1 = tick(i0 + 1);
  o.p2 = tick(i0 + 2);
  o.p3 = tick(i0 + 3);
  o.p4 = tick(i0 + 4);
  o.p5 = tick(i0 + 5);
  o.p6 = tick(i0 + 6);
  o.p7 = tick(i0 + 7);
  o.p8 = tick(i0 + 8);
  o.p9 = tick(i0 + 9);
  o.p10 = tick(i0 + 10);
  o.p11 = tick(i0 + 11);
  o.p12 = tick(i0 + 12);
  o.p13 = tick(i0 + 13);
  o.p14 = tick(i0 + 14);
  o.p15 = tick(i0 + 15);
  o.p16 = tick(i0 + 16);
  o.p17 = tick(i0 + 17);
  o.p18 = tick(i0 + 18);
  o.p19 = tick(i0 + 19);
  o.p20 = tick(i0 + 20);
  o.p21 = tick(i0 + 21);
  o.p22 = tick(i0 + 22);
  o.p23 = tick(i0 + 23);
  o.p24 = tick(i0 + 24);
  o.p25 = tick(i0 + 25);
  o.p26 = tick(i0 + 26);
  o.p27 = tick(i0 + 27);
  o.p28 = tick(i0 + 28);
  o.p29 = tick(i0 + 29);
  o.p30 = tick(i0 + 30);
  o.p31 = tick(i0 + 31);
  o.p32 = tick(i0 + 32);
  o.p33 = tick(i0 + 33);
  o.p34 = tick(i0 + 34);
  o.p35 = tick(i0 + 35);
  o.p36 = tick(i0 + 36);
  o.p37 = tick(i0 + 37);
  o.p38 = tick(i0 + 38);
  o.p39 = tick(i0 + 39);
  o.p40 = tick(i0 + 40);
  o.p41 = tick(i0 + 41);
  o.p42 = tick(i0 + 42);
  o.p43 = tick(i0 + 43);
  o.p44 = tick(i0 + 44);
  o.p45 = tick(i0 + 45);
  o.p46 = tick(i0 + 46);
  o.p47 = tick(i0 + 47);
  o.p48 = tick(i0 + 48);
  o.p49 = tick(i0 + 49);
  o.p50 = tick(i0 + 50);
  o.p51 = tick(i0 + 51);
  o.p52 = tick(i0 + 52);
  o.p53 = tick(i0 + 53);
  o.p54 = tick(i0 + 54);
  o.p55 = tick(i0 + 55);
  o.p56 = tick(i0 + 56);
  o.p57 = tick(i0 + 57);
  o.p58 = tick(i0 + 58);
  o.p59 = tick(i0 + 59);
  o.p60 = tick(i0 + 60);
  o.p61 = tick(i0 + 61);
  o.p62 = tick(i0 + 62);
  o.p63 = tick(i0 + 63);
  o.p64 = tick(i0 + 64);
  o.p65 = tick(i0 + 65);
  o.p66 = tick(i0 + 66);
  o.p67 = tick(i0 + 67);
  o.p68 = tick(i0 + 68);
  o.p69 = tick(i0 + 69);
  return o;
}
function plain(value) {
  return typeof value === "object" ? value.boxed : typeof value === "string" ? Number(value.slice(1)) : value;
}
function check(o, i0) {
  const keys = Object.keys(o).filter(key => key[0] === "p");
  let bad = 0;
  for (let i = 0; i < 70; ++i) {
    if (keys[i] !== "p" + i || plain(o["p" + i]) !== i0 + i) ++bad;
  }
  return keys.length === 70 ? bad : -1;
}
const table = { fill };
const kept = [];
let wrong = 0;
for (let round = 0; round < 400; ++round) {
  const start = round % 4 === 0 ? {} : round % 4 === 1 ? { a: 1, b: 2 } : round % 4 === 2 ? Object.create({ inherited: 1 }) : [];
  const o = table.fill(start, round * 100);
  wrong += check(o, round * 100);
  if (round % 40 === 0) kept.push([o, round * 100]);
}
for (const [o, i0] of kept) wrong += check(o, i0);
console.log("wrong", wrong, "ticks", ticks, "kept", kept.length, Object.keys(kept[1][0]).length, kept[3][0].length);
