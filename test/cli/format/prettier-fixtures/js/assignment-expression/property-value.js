a = {
  resource: (this.resource = resource),
}

class A {
  property = (this.resource = resource)
}

map(([resource]) => ({
  resource: (this.resource = resource),
}))

map(([resource]) => class A{
  resource = (this.resource = resource)
})
