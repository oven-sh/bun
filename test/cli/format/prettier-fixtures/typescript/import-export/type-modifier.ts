export type { SomeThing };
export type { A as B };
export type { B as C } from './a';
export type { foo } from 'bar';
export type { foo };

// this should be treated as a normal import statement
import type from './foo';

import type { SomeThing } from "./some-module.js";
import type { foo, bar } from 'baz';
import type { foo as bar } from 'baz';
import type * as foo from './bar';
import type foo from 'bar';

// https://github.com/prettier/prettier/issues/19564
export { type /* comment */ T } from 'foo';
import { type /* comment */ T } from 'foo';

export { /* e1 */ type /* e2 */ T /* e3 */ } from 'foo';
import { /* i1 */ type /* i2 */ T /* i3 */ } from 'foo';

export { /* e1 */ type /* e2 */ T /* e3 */ as /* e4 */ U /* e5 */ } from 'foo';
import { /* i1 */ type /* i2 */ T /* i3 */ as /* i4 */ U /* i5 */ } from 'foo';
