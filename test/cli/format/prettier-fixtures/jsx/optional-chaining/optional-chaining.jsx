function foo() {
  // https://github.com/marmelab/react-admin/blob/5ae855aa958ba54438b144bf0907b1437c5a5d77/examples/demo/src/orders/Totals.tsx#L38-L43
  return (
      <TableCell className={classes.rightAlignedCell}>
          {record?.delivery_fees.toLocaleString(undefined, {
              style: 'currency',
              currency: 'USD',
          })}
      </TableCell>
  )
}

function Component( ) {
  return (
    <div>
      {aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?.bbbbbbbbbbbbbbbbbbbbbbbbb.map(
        (p, i) => <p key={i}>{p}</p>
      )}
    </div>
  );
}

function Component() {
  return (
    <div>
      {aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?.bbbbbbbbbbbbbbbbbbbbbbbbb().map(
        (p, i) => <p key={i}>{p}</p>
      )}
    </div>
  );
}

function Component() {
  return (
    <div>
      {aaa?.aaa()?.aaa()?.map(
        (p, i) => <p key={i}>{p}</p>
      )}
    </div>
  );
}

function Component() {
  return (
    <div>
      {aaa?.aaa?.()?.aaa?.()?.map?.(
        (p, i) => <p key={i}>{p}</p>
      )}
    </div>
  );
}
