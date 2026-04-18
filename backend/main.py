import argparse
import uvicorn
import sys
import os

# Add the current directory to sys.path so we can import 'app'
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.main import app

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=51234)
    args = parser.parse_args()
    
    uvicorn.run(app, host="0.0.0.0", port=args.port)
