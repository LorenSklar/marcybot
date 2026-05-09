from supabase import create_client
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv()
load_dotenv(Path(__file__).parent.parent / ".env")

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")

supabase = create_client(url, key)
print("connected!", supabase)

response = supabase.table("test").insert({"content": "hello from python"}).execute()
print(response)
