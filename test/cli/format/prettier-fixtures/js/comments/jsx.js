<div>
  {
    /* comment */
  }
</div>;

<div>
  {/* comment */
  }
</div>;

<div>
  {/* comment
*/
  }
</div>;

<div>
  {a/* comment
*/
  }
</div>;

<div>
  {/* comment
*/
  a
  }
</div>;

<div>
  {/* comment */
  }
</div>;

<div>
  {/* comment */}
</div>;

<div>
  {
    // single line comment
  }
</div>;

<div>
  {
    // multiple line comments 1
    // multiple line comments 2
  }
</div>;

<div>
  {
    // multiple mixed comments 1
    /* multiple mixed comments 2 */
    /* multiple mixed comments 3 */
    // multiple mixed comments 4
  }
</div>;

<div>
  {
    // Some very v  ery very very merry (xmas) very very long line to break line width limit
  }
</div>;

<div>{/*<div>  Some very v  ery very very long line to break line width limit </div>*/}</div>;

<div>
  {/**
   * JSDoc-y comment in JSX. I wonder what will happen to it?
  */}
</div>;

<div>
  {
    /**
   * Another JSDoc comment in JSX.
  */
  }
</div>;

<div
  /**
 * Handles clicks.
*/
onClick={() => {}}>

</div>;

<div
  // comment
>
  {foo}
</div>;

<div
  className="foo" // comment
>
  {foo}
</div>;

<div
  className="foo"
  // comment
>
  {foo}
</div>;

<div // comment
  id="foo"
>
  {children}
</div>;

<Wrapper>
  {}
  <Component />
</Wrapper>
