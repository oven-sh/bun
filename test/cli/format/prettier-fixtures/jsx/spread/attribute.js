<div {...a}/>;

<div {...(a || {})} />;

<div {...(cond ? foo : bar)} />;

<div {...a /* comment */}/>;

<div {/* comment */...a}/>;

<div {...a //comment
}/>;

<div {...a
  //comment
}/>;

<div {
  //comment
  ...a
}/>;

<div {//comment
  ...a // comment
}/>;
