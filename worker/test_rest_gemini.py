import os
import httpx
import time
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

api_key = os.getenv("GEMINI_API_KEY", "")

def test_rest_file_upload():
    print(f"Testing API Key: {api_key}")
    
    # 1. Download a short test audio file
    test_audio_url = "https://www.w3schools.com/html/horse.mp3"
    local_audio_path = Path(__file__).resolve().parent / "test_clip.mp3"
    
    print(f"\n[Step 1] Downloading test audio from: {test_audio_url}")
    try:
        response = httpx.get(test_audio_url, timeout=15.0)
        response.raise_for_status()
        local_audio_path.write_bytes(response.content)
        print(f"  -> Downloaded successfully to: {local_audio_path}")
    except Exception as e:
        print(f"❌ Error downloading test audio: {str(e)}")
        return

    # 2. Upload using REST protocol
    print("\n[Step 2] Uploading audio via REST protocol...")
    try:
        file_size = local_audio_path.stat().st_size
        mime_type = "audio/mp3"
        
        # A. Start resumable upload session
        start_url = "https://generativelanguage.googleapis.com/upload/v1beta/files"
        headers = {
            "x-goog-api-key": api_key,
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(file_size),
            "X-Goog-Upload-Header-Content-Type": mime_type,
            "Content-Type": "application/json"
        }
        payload = {
            "file": {
                "display_name": "test_clip.mp3"
            }
        }
        
        response = httpx.post(start_url, json=payload, headers=headers, timeout=15.0)
        print(f"Start Session Status: {response.status_code}")
        if response.status_code != 200:
            print(f"Error starting upload session: {response.text}")
            return
            
        upload_url = response.headers.get("X-Goog-Upload-URL")
        print(f"Upload Session URL obtained: {upload_url[:60]}...")
        
        # B. Upload raw bytes
        upload_headers = {
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
            "Content-Length": str(file_size),
            "Content-Type": mime_type
        }
        
        file_bytes = local_audio_path.read_bytes()
        upload_response = httpx.put(upload_url, data=file_bytes, headers=upload_headers, timeout=30.0)
        print(f"Upload Finalize Status: {upload_response.status_code}")
        if upload_response.status_code != 200:
            print(f"Error finalizing upload: {upload_response.text}")
            return
            
        metadata = upload_response.json()
        file_name = metadata["file"]["name"]
        file_uri = metadata["file"]["uri"]
        print(f"Successfully uploaded! Name: {file_name}, URI: {file_uri}")
        
        # C. Poll state
        print("\n[Step 3] Polling file state...")
        poll_url = f"https://generativelanguage.googleapis.com/v1beta/{file_name}"
        poll_headers = {
            "x-goog-api-key": api_key
        }
        
        attempts = 0
        while True:
            attempts += 1
            poll_resp = httpx.get(poll_url, headers=poll_headers, timeout=15.0)
            if poll_resp.status_code != 200:
                print(f"Error polling: {poll_resp.text}")
                return
            state_data = poll_resp.json()
            state = state_data.get("state", "PROCESSING")
            print(f"  Attempt {attempts}: State is {state}")
            if state == "ACTIVE":
                break
            elif state == "FAILED":
                print("Gemini processing failed on cloud.")
                return
            if attempts > 15:
                print("Polling timed out.")
                return
            time.sleep(2.0)
            
        # D. Generate structured content
        print("\n[Step 4] Requesting structured summary and chapters...")
        gen_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
        prompt = """
        Analyze the uploaded audio file and perform two tasks:
        1. Transcribe the audio. Provide a timestamped list of segments. Each segment must have:
           - 'start': start time in seconds (float)
           - 'end': end time in seconds (float)
           - 'text': text spoken in that segment
        2. Structure a summary and chapters. Conforming to this JSON structure:
           - 'summary': A paragraph-long executive summary.
           - 'chapters': A list of chapters. Each chapter must have:
             * 'timestamp': MM:SS format (e.g. '00:00')
             * 'title': Chapter title
             * 'bullets': A list of key takeaways
        
        You must output your response in strict JSON conforming to this schema:
        {
          "summary": "Summary...",
          "chapters": [
            {
              "timestamp": "MM:SS",
              "title": "Title",
              "bullets": ["Bullet 1"]
            }
          ],
          "raw_transcript": [
            {
              "start": 0.0,
              "end": 5.0,
              "text": "Speech text..."
            }
          ]
        }
        """
        
        gen_payload = {
            "contents": [{
                "parts": [
                    {"file_data": {"mime_type": mime_type, "file_uri": file_uri}},
                    {"text": prompt}
                ]
            }],
            "generationConfig": {
                "responseMimeType": "application/json"
            }
        }
        
        gen_headers = {
            "x-goog-api-key": api_key,
            "Content-Type": "application/json"
        }
        gen_resp = httpx.post(gen_url, json=gen_payload, headers=gen_headers, timeout=60.0)
        print(f"GenerateContent Status: {gen_resp.status_code}")
        print(f"Response text: {gen_resp.text}")
        
    except Exception as e:
        print(f"❌ Exception in REST pipeline: {str(e)}")
    finally:
        # Clean up local file
        if local_audio_path.exists():
            local_audio_path.unlink()
            print("Local file cleaned up.")

if __name__ == "__main__":
    test_rest_file_upload()
