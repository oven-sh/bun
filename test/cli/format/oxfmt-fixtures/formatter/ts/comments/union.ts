interface _KeywordDef {
  type?: JSONType | JSONType[] // data types that keyword applies to
}

type C1 = | (
  /* 1 */ /*1*/ | (
    | (
          | A
          // A comment to force break
          | B
        )
  )
  );


type C2 = | (
  /* 1 */ /*1*/ 
  /* 1 */ | (
    | (
          | A
          // A comment to force break
          | B
        )
  )
  );
