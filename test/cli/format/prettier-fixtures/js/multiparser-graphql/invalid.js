// none of the embedded GraphQL should be formatted
// for they have an invalid escape sequence

gql`
  "\x"
  type   Foo    {
      a: string
  }
`;

gql`
  type   Foo {
      a:   string
  }

  ${stuff}

  "\x"
  type  Bar   {
       b :   string
  }
`;
