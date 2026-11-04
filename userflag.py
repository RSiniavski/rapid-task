import sqlite3, sys
email, value = sys.argv[1], int(sys.argv[2])
c = sqlite3.connect("rapid_task.db")
c.execute("UPDATE users SET is_blocked=? WHERE email=?", (value, email))
c.commit()
print(c.execute("SELECT email, is_blocked, last_login_at FROM users WHERE email=?", (email,)).fetchall())
