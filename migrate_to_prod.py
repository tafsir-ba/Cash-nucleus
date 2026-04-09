"""
Migrate data from Emergent local MongoDB to Production Atlas MongoDB.
"""
import os
from pymongo import MongoClient
from bson import ObjectId
import json

# Source: Emergent local
SRC_URL = "mongodb://localhost:27017"
SRC_DB = "test_database"

# Destination: Production Atlas
DST_URL = "mongodb+srv://tafsir_db_user:NNjSsCiSnS6QMsLi@cluster0.p9ic38l.mongodb.net/?appName=Cluster0"
DST_DB = "cashpilot"

COLLECTIONS = ["entities", "bank_accounts", "cash_flows", "flow_occurrences", "undo_stack", "settings"]

def migrate():
    print("Connecting to source (Emergent local)...")
    src_client = MongoClient(SRC_URL)
    src_db = src_client[SRC_DB]

    print("Connecting to destination (Atlas production)...")
    dst_client = MongoClient(DST_URL)
    dst_db = dst_client[DST_DB]

    # Test Atlas connection
    dst_client.admin.command('ping')
    print("Atlas connection successful!\n")

    for col_name in COLLECTIONS:
        src_col = src_db[col_name]
        dst_col = dst_db[col_name]

        docs = list(src_col.find({}))
        count = len(docs)

        if count == 0:
            print(f"  {col_name}: 0 documents (skipped)")
            continue

        # Clear existing data in destination to avoid duplicates
        dst_col.delete_many({})
        
        # Insert all documents (preserving _id)
        dst_col.insert_many(docs)
        print(f"  {col_name}: {count} documents migrated")

    print("\nMigration complete!")
    src_client.close()
    dst_client.close()

if __name__ == "__main__":
    migrate()
