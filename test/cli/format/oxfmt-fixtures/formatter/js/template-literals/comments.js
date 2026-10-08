const plain = `value ${
  // leading comment stays attached to identifier
  value
}`;

const call = `value ${
  // leading comment stays attached to call expression
  call()
}`;

const inlineBlock = `value ${/* leading block */ value}`;

const trailing = `value ${
  value // trailing comment stays before interpolation end
}`;
