const query = /* GraphQL */`
      {
    user(   id :   5  )  {
      firstName

      lastName
    }
  }
`;

/* GraphQL */`
      {
    user(   id :   5 , type:
    "without variable assignment"  )  {
      firstName

      lastName
    }
  }
`;
