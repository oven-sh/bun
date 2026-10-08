type A1 =
  | (
    | (
      | (
          | A
          // A comment to force break
          | B
        )
    )
  );
type A2 =
  | (
    | (
          | A
          // A comment to force break
          | B
        )
    | (
          | A
          // A comment to force break
          | B
        )
  );
type A3 =
  | ( | (
          | A
          // A comment to force break
          | B
        ) );
type A4 =
  | ( | ( | (
          | A
          // A comment to force break
          | B
        ) ) );
type A5 =
  | (
    | (
      | { key: string }
      | { key: string }
      | { key: string }
      | { key: string }
    )
    | { key: string }
    | { key: string }
  );
type A6 = | (
  /*1*/ | (
    | (
          | A
          // A comment to force break
          | B
        )
  )
  );

type B1 =
  | (
    & (
      (
          | A
          // A comment to force break
          | B
        )
    )
  );
type B2 =
  | (
    & (
      | (
        & (
          (
          | A
          // A comment to force break
          | B
        )
        )
      )
    )
  );
