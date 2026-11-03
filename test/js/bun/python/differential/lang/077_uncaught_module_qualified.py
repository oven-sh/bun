E = type("E", (Exception,), {"__module__": "some.pkg"})
print("before")
raise E("qualified by its module")
