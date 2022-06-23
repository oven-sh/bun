const trailing = <span>Hello </span>;
const leading = <span> John</span>;

/* prettier-ignore */
const extraSpaces = <span>Hello   John</span>;

const trailingExpr = <span>Hello {name}</span>;
const leadingExpr = <span>{greeting} John</span>;

/* prettier-ignore */
const multiExpr = <span>{greeting} {name}</span>;

/* prettier-ignore */
const multiExprSpaced = <span> {greeting} {name} </span>;

/* prettier-ignore */
const multiExprTogether = <span> {greeting}{name} </span>;

/* prettier-ignore */
const multiLine = <span>

  Hello

</span>

/* prettier-ignore */
const multiLineTrailingSpace = <span>
  Hello 
  John
</span>

/* prettier-ignore */
const multiLineNoTrailingSpace = <span>
  Hello
  John
</span>

/* prettier-ignore */
const escape = <span> 
  &nbsp;&lt;Hi&gt;&nbsp;
</span>

/* prettier-ignore */
const escape2 = <Comp> 
  &nbsp;&lt;Hi&gt;&nbsp;
</Comp>

/* prettier-ignore */
const escape3 = <> 
  &nbsp;&lt;Hi&gt;&nbsp;
</>

const injection = <span>Hi{"<script>alert();</script>"}</span>;

let value = "World";
const evaluated = <span>Hello {value + "!"}</span>;

let number = 4 + 5;
const evaluatedNonString = <span>4 + 5 = {number}</span>;

const newLineLiteral = (
  <div>
    {s}
    {"\n"}d
  </div>
);

const trailingSpace = <div>{expr}</div>;

const trailingSpaceComp = <Comp>{expr}</Comp>;

const trailingSpaceFrag = <>{expr}</>;
