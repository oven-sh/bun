module.exports = Relay.createContainer(
  // ...
  {
    fragments: {
      nodes: ({solution_type, time_frame}) => Relay.QL`
        fragment on RelatedNode @relay(plural: true) {
          __typename
          ${OptimalSolutionsSection
            .getFragment(
              'node',
              {solution_type, time_frame},
            )
          }
        }
      `,
    },
  },
);
