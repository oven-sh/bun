print("run pk2")
lazy from .child import child
lazy from . import other
def use(): return child
