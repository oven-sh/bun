import { synthesize, COLOR_KINDS, ALPHA_KINDS } from "/root/repos/oven-sh/bun/test/js/bun/image/webp-golden/observe.ts";
let s = 12345;
const r = (n: number) => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 8) % n; };
for (let i = 0; i < 4000; i++) {
  let width: number, height: number;
  switch (r(10)) {
    case 0: width = 1; height = 1; break;
    case 1: width = 1 + r(100); height = 1; break;
    case 2: width = 1; height = 1 + r(100); break;
    case 3: case 4: width = 1 + r(17); height = 1 + r(17); break;
    case 5: width = 100 + r(120); height = 60 + r(100); break;
    default: width = 1 + r(64); height = 1 + r(64);
  }
  const spec = { seed: i + 1, width, height, color: r(COLOR_KINDS), alpha: r(3) ? 0 : r(ALPHA_KINDS) };
  await Bun.write(`/root/ref/corpus/enc-cand/${spec.seed}-${width}-${height}-${spec.color}-${spec.alpha}.rgba`, synthesize(spec));
}
