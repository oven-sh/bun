type A1 = { readonly [A in B]: T}
type A2 = {
readonly [A in B]: T}
type A3 = { readonly
 [A in B]: T}
type A4 = { readonly [
A in B]: T}
type A5 = { readonly [A in B]
: T}
type A6 = { readonly [A in B]:
T}
type A7 = { readonly [A in B]: T
}

type B1 = {  [A in B]: T}
type B2 = {
 [A in B]: T}
type B4 = {  [
A in B]: T}

type C1 = { +readonly [A in B]: T}
type C2 = {+
readonly [A in B]: T}
type C3 = {
+readonly [A in B]: T}


type D1 = { -readonly [A in B]: T}
type D2 = {-
readonly [A in B]: T}
type D3 = {
-readonly [A in B]: T}
