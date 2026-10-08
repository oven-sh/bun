if (1) foo

// 11
;[]

if (1) foo

// 21
;foo

// prettier-ignore
if (   1)    foo

;[]

if (1) foo /* comment */ ;

if (1) ; else foo

// 11
;[]

if (1) ; else foo

// 21
;foo

// prettier-ignore
if (   1) ; else    foo

;[]

if (1) ; else foo /* comment */ ;
