const comp1 = (
  <div style={styles} key="something">
    Keep the wrapping parens.
  </div>
);

const comp2 = <div style={styles} key="something">
  Create wrapping parens.
</div>;

comp2A = <div style={styles} key="something">
  Create wrapping parens.
</div>;

const comp3 = <div style={styles} key="something">Bump to next line without parens</div>;

const comp4 = <div style={styles} key="something">Create wrapping parens and indent <strong>all the things</strong>.</div>;

const comp5 = <div>Keep it on one line.</div>;
