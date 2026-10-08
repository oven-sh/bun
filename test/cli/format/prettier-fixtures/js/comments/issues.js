// Does not need to break as it fits in 80 columns
this.call(a, /* comment */ b);

// Comments should either stay at the end of the line or always before, but
// not one before and one after.
throw new ProcessSystemError({
  code: acc.error.code, // Alias of errno
  originalError: acc.error, // Just in case.
});

// Missing one level of indentation because of the comment
const rootEpic = (actions, store) => (
  combineEpics(...epics)(actions, store)
    // Log errors and continue.
    .catch((err, stream) => {
      getLogger().error(err);
      return stream;
    })
);

// optional trailing comma gets moved all the way to the beginning
const regex = new RegExp(
  '^\\s*' + // beginning of the line
  'name\\s*=\\s*' + // name =
  '[\'"]' + // opening quotation mark
  escapeStringRegExp(target.name) + // target name
  '[\'"]' + // closing quotation mark
  ',?$', // optional trailing comma
);

// The comment is moved and doesn't trigger the eslint rule anymore
import path from 'path'; // eslint-disable-line nuclide-internal/prefer-nuclide-uri

// Comments disappear in-between MemberExpressions
Observable.of(process)
  // Don't complete until we say so!
  .merge(Observable.never())
  // Get the errors.
  .takeUntil(throwOnError ? errors.flatMap(Observable.throw) : errors)
  .takeUntil(exit);

// Comments disappear inside of JSX
<div>
  {/* Some comment */}
</div>;

// Comments in JSX tag are placed in a non optimal way
<div
  // comment
/>;

// Comments disappear in empty blocks
if (1) {
  // Comment
}

// Comments trigger invalid JavaScript in-between else if
if (1) {
}
// Comment
else {

}

// The comment makes the line break in a weird way
const result = asyncExecute('non_existing_command', /* args */ []);

// The closing paren is printed on the same line as the comment
foo({}
  // Hi
);
