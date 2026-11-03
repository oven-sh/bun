# test_type_annotations.RegressionTests.test_conditional_annotations_rebound: must be a TypeError
try:
    exec("__conditional_annotations__ = 0\nx: int\n", {})
except TypeError as e:
    print("TypeError", e)
