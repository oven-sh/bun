import sys
def hook(t, v, tb):
    print("hook:", t.__name__, v, tb.tb_frame.f_code.co_name, file=sys.stdout)
sys.excepthook = hook
print(sys.__excepthook__ is not hook)
raise ValueError("handled by the hook; status is still 1")
