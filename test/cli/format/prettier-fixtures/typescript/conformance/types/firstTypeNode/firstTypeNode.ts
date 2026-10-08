export function fooWithTypePredicate(a: any): a is number {
    return true;
}
export function fooWithTypePredicateAndMulitpleParams(a: any, b: any, c: any): a is number {
    return true;
}
export function fooWithTypeTypePredicateAndGeneric<T>(a: any): a is T {
    return true;
}
export function fooWithTypeTypePredicateAndRestParam(a: any, ...rest): a is number {
    return true;
}
