"""
One-off utility to create or reset a user's password in MongoDB.

The password is never accepted as a command-line argument. That would leak
into shell history and the process list. Run it interactively and type the
password at the hidden prompt, or pipe one line on stdin:

  python3 reset_user_password.py --email user@example.com --name Admin
  printf '%s\n' 'your-password-here' | python3 reset_user_password.py --email user@example.com --password-stdin

Empty or blank input is refused. --email and --name are unchanged.
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional, TextIO


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create or reset app user password.")
    parser.add_argument("--email", required=True, help="User email")
    parser.add_argument("--name", default="Admin", help="Name used if user is created")
    parser.add_argument(
        "--password-stdin",
        action="store_true",
        help="Read one password line from stdin instead of prompting",
    )
    return parser


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    return build_parser().parse_args(argv)


def _strip_trailing_newline(text: str) -> str:
    if text.endswith("\r\n"):
        return text[:-2]
    if text.endswith("\n") or text.endswith("\r"):
        return text[:-1]
    return text


def read_password(
    *,
    from_stdin: bool,
    stdin: Optional[TextIO] = None,
    getpass_func: Optional[Callable[[str], str]] = None,
) -> str:
    """Read a password from a hidden prompt, or from stdin when piped.

    --password-stdin forces the stdin path. A non-interactive stdin (a pipe)
    is also read one line at a time so the value is not taken from argv.
    Interactive terminals use getpass. Blank input is refused.
    """
    stream = sys.stdin if stdin is None else stdin
    if from_stdin or not stream.isatty():
        password = _strip_trailing_newline(stream.readline())
    else:
        prompt = getpass_func or getpass.getpass
        password = prompt("Password: ")
    if password.strip() == "":
        raise SystemExit("Password must not be empty")
    return password


def write_user_password(email: str, password: str, name: str) -> None:
    from dotenv import load_dotenv
    import bcrypt
    from pymongo import MongoClient

    load_dotenv(".env")

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        raise SystemExit("Missing MONGO_URL/DB_NAME in environment or .env")

    normalized_email = email.strip().lower()
    pw_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    now = datetime.now(timezone.utc).isoformat()

    client = MongoClient(mongo_url)
    try:
        users = client[db_name]["users"]
        existing = users.find_one({"email": normalized_email}, {"_id": 0, "id": 1, "email": 1})
        if existing:
            users.update_one(
                {"email": normalized_email},
                {"$set": {"password_hash": pw_hash, "updated_at": now}},
            )
            print(f"Updated password for: {normalized_email}")
        else:
            users.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "email": normalized_email,
                    "password_hash": pw_hash,
                    "name": name,
                    "created_at": now,
                }
            )
            print(f"Created user and set password: {normalized_email}")
    finally:
        client.close()


def main(argv: Optional[list[str]] = None) -> None:
    args = parse_args(argv)
    password = read_password(from_stdin=args.password_stdin)
    write_user_password(args.email, password, args.name)


if __name__ == "__main__":
    main()
