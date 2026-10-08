// At the time of adding this test, the cursor positioning we end up with
// here seems clearly wrong.
// I'm adding the test case anyway to demonstrate the brokenness and ensure
// that if a future changes fixes it, it'll be obvious from the PR diff that
// the fix happened.
[
  [
    [
      [
        1,
        2,
        3  <|>      ,"looooooooooooooooooooooooooooooooooooooooooooooooooong",
        "looooooooooooooooooooooooooooooooooooooooooooooooooong",
      ]
    ]
  ]
]
