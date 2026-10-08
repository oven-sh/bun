function SomeComponent (props) {
  // Create styles as if you're calling css and the class will be applied to the component
  return (<div css={`
    color: blue;
    font-size: 17 px;

    &:hover {
      color: green;
    }

    & .some-class {
      font-size: 20px;
    }
  `}>
    This will be blue until hovered.
    <div className="some-class">
      This font size will be 20px
    </div>
  </div>)
}

const TestComponent = ({ children, ...props }) => (
  <div css={`color: white; background: black`}>
    {children}
  </div>
);
