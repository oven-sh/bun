# what finalizers find at exit
import sys, os, threading
class A:
    def __del__(self):
        print("modules", sys.modules is not None and len(sys.modules) > 0, "meta_path", sys.meta_path is not None, "os", os is not None, "print", print is not None)
        try:
            import json
            print("import works")
        except BaseException as e:
            print("import fails:", type(e).__name__, e)
        print(sys.is_finalizing())
a = A()
a.me = a
print("end")
