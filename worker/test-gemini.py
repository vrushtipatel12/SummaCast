import os
import sys
import time
import json
import httpx
from pathlib import Path
from dotenv import load_dotenv

# Load worker environment
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

api_key = os.getenv("GEMINI_API_KEY", "")

def test_gemini_audio():
    print("========================================================")
    print("        Gemini API Audio Integration Verifier           ")
    print("========================================================\n")
    
    if not api_key:
        print("❌ Error: GEMINI_API_KEY is not defined in worker/.env")
        sys.exit(1)
        
    print(f"Key detected: {api_key[:12]}...{api_key[-4:]}")
    
    # 1. Download a short test audio file (horse sound/speech)
    test_audio_url = "https://www.w3schools.com/html/horse.mp3"
    local_audio_path = Path(__file__).resolve().parent / "test_clip.mp3"
    
    print(f"\n[Step 1/4] Downloading short test audio from: {test_audio_url}")
    try:
        response = httpx.get(test_audio_url, timeout=15.0)
        response.raise_for_status()
        local_audio_path.write_bytes(response.content)
        print(f"  -> Downloaded successfully to: {local_audio_path}")
    except Exception as e:
        print(f"❌ Error downloading test audio: {str(e)}")
        sys.exit(1)
        
    # 2. Upload file to Google Gemini File API
    print("\n[Step 2/4] Uploading audio to Google Gemini Cloud...")
    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        
        uploaded_file = genai.upload_file(path=str(local_audio_path))
        print(f"  -> File uploaded successfully. Cloud ID: {uploaded_file.name}")
    except Exception as e:
        print(f"❌ Error uploading file to Gemini API: {str(e)}")
        # Clean up local file
        if local_audio_path.exists():
            local_audio_path.unlink()
        sys.exit(1)

    # 3. Poll file state
    print("\n[Step 3/4] Polling file processing state on Google Cloud...")
    try:
        attempts = 0
        while uploaded_file.state.name == "PROCESSING":
            attempts += 1
            if attempts > 15:
                raise TimeoutError("File processing timed out.")
            print(f"  -> State: PROCESSING (Attempt {attempts})...")
            time.sleep(2.0)
            uploaded_file = genai.get_file(uploaded_file.name)
            
        print(f"  -> State check: {uploaded_file.state.name}")
        if uploaded_file.state.name == "FAILED":
            raise RuntimeError("Gemini File processing failed on cloud.")
    except Exception as e:
        print(f"❌ Error polling file state: {str(e)}")
        # Clean up
        try: genai.delete_file(uploaded_file.name)
        except: pass
        if local_audio_path.exists(): local_audio_path.unlink()
        sys.exit(1)

    # 4. Generate structured content
    print("\n[Step 4/4] Generating structured summary & chapters from Gemini...")
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
    
    try:
        model = genai.GenerativeModel(model_name="gemini-1.5-flash")
        response = model.generate_content(
            [uploaded_file, prompt],
            generation_config={"response_mime_type": "application/json"}
        )
        
        print("\n🎉 RESPONSE RECEIVED FROM GEMINI:")
        print("========================================================")
        result_json = json.loads(response.text)
        print(json.dumps(result_json, indent=2))
        print("========================================================")
        
        # Verify JSON keys
        if "summary" in result_json and "chapters" in result_json and "raw_transcript" in result_json:
            print("\n✅ Verification SUCCESS! Gemini API key is active and outputs correct JSON.")
        else:
            print("\n❌ Verification FAILED: JSON structure missing required fields.")
            
    except Exception as e:
        print(f"❌ Error generating structured content: {str(e)}")
    finally:
        # Clean up everything
        print("\n[Cleanup] Evicting local files and cloud containers...")
        try:
            genai.delete_file(uploaded_file.name)
            print("  -> Google Cloud file deleted.")
        except:
            pass
        if local_audio_path.exists():
            local_audio_path.unlink()
            print("  -> Local download file removed.")
            
if __name__ == "__main__":
    test_gemini_audio()
