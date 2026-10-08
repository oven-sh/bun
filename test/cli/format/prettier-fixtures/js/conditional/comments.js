var inspect = 4 === util.inspect.length
  ? // node <= 0.8.x
    (function(v, colors) {
      return util.inspect(v, void 0, void 0, colors);
    })
  : // node > 0.8.x
    (function(v, colors) {
      return util.inspect(v, { colors: colors });
    });

var inspect = 4 === util.inspect.length
  ? // node <= 0.8.x
    (function(v, colors) {
      return util.inspect(v, void 0, void 0, colors);
    })
  : // node > 0.8.x
    (function(v, colors) {
      return util.inspect(v, { colors: colors });
    });

const extractTextPluginOptions = shouldUseRelativeAssetPaths
  // Making sure that the publicPath goes back to to build folder.
  ? { publicPath: Array(cssFilename.split('/').length).join('../') } :
  {};

const extractTextPluginOptions2 = shouldUseRelativeAssetPaths
  ? // Making sure that the publicPath goes back to to build folder.
    { publicPath: Array(cssFilename.split("/").length).join("../") }
  : {};

const extractTextPluginOptions3 = shouldUseRelativeAssetPaths // Making sure that the publicPath goes back to to build folder.
  ? { publicPath: Array(cssFilename.split("/").length).join("../") }
  : {};

const { configureStore } = process.env.NODE_ENV === "production"
  ? require("./configureProdStore") // a
  : require("./configureDevStore"); // b

test /* comment
  comment
      comment
*/
  ? foo
  : bar;

test
  ? /* comment
          comment
    comment
          comment
  */
    foo
  : bar;

test
  ? /* comment
       comment
       comment
       comment
    */
    foo
  : test
  ? /* comment
  comment
    comment */
    foo
  : bar;

test
  ? /* comment */
    foo
  : bar;

test
  ? foo
  : /* comment
         comment
     comment
           comment
    */
  bar;

test
  ? foo
  : /* comment
         comment
     comment
           comment
      A newline will be added after this comment, unfortunately – but it can be removed manually, see next statement.
    */
  test
  ? foo
  : /* comment
  comment
    comment
   */
    bar;


// It is at least possible to delete the extra newline that was
// unfortunately added before the second condition above:
test ?
  foo :/* comment
         comment
     comment
           comment
    */
test ?
  foo :
  /* comment
  comment
    comment
   */
  bar;

test
  ? foo
  : /* comment */
  bar;

test ? test /* c
c */? foo : bar : bar;
