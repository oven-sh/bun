export //comment
{}

export /* comment */ {};

const foo = ''
export {
  foo // comment
}

const bar = ''
export {
  // comment
  bar
}

const fooo = ''
const barr = ''
export {
  fooo, // comment
  barr, // comment
}

const foooo = ''
const barrr = ''
export {
  foooo,

  barrr as  // comment
		 baz,
} from 'foo'

const fooooo = ''
const barrrr = ''
export {
  fooooo,

  barrrr as  // comment
		 bazz,
}
