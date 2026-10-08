/* =========== before slash =========== */
<a><// line
/a>;
<a></* block */
/a>;

<><// line
/>;
<></* block */
/>;

/* =========== after slash =========== */
<a></ // line
a>;
<a></ /* block */
a>;

<></ // line
>;
<></ /* block */
>;

/* =========== after name =========== */
<a></a // line
>;
<a></a /* block */
>;


/* =========== block =========== */
<a></a /* block */>;
<></ /* block */>;

/* =========== multiple ===========  */
<a><// line 1
// line 2
/a>;
<a></* block1 */ /* block2 */
/a>;
<a></* block */ // line
/a>;

<><// line 1
// line 2
/>;
<></* block1 */ /* block2 */
/>;
<></* block */ // line
/>;