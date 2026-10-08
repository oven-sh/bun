var o = {
  [`key`]: () => {
    // Comment
  }
};

var x = {
  y: () => Relay.QL`
    query {
      ${foo},
      field,
    }
  `
};
