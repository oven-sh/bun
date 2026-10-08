// https://github.com/oxc-project/oxc/pull/21915

export type aType = & // Comment
"VALUE";

export type bType = &
// Comment
"VALUE";

export type cType = & /* Comment */
"VALUE";

export type dType = /* Comment */
& "VALUE";

export type eType = // Comment
& "VALUE";

export type fType = &
/* Comment */
"VALUE";

export type gType = &
// Comment
// Comment
"VALUE";

export type hType = &
"VALUE";

export type iType = /* Comment */ /* Comment */ & "VALUE";

export type jType = /* Comment */
/* Comment */ & "VALUE";

export type kType = /* Comment */
&
// Comment
"VALUE";

export type lType = /* Comment */ &
// Comment
"VALUE";

export type mType = & "VALUE" /* Comment */;

export type nType = // Comment
& /* Comment */
"VALUE";

type oType = // Comment
& // Comment
"VALUE"
