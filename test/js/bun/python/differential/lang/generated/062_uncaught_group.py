print("before")
raise ExceptionGroup("several", [ValueError(1), ExceptionGroup("nested", [TypeError("t")])])
