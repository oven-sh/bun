Seq(typeDef.interface.groups).forEach(group =>
  Seq(group.members).forEach((member, memberName) =>
    markdownDoc(
      member.doc,
      { typePath: typePath.concat(memberName.slice(1)),
       signatures: member.signatures }
    )
  )
)

const promiseFromCallback = fn =>
  new Promise((resolve, reject) =>
    fn((err, result) => {
      if (err) return reject(err);
      return resolve(result);
    })
  );

runtimeAgent.getProperties(
  objectId,
  false, // ownProperties
  false, // accessorPropertiesOnly
  false, // generatePreview
  (error, properties, internalProperties) => {
    return 1
  },
);

function render() {
  return (
    <View>
      <Image
        onProgress={(e) => this.setState({progress: Math.round(100 * e.nativeEvent.loaded / e.nativeEvent.total)})}
      />
    </View>
  );
}

function render() {
  return (
    <View>
      <Image
        onProgress={e =>
          this.setState({
            progress: Math.round(
              100 * e.nativeEvent.loaded / e.nativeEvent.total,
            ),
          })}
      />
    </View>
  );
}

function render() {
  return (
    <View>
      <Image
        onProgress={e =>
          this.setState({
            progress: Math.round(
              100 * e.nativeEvent.loaded / e.nativeEvent.total,
            ),
          })}
      />
    </View>
  );
}

jest.mock(
  '../SearchSource',
  () => class {
    findMatchingTests(pattern) {
      return {paths: []};
    }
  },
);

fooooooooooooooooooooooooooooooooooooooooooooooooooo(action => next =>
    dispatch(action),
);

foo(
  ({
    a,

    b
  }) => {}
);

foo(
  ({
    a,
    b

  }) => {}
);

foo(
  ({
    a,
    b
  }) => {}
);

foo(
  a,
  ({
    a,

    b
  }) => {}
)

foo(
  ({
    a,

    b
  }) => a
);

foo(
  ({
    a,
    b
  }) => a
);

foo(
  ({
    a,
    b

  }) => a
);

foo(
  ({
    a: {
      a,

      b
    }
  }) => {}
);

foo(
  ({
    a: {
      b: {
        c,

        d
      }
    }
  }) => {}
);

foo(
  ({
    a: {
      b: {
        c: {
          d,

          e
        }
      }
    }
  }) => {}
);

foo(
  ({
    a: {
      a,

      b
    }
  }) => a
);

foo(
  ({
    a: {
      b: {
        c,

        d
      }
    }
  }) => a
);

foo(
  ({
    a: {
      b: {
        c: {
          d,

          e
        }
      }
    }
  }) => a
);

foo(
  ([
    {
      a: {
        b: {
          c: {
            d,

            e
          }
        }
      }
    }
  ]) => {}
);

foo(
  ([
    ...{
      a: {
        b: {
          c: {
            d,

            e
          }
        }
      }
    }
  ]) => {}
);

foo(
  (
    n = {
      a: {
        b: {
          c: {
            d,

            e
          }
        }
      }
    }
  ) => {}
);

foo(
  ({
    x: [
      {
        a,

        b
      }
    ]
  }) => {}
);

foo(
  (
    a = [
      {
        a,

        b
      }
    ]
  ) => a
);

foo(
  ([
    [
      {
        a,

        b
      }
    ]
  ]) => {}
);

foo(
  ([
    [
      [
        [
          {
            a,
            b: {
              c,
              d: {
                e,

                f
              }
            }
          }
        ]
      ]
    ]
  ]) => {}
);

foo(
  (
    ...{
      a,

      b
    }
  ) => {}
);

foo(
  (
    ...[
      {
        a,

        b
      }
    ]
  ) => {}
);

foo(
  ([
    ...[
      {
        a,

        b
      }
    ]
  ]) => {}
);

foo(
  (
    a = [{
      a,

      b
    }]
  ) => {}
);

foo(
  (
    a = (({
      a,

      b
    }) => {})()
  ) => {}
);

foo(
  (
    a = f({
      a,

      b
    })
  ) => {}
);

foo(
  (
    a = ({
      a,

      b
    }) => {}
  ) => {}
);

foo(
  (
    a = 1 +
      f({
        a,

        b
      })
  ) => {}
);
