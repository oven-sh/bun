let error = new Error(response.statusText);
// comment
[].response = response

x;

/* comment */ [].response = response

x;

[].response = response; /* comment */


{
  let foo

  // comment
  ;[foo] = [1]
}

{
  let foo = 42

  // comment
  ;[foo] = [1]
}
