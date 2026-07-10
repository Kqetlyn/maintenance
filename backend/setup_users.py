"""
Create or update dashboard login accounts.

Run from the repository root:
    py -3 backend\\setup_users.py

Passwords are prompted interactively and stored as secure hashes in SQLite.
"""

from __future__ import annotations

import getpass

import auth
import db as _db


def _prompt_user(role: str, default_username: str) -> None:
    print(f"\n{role.title()} account")
    username = input(f"Username [{default_username}]: ").strip() or default_username
    while True:
        password = getpass.getpass("Password [0000]: ") or "0000"
        confirm = getpass.getpass("Confirm password [0000]: ") or "0000"
        if password != confirm:
            print("Passwords did not match. Try again.")
            continue
        try:
            user = auth.create_user(username, password, role, replace=True)
        except ValueError as exc:
            print(exc)
            continue
        print(f"Saved {user['username']} as {user['role']}.")
        return


def main() -> None:
    db_path = _db.init_db()
    auth.ensure_users_table()
    print(f"SQLite ready: {db_path}")
    _prompt_user("restricted", "management")
    _prompt_user("public", "staff")
    print("\nDone. Restart the Flask server, then sign in at /login.")


if __name__ == "__main__":
    main()
