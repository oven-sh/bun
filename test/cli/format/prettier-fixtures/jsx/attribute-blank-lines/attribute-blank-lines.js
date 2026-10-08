const basic = (
  <Component
    first={1}

    second={2}
    third={3}
  />
);

const multipleBlankLines = (
  <Component
    first={1}



    second={2}
  />
);

const spreadAttributes = (
  <Component
    first={1}

    {...props}

    second={2}
  />
);

const noBlankLines = (
  <Component
    first={1}
    second={2}
    third={3}
  />
);

const inlineAttributes = <Component first={1} second={2} />;
