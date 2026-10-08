const NonBreakingArrowExpression = () => <div />;

const BreakingArrowExpression = () => <div>
  <div>
    bla bla bla
  </div>
</div>;

const NonBreakingArrowExpressionWBody = () => {
  return (
    <div />
  );
};

const BreakingArrowExpressionWBody = () => {
  return <div>
    <div>
      bla bla bla
    </div>
  </div>
};

const NonBreakingFunction = function() {
  return (
    <div />
  );
};

const BreakingFunction = function() {
  return <div>
    <div>
      bla bla bla
    </div>
  </div>
};

class NonBreakingClass extends React.component {
  render() {
    return (
      <div />
    );
  }
}

class BreakingClass extends React.component {
  render() {
    return <div>
      <div>
        bla bla bla
      </div>
    </div>;
  }
}
