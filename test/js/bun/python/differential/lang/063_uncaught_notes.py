print("before")
e = ValueError("with notes")
e.add_note("first note")
e.add_note("last note\nspanning two lines")
raise e
