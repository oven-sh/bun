async function f() {
  const admins = (await(db.select('*').from('admins').leftJoin('bla').where('id', 'in', [1,2,3,4]))).map(({id, name})=>({id, name}))
}
