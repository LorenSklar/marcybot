from openai import OpenAI
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv()
load_dotenv(Path(__file__).parent.parent / ".env")

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

response = client.embeddings.create(
    input="hello world",
    model="text-embedding-3-small"
)

print(response.data[0].embedding[:5]) 
