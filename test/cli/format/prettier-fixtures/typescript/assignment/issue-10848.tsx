const MyComponent: React.VoidFunctionComponent<MyComponentProps> = ({ x }) => {
  const a = useA()
  return <div>x = {x}; a = {a}</div>
}

const MyComponent2: React.VoidFunctionComponent<MyComponent2Props> = ({ x, y }) => {
  const a = useA()
  return <div>x = {x}; y = {y}; a = {a}</div>
}

const MyComponentWithLongName1: React.VoidFunctionComponent<MyComponentWithLongNameProps> = ({ x, y }) => {
  const a = useA()
  return <div>x = {x}; y = {y}; a = {a}</div>
}

const MyComponentWithLongName2: React.VoidFunctionComponent<MyComponentWithLongNameProps> = ({ x, y, anotherPropWithLongName1, anotherPropWithLongName2, anotherPropWithLongName3, anotherPropWithLongName4 }) => {
  const a = useA()
  return <div>x = {x}; y = {y}; a = {a}</div>
}

const MyGenericComponent: React.VoidFunctionComponent<MyGenericComponentProps<number>> = ({ x, y }) => {
  const a = useA()
  return <div>x = {x}; y = {y}; a = {a}</div>
}

export const ExportToExcalidrawPlus: React.FC<{
  elements: readonly NonDeletedExcalidrawElement[];
  appState: AppState;
  onError: (error: Error) => void;
}> = ({ elements, appState, onError }) => {
  return null;
}

const Query: FunctionComponent<QueryProps> = ({
    children,
    type,
    resource,
    payload,
    // Provides an undefined onSuccess just so the key `onSuccess` is defined
    // This is used to detect options in useDataProvider
    options = { onSuccess: undefined },
}) =>
    children(
        useQuery(
            { type, resource, payload },
            { ...options, withDeclarativeSideEffectsSupport: true }
        )
    );
