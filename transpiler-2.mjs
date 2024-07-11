import { expect } from "bun:test";

const str = 'console.log((b,' + '0,0,0,z,'.repeat(10000) + 'x, 0));';
const result = new Bun.Transpiler({ minify: true })
  .transformSync(str);
expect(result).toBe('console.log((b,' + 'z,'.repeat(10000) + 'x,0));');

