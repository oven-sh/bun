const foo = {
  createNewConnection: ([
  password,
    ,
    // @ts-expect-error THIS SHOULD STAY HERE
      username,

  ]) => {
    void password; void username;
  },
}
