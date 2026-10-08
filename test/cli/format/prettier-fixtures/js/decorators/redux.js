@connect(mapStateToProps, mapDispatchToProps)
export class MyApp extends React.Component {}

@connect(state => ({ todos: state.todos }))
export class Home extends React.Component {}
