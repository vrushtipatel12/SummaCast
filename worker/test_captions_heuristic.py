import os
import sys
import json
from pathlib import Path
from dotenv import load_dotenv

# Reconfigure stdout to use UTF-8 on Windows systems to prevent encoding crashes
if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Load env variables
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

from pipeline import fetch_youtube_transcript, run_mock_transcript_pipeline, send_status_update

# Mock send_status_update to print to console instead of HTTP request
def mock_status_update(job_id: str, status: str, message: str = "", summary: str = "", chapters: list = None, raw_transcript: list = None, error: str = ""):
    print(f"\n[Mock Callback] Status: {status}")
    if message:
        print(f"  Message: {message}")
    if error:
        print(f"  Error: {error}")
    if summary:
        print(f"  Summary: {summary}")
    if chapters:
        print("\n  Chapters Generated:")
        for idx, ch in enumerate(chapters):
            print(f"    #{idx+1} [{ch['timestamp']}] {ch['title']}")
            for bullet in ch['bullets']:
                print(f"      - {bullet}")
    if raw_transcript:
        print(f"\n  Transcript segments: {len(raw_transcript)} loaded.")

# Swap original callback with mock callback
import pipeline
pipeline.send_status_update = mock_status_update

def test_heuristic_parser():
    print("========================================================")
    print("      Heuristic Transcript Parser Integration Test      ")
    print("========================================================\n")
    
    # Use a well-known YouTube video with captions (e.g., an introduction to python tutorial)
    video_url = "https://www.youtube.com/watch?v=_uQrJ0TkZlc"  # Python Tutorial for Beginners
    job_id = "test-heuristic-job-123"
    
    print(f"Fetching transcript for: {video_url}")
    try:
        transcript_text, raw_transcript = fetch_youtube_transcript(video_url)
        print(f"Success! Transcript length: {len(transcript_text)} characters, {len(raw_transcript)} segments.")
        
        # Test the heuristic parser with a warning banner simulation
        warning_banner = "⚠️ [Gemini API 401 Unauthorized: Falling back to local smart analyzer.]\n\n"
        print("\nRunning heuristic transcript pipeline fallback...")
        run_mock_transcript_pipeline(job_id, transcript_text, raw_transcript, notice_prefix=warning_banner)
        
    except Exception as e:
        print(f"❌ Failed to fetch transcript or parse: {e}")

if __name__ == "__main__":
    test_heuristic_parser()
