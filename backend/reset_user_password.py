"""
One-off utility to create/reset a user's password in MongoDB.

Usage:
  python3 reset_user_password.py --email tafsir@evo-home.ch --password Evocash1234
  python3 reset_user_password.py --email admin@example.com --password 'NewSecret!' --name Admin
"""

from __future__ import annotations

import argparse
import os
import uuid
from datetime import datetime, timezone

import bcrypt
from dotenv import load_dotenv
from pymongo import MongoClient


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Create or reset app user password.")
    p.add_argument("--email", required=True, help="User email")
    p.add_argument("--password", required=True, help="Plaintext password")
    p.add_argument("--name", default="Admin", help="Name used if user is created")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    load_dotenv(".env")

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        raise SystemExit("Missing MONGO_URL/DB_NAME in environment or .env")

    email = args.email.strip().lower()
    pw_hash = bcrypt.hashpw(args.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    now = datetime.now(timezone.utc).isoformat()

    client = MongoClient(mongo_url)
    db = client[db_name]
    users = db["users"]

    existing = users.find_one({"email": email}, {"_id": 0, "id": 1, "email": 1})
    if existing:
        users.update_one(
            {"email": email},
            {"$set": {"password_hash": pw_hash, "updated_at": now}},
        )
        print(f"Updated password for: {email}")
    else:
        users.insert_one(
            {
                "id": str(uuid.uuid4()),
                "email": email,
                "password_hash": pw_hash,
                "name": args.name,
                "created_at": now,
            }
        )
        print(f"Created user and set password: {email}")

    client.close()


if __name__ == "__main__":
    main()
