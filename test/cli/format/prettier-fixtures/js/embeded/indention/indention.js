_ = `
  line
                  ${
                    a
                    // comment
                    + b}
  line
`;

_ = String.raw`
  line
                  ${
                    a
                    // comment
                    + b}
  line
`;

_ =  css`
  a{
    color:
                  ${
                    a
                    // comment
                    + b}
    ;
  }
`;

_ =  html`
  <div>
                  ${
                    a
                    // comment
                    + b}
  </div>
`;

_ =  gql`

                  ${
                    a
                    // comment
                    + b}

`;
