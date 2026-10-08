`${
a +  // a
  a
}

${a // comment
}

${b /* comment */}

${/* comment */ c /* comment */}

${// comment
d //comment
}

${// $FlowFixMe found when converting React.createClass to ES6
ExampleStory.getFragment('story')}
`;

<div>
{ExampleStory.getFragment('story') // $FlowFixMe found when converting React.createClass to ES6
}
</div>;
