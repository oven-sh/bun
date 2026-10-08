a = {
  viewer: graphql`
    fragment x on Viewer {
      y(named: [
        "projects_feedback_ids" # PROJECTS_FEEDBACK_IDS
      ]) {
        name
      }
    }
  `,
}
