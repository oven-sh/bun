// https://github.com/prettier/prettier/issues/18307
class C {
  typeCastS() {
    /** @type {string} */ (this.s).length // 7
  }
}

// https://github.com/prettier/prettier/issues/12794
;(/** @type {(token: Token)=>void} */ (onToken))(token) // 1
;/** @type {(token: Token)=>void} */ (onToken)(token) // 2

// unparenthesized
;/** @type {(token: Token)=>void} */ [onToken](token) // 3
;/** @type {(token: Token)=>void} */ onToken(token) // 4

;/* not a type cast comment */ ([])(token) // 5

;/* don't need leading semicolon */ (foo)(token) // 5
