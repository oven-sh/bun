// #9274
html`
  <div>
    ${this.set && this.set.artist
    /* avoid console errors if `this.set` is undefined */}
  </div>
`;

html`${
      foo
  /* comment */
}`;
html`
${
      foo
  /* comment */
}
`;


graphql`${
      foo
  /* comment */
}`;
graphql`
${
      foo
  /* comment */
}
`;


css`${
      foo
  /* comment */
}`;
css`
${
      foo
  /* comment */
}
`;

markdown`${
      foo
  /* comment */
}`;
markdown`
${
      foo
  /* comment */
}
`;

// https://github.com/prettier/prettier/pull/9278#issuecomment-700589195
expr1 = html`
  <div>
    ${x(foo, // fg
        bar
      )}</div>
`;
