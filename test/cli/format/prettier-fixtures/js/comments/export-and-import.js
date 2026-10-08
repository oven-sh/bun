// These are tests to compare comment formats in `export` and `import`.

export {
  foo,

  bar as  // comment
		 baz,
} from 'foo'

const fooo = ""
const barr = ""

export {
  fooo,

  barr as  // comment
		 bazz,
}

import {
  foo,

  bar as  // comment
		 baz,
} from 'foo'
