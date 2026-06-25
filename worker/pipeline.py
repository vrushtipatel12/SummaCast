import os
import sys
import time
import json
import subprocess
import httpx
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:5000")
WORKER_SECRET = os.getenv("WORKER_SECRET", "summacast_worker_secret_2026")
USE_MOCK_AI = os.getenv("USE_MOCK_AI", "true").lower() == "true"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# Send callback updates to Node.js backend
def send_status_update(job_id: str, status: str, message: str = "", summary: str = "", chapters: list = None, raw_transcript: list = None, error: str = ""):
    url = f"{BACKEND_URL}/api/jobs/{job_id}/status"
    headers = {
        "x-worker-secret": WORKER_SECRET,
        "Content-Type": "application/json"
    }
    payload = {
        "status": status,
        "message": message,
        "summary": summary,
        "chapters": chapters or [],
        "raw_transcript": raw_transcript or [],
        "error": error
    }
    
    try:
        response = httpx.post(url, json=payload, headers=headers, timeout=10.0)
        print(f"[Callback] Job {job_id} updated to {status}. Server response: {response.status_code}")
    except Exception as e:
        print(f"[Callback Error] Failed to update backend for job {job_id}: {str(e)}")

# Helper: Fetch transcripts directly from YouTube API (captions/subtitles)
def fetch_youtube_transcript(youtube_url: str):
    from youtube_transcript_api import YouTubeTranscriptApi
    video_id = None
    if "youtu.be/" in youtube_url:
        video_id = youtube_url.split("youtu.be/")[1].split("?")[0].split("&")[0]
    elif "v=" in youtube_url:
        video_id = youtube_url.split("v=")[1].split("&")[0].split("?")[0]
    elif "embed/" in youtube_url:
        video_id = youtube_url.split("embed/")[1].split("?")[0].split("&")[0]
        
    if not video_id:
        raise ValueError(f"Could not extract YouTube video ID from {youtube_url}")
        
    try:
        # Instantiate and fetch using the new YouTubeTranscriptApi version
        transcript_list = YouTubeTranscriptApi().fetch(video_id)
        raw_transcript = []
        full_text_list = []
        for entry in transcript_list:
            start = entry.start
            duration = entry.duration
            text = entry.text
            raw_transcript.append({
                "start": start,
                "end": start + duration,
                "text": text
            })
            full_text_list.append(text)
        return " ".join(full_text_list), raw_transcript
    except Exception as e:
        print(f"[Transcript API Error] Failed to fetch subtitles for video {video_id}: {str(e)}")
        raise e

# Helper: Extract keywords and build a content-based title
def extract_keywords_and_title(text: str, chapter_idx: int, total_chapters: int) -> str:
    stop_words = {
        "the", "and", "a", "of", "to", "in", "is", "that", "it", "he", "was", "for", "on", "are", 
        "as", "with", "his", "they", "i", "at", "be", "this", "have", "from", "or", "one", "had", 
        "by", "word", "but", "not", "what", "all", "were", "we", "when", "your", "can", "said", 
        "there", "use", "an", "each", "which", "she", "do", "how", "their", "if", "will", "up", 
        "other", "about", "out", "many", "then", "them", "these", "so", "some", "her", "would", 
        "make", "like", "him", "into", "has", "look", "two", "more", "write", "go", "see", "number", 
        "no", "way", "could", "people", "my", "than", "first", "water", "been", "called", "who", 
        "am", "its", "now", "find", "long", "down", "day", "did", "get", "come", "made", "may", 
        "part", "you", "re", "just", "very", "this", "they", "them", "their", "so", "then", "okay",
        "so", "like", "know", "mean", "actually", "going", "think", "sort", "kind", "basically",
        "really", "something", "things", "thing", "lot", "little", "bit", "pretty", "definitely",
        "probably", "maybe", "also", "here", "there", "us", "our", "we", "i'm", "it's", "that's"
    }
    words = []
    for w in text.lower().split():
        clean_w = "".join([c for c in w if c.isalnum()])
        if clean_w and clean_w not in stop_words and len(clean_w) > 3:
            words.append(clean_w)
    
    freq = {}
    for w in words:
        freq[w] = freq.get(w, 0) + 1
        
    sorted_words = sorted(freq.items(), key=lambda x: x[1], reverse=True)
    top_words = [w[0].capitalize() for w in sorted_words[:2]]
    
    if not top_words:
        top_words = ["Topic", "Discussion"]
        
    if len(top_words) == 1:
        w1 = top_words[0]
        if chapter_idx == 0:
            return f"Introduction to {w1}"
        elif chapter_idx == total_chapters - 1:
            return f"Concluding Discussion on {w1}"
        else:
            return f"Exploring {w1}"
    else:
        w1, w2 = top_words[0], top_words[1]
        if chapter_idx == 0:
            return f"Introduction to {w1} and {w2}"
        elif chapter_idx == total_chapters - 1:
            return f"Key Takeaways on {w1} & {w2}"
        else:
            if chapter_idx % 2 == 0:
                return f"Deep Dive: {w1} & {w2}"
            else:
                return f"Exploring {w1} and {w2} Concepts"

# Helper: Dynamic mock pipeline using actual video transcripts
def run_mock_transcript_pipeline(job_id: str, transcript_text: str, raw_transcript: list, notice_prefix: str = ""):
    print(f"[Pipeline] Running Smart Heuristic Pipeline for Job {job_id}")
    
    # 1. Simulate download/transcribe step
    time.sleep(1.0)
    send_status_update(job_id, "PROCESSING", "Structuring AI chapters and summary...")
    time.sleep(1.0)
    
    import re
    # Split transcript into sentences
    sentences = re.split(r'(?<=[.!?])\s+', transcript_text.strip())
    sentences = [s.strip() for s in sentences if len(s.strip()) > 20 and not s.strip().lower().startswith(("okay", "so", "yeah", "alright"))]
    
    # Generate executive summary dynamically using sentences from beginning, middle, and end
    selected = []
    if len(sentences) > 0:
        selected.append(sentences[0])
    if len(sentences) > 4:
        selected.append(sentences[len(sentences) // 2])
    if len(sentences) > 8:
        selected.append(sentences[-1])
        
    if not selected:
        selected = [transcript_text[:300] + "..."]
        
    summary = notice_prefix + " ".join(selected)
    if not summary.endswith("."):
        summary += "."
        
    # Determine chapters
    total_segments = len(raw_transcript)
    chapters = []
    
    if total_segments > 0:
        num_chapters = min(5, max(3, total_segments // 20))
        chunk_size = max(1, total_segments // num_chapters)
        
        for i in range(num_chapters):
            start_idx = i * chunk_size
            if start_idx >= total_segments:
                break
            seg = raw_transcript[start_idx]
            
            # Convert start time in seconds to MM:SS
            s = int(seg['start'])
            m = s // 60
            sec = s % 60
            timestamp = f"{m:02d}:{sec:02d}"
            
            # Collect chunk text for keyword extraction
            chunk_text_list = []
            for j in range(start_idx, min(start_idx + chunk_size, total_segments)):
                chunk_text_list.append(raw_transcript[j]['text'])
            chunk_text = " ".join(chunk_text_list)
            
            # Extract title
            title = extract_keywords_and_title(chunk_text, i, num_chapters)
            
            # Extract bullet points (select complete spoken thoughts)
            bullets = []
            for j in range(start_idx, min(start_idx + chunk_size, total_segments)):
                clean_txt = raw_transcript[j]['text'].replace('\n', ' ').strip()
                if clean_txt:
                    clean_txt = clean_txt[0].upper() + clean_txt[1:]
                    if not clean_txt.endswith(('.', '!', '?')):
                        clean_txt += "."
                    if len(clean_txt) > 25 and clean_txt not in bullets:
                        bullets.append(clean_txt)
                if len(bullets) >= 3:
                    break
            
            if not bullets:
                bullets = ["Discussion of context and key details."]
                
            chapters.append({
                "timestamp": timestamp,
                "title": title,
                "bullets": bullets
            })
    else:
        chapters = [
            {"timestamp": "00:00", "title": "Introduction", "bullets": ["Overview discussion."]}
        ]
        
    send_status_update(
        job_id=job_id,
        status="COMPLETED",
        summary=summary,
        chapters=chapters,
        raw_transcript=raw_transcript
    )

_whisper_model = None

def get_whisper_model():
    """
    Lazily initializes the Faster-Whisper model.
    Attempts to use CUDA/GPU if available, falling back to CPU with int8 quantization.
    """
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        model_size = os.getenv("WHISPER_MODEL_SIZE", "base")
        try:
            print(f"[Whisper] Initializing Faster-Whisper model '{model_size}' (device='auto')...")
            _whisper_model = WhisperModel(model_size, device="auto", compute_type="default")
        except Exception as e:
            print(f"[Whisper Warning] Failed to initialize on 'auto' device: {e}. Falling back to device='cpu'...")
            _whisper_model = WhisperModel(model_size, device="cpu", compute_type="int8")
    return _whisper_model


def run_local_whisper(audio_file_path: Path):
    """
    Transcribes the audio file using the local Faster-Whisper model.
    Returns the full transcript text and the raw transcript segments.
    """
    model = get_whisper_model()
    print(f"[Whisper] Transcribing audio file: {audio_file_path}")
    
    # transcribe returns a generator of segments
    segments, info = model.transcribe(str(audio_file_path), beam_size=5)
    
    raw_transcript = []
    full_text_list = []
    
    for segment in segments:
        raw_transcript.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip()
        })
        full_text_list.append(segment.text.strip())
        
    full_transcript_text = " ".join(full_text_list)
    print(f"[Whisper] Transcription completed. Character count: {len(full_transcript_text)}")
    return full_transcript_text, raw_transcript


def run_local_ollama_pipeline(job_id: str, transcript_text: str, raw_transcript: list):
    """
    Sends the transcript to a local Ollama instance running llama3.
    Uses JSON mode to ensure the output conforms exactly to the schema.
    """
    import json
    
    ollama_url = os.getenv("OLLAMA_API_URL", "http://localhost:11434")
    ollama_model = os.getenv("OLLAMA_MODEL", "llama3")
    
    print(f"[Ollama] Running local Ollama ({ollama_model}) structuring for Job {job_id}")
    send_status_update(job_id, "PROCESSING", f"Structuring AI chapters and summary via local Ollama ({ollama_model})...")
    
    prompt = f"""
    Analyze the following transcript and structure it into:
    1. A concise, paragraph-long Executive Summary.
    2. A list of chronological chapters. For each chapter, specify:
       - The 'timestamp' in MM:SS format (e.g., '00:00' or '04:15') indicating precisely where the topic begins.
       - A descriptive, clear 'title'.
       - Exactly 2-3 key takeaway bullet points summarizing the contents discussed in that segment.

    Ensure that the timestamps perfectly align with actual segments in the transcript.
    You must output your response in strict JSON conforming to this schema:
    {{
      "summary": "Concise paragraph summarizing the entire audio.",
      "chapters": [
        {{
          "timestamp": "MM:SS",
          "title": "Chapter Title",
          "bullets": [
            "Bullet point key takeaway 1",
            "Bullet point key takeaway 2"
          ]
        }}
      ]
    }}

    Transcript:
    \"\"\"
    {transcript_text[:30000]}
    \"\"\"
    """
    
    payload = {
        "model": ollama_model,
        "messages": [
            {
                "role": "system", 
                "content": "You are a precise JSON formatting assistant. You must output a JSON object containing 'summary' and 'chapters' keys exactly matching the requested schema. Do not include any conversational intro or outro text, only the raw JSON."
            },
            {
                "role": "user", 
                "content": prompt
            }
        ],
        "format": "json",
        "stream": False
    }
    
    try:
        response = httpx.post(f"{ollama_url}/api/chat", json=payload, timeout=180.0)
        if response.status_code != 200:
            raise RuntimeError(f"Ollama API returned status {response.status_code}: {response.text}")
            
        data = response.json()
        text_content = data['message']['content']
        
        # Parse the JSON response
        result_json = json.loads(text_content)
        
        summary = result_json.get("summary", "Summary not generated.")
        chapters = result_json.get("chapters", [])
        
        send_status_update(
            job_id=job_id,
            status="COMPLETED",
            summary=summary,
            chapters=chapters,
            raw_transcript=raw_transcript
        )
    except Exception as e:
        print(f"[Ollama Structuring Error] {str(e)}")
        raise e

# Step 1: Download/Locate audio file
def prepare_audio(job_id: str, media_url: str, media_source: str) -> Path:
    temp_dir = Path("temp") / job_id
    temp_dir.mkdir(parents=True, exist_ok=True)
    audio_path = temp_dir / "audio.mp3"

    if media_source == "UPLOAD":
        # media_url looks like: local://uploads/vault/user_xxx/job_yyy/raw_audio.mp3
        relative_path = media_url.replace("local://", "")
        # Resolve path relative to backend directory (which is next to worker directory)
        source_path = Path(__file__).resolve().parent.parent / "backend" / relative_path
        
        if not source_path.exists():
            raise FileNotFoundError(f"Uploaded audio file not found at: {source_path}")
        
        # We can directly use the backend's file or copy it locally
        print(f"[Pipeline] Located uploaded file at: {source_path}")
        return source_path

    elif media_source == "YOUTUBE":
        print(f"[Pipeline] Running yt-dlp to strip audio from: {media_url}")
        output_template = str(temp_dir / "raw_audio.%(ext)s")
        
        # Try downloading with browser cookies to bypass YouTube's bot detection block
        browsers = ["chrome", "edge", "firefox", "brave"]
        download_success = False
        last_error = ""
        
        for browser in browsers:
            try:
                print(f"[Pipeline] Attempting download using cookies from browser: {browser}")
                command = [
                    sys.executable,
                    "-m",
                    "yt_dlp",
                    "-f", "bestaudio",
                    "--cookies-from-browser", browser,
                    "-o", output_template,
                    media_url
                ]
                # Run with short timeout
                result = subprocess.run(command, capture_output=True, text=True, timeout=90.0)
                if result.returncode == 0:
                    print(f"[Pipeline] Successfully bypassed bot-check using {browser} cookies!")
                    download_success = True
                    break
                else:
                    last_error = result.stderr
                    print(f"[Pipeline] Cookies from {browser} failed: {result.stderr[:200]}...")
            except Exception as e:
                last_error = str(e)
                print(f"[Pipeline] Failed to read cookies from {browser}: {str(e)}")
                
        # If all browsers failed, try downloading without cookies as last resort
        if not download_success:
            print("[Pipeline] Browser cookies bypass unsuccessful. Trying download without cookies...")
            command = [
                sys.executable,
                "-m",
                "yt_dlp",
                "-f", "bestaudio",
                "-o", output_template,
                media_url
            ]
            result = subprocess.run(command, capture_output=True, text=True, timeout=90.0)
            if result.returncode != 0:
                print("[yt-dlp Error]", result.stderr)
                raise RuntimeError(f"yt-dlp extraction failed: {result.stderr or last_error}")
        
        # Locate the downloaded file (could be .mp3 or another extension if it converted)
        for p in temp_dir.iterdir():
            if p.suffix in ['.mp3', '.m4a', '.webm', '.opus', '.wav']:
                print(f"[Pipeline] Successfully downloaded YouTube audio to: {p}")
                return p
        raise FileNotFoundError("yt-dlp completed but no audio file found in output folder.")
        
    else:
        raise ValueError(f"Unknown media source: {media_source}")

# Helper to locate uploaded job metadata
def find_job_metadata(job_id: str):
    vault_dir = Path(__file__).resolve().parent.parent / "backend" / "uploads" / "vault"
    if not vault_dir.exists():
        vault_dir = Path("backend/uploads/vault")
        if not vault_dir.exists():
            vault_dir = Path("uploads/vault")
            if not vault_dir.exists():
                return None
                
    try:
        # Search recursively for metadata.json in any job_{job_id} subfolder
        for user_folder in vault_dir.iterdir():
            if user_folder.is_dir():
                job_folder = user_folder / f"job_{job_id}"
                if job_folder.exists():
                    metadata_path = job_folder / "metadata.json"
                    if metadata_path.exists():
                        with open(metadata_path, 'r', encoding='utf-8') as f:
                            return json.load(f)
    except Exception as e:
        print(f"[Pipeline Warning] Failed to read metadata.json: {e}")
    return None

# Helper to fetch YouTube video title
def fetch_youtube_title(url: str) -> str:
    import re
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        response = httpx.get(url, timeout=5.0, headers=headers)
        if response.status_code == 200:
            match = re.search(r"<title>(.*?)</title>", response.text, re.IGNORECASE)
            if match:
                title = match.group(1).replace("- YouTube", "").strip()
                return title
    except Exception as e:
        print(f"[Pipeline Warning] Failed to fetch YouTube title: {e}")
    return ""

# Step 2 & 3: Mock Ingestion and structuring
def run_mock_pipeline(job_id: str, media_url: str = "", media_source: str = "", notice_prefix: str = ""):
    print(f"[Pipeline] Running Mock ML Pipeline for Job {job_id}")
    
    # 1. Simulate download
    time.sleep(1.0)
    send_status_update(job_id, "PROCESSING", "Transcribing speech to text...")
    
    # 2. Simulate Whisper
    time.sleep(1.0)
    send_status_update(job_id, "PROCESSING", "Structuring AI chapters and summary...")
    
    # 3. Simulate GPT
    time.sleep(1.0)
    
    # Detect topic from uploaded file name or YouTube title
    original_name = ""
    if media_source == "UPLOAD":
        metadata = find_job_metadata(job_id)
        original_name = metadata.get("originalname", "") if metadata else ""
    elif media_source == "YOUTUBE" and media_url:
        original_name = fetch_youtube_title(media_url)
        
    topic = "general"
    if original_name:
        name_lower = original_name.lower()
        if any(k in name_lower for k in ["code", "dev", "react", "program", "tech", "software", "database", "api", "web", "app"]):
            topic = "tech"
        elif any(k in name_lower for k in ["market", "business", "growth", "money", "sale", "finance", "startup", "strategy"]):
            topic = "marketing"
        elif any(k in name_lower for k in ["health", "sleep", "diet", "fit", "life", "mind", "medit"]):
            topic = "health"
            
    print(f"[Pipeline] Detected content name: '{original_name}', mapping to topic template: '{topic}'")
    
    if topic == "tech":
        summary = notice_prefix + "In this episode, the hosts break down how cloud databases scale, comparing SQL index strategies with modern NoSQL caching mechanisms. They explain the cost-benefit trade-offs of B-Tree indexing on database writes and when to introduce Redis caching layers."
        chapters = [
          {
            "timestamp": "00:00",
            "title": "Introduction to Database Bottlenecks",
            "bullets": [
              "Why traditional monolithic applications slow down over time as users write data.",
              "The hardware differences between CPU core constraints and disk read limits."
            ]
          },
          {
            "timestamp": "04:15",
            "title": "The Power of Database Indexing",
            "bullets": [
              "How a B-Tree index acts like a library index to speed up search lookups.",
              "The hidden CPU and RAM costs of maintaining too many indexes on a single table."
            ]
          },
          {
            "timestamp": "09:30",
            "title": "SQL Sharding vs NoSQL Scale",
            "bullets": [
              "Vertical scaling (adding RAM) vs horizontal scaling (sharding data rows).",
              "Eventual consistency as a trade-off for scaling high-frequency writes."
            ]
          },
          {
            "timestamp": "16:00",
            "title": "Redis Caching Implementation",
            "bullets": [
              "Offloading read-heavy requests onto an in-memory Redis caching container.",
              "Invalidation strategies including TTL (Time-To-Live) and Write-Through caching."
            ]
          }
        ]
        raw_transcript = [
          {"start": 0.0, "end": 15.0, "text": "Welcome to SummaCast R&D. Today we're going to dive deep into database scaling and bottlenecks."},
          {"start": 15.0, "end": 45.0, "text": "As applications grow, you will notice your database queries taking longer and longer. Let's talk about CPU versus disk reads."},
          {"start": 255.0, "end": 275.0, "text": "Now, at four minutes and fifteen seconds, let's explore indexing. A B-Tree index acts like a book index, which speeds up lookups immensely."},
          {"start": 275.0, "end": 310.0, "text": "However, there is a hidden cost. Every time you insert a new record, all database indexes on that table must be recalculated, slowing down your write speeds."},
          {"start": 570.0, "end": 590.0, "text": "So how do SQL and NoSQL differ? SQL scales vertically on bigger servers. NoSQL shards data horizontally across clusters."},
          {"start": 590.0, "end": 630.0, "text": "To achieve massive throughput, NoSQL models sacrifice immediate consistency in favor of eventual consistency."},
          {"start": 960.0, "end": 980.0, "text": "Finally, at the sixteen minute mark, caching is crucial. Placing Redis in front of PostgreSQL handles repeat queries in RAM."},
          {"start": 980.0, "end": 1010.0, "text": "By setting a Time-To-Live, we ensure stale data is evicted and databases aren't overloaded."}
        ]
    elif topic == "marketing":
        summary = notice_prefix + "This discussion focuses on scaling customer acquisition and optimizing modern marketing funnels. The speakers analyze the shifting landscape of organic search engine optimization (SEO), measuring customer lifetime value (LTV), and managing budget allocation across social platforms."
        chapters = [
          {
            "timestamp": "00:00",
            "title": "Introduction to Modern Marketing Metrics",
            "bullets": [
              "Understanding customer acquisition cost (CAC) versus customer lifetime value (LTV).",
              "Why early stage startups often miscalculate their search engine traffic potential."
            ]
          },
          {
            "timestamp": "03:45",
            "title": "SEO and Content Attribution",
            "bullets": [
              "Why search engines prioritize user experience metrics and page performance over simple keywords.",
              "Attribution modeling and tracking organic conversions back to content creation."
            ]
          },
          {
            "timestamp": "08:15",
            "title": "Paid Advertising and Social Budgets",
            "bullets": [
              "Optimizing click-through rates (CTR) on paid advertisements using dynamic copy.",
              "Testing creative assets in small cohorts to avoid wasting campaign budget."
            ]
          },
          {
            "timestamp": "12:50",
            "title": "Scaling the Growth Flywheel",
            "bullets": [
              "Creating referrals and organic loops to reduce reliance on paid search channels.",
              "Aligning sales incentives with marketing qualified leads for unified performance."
            ]
          }
        ]
        raw_transcript = [
          {"start": 0.0, "end": 15.0, "text": "Welcome to our growth marketing panel. Today we are discussing CAC, LTV, and building organic user loops."},
          {"start": 15.0, "end": 45.0, "text": "If you don't know your customer acquisition cost, you're flying blind. You need to verify that your customer lifetime value outweighs CAC by at least three to one."},
          {"start": 225.0, "end": 245.0, "text": "Let's move into search engine optimization. SEO is no longer about keyword stuffing; it's about matching search intent and page speed."},
          {"start": 245.0, "end": 280.0, "text": "Attributing organic signups is the hardest part. Multi-touch attribution models show that users click up to five articles before registering."},
          {"start": 495.0, "end": 515.0, "text": "At eight minutes and fifteen seconds, let's talk paid ads. Facebook and Google CPC bids are rising yearly, so your creative copy must stand out."},
          {"start": 515.0, "end": 550.0, "text": "We recommend split-testing small budget cohorts first. Run a dozen variations to see which asset converts best before scaling."},
          {"start": 770.0, "end": 790.0, "text": "Finally, at the twelve minute fifty mark, focus on the growth flywheel. Referral discounts can lower your acquisition costs significantly."},
          {"start": 790.0, "end": 830.0, "text": "Aligning your sales team with marketing-qualified leads ensures that no high-intent visitor falls through the cracks."}
        ]
    elif topic == "health":
        summary = notice_prefix + "In this episode, the speaker explores how lifestyle choices impact physical wellness and cognitive function. The discussion centers on sleep hygiene, optimization of circadian rhythms, nutritional habits, and simple techniques for daily stress reduction."
        chapters = [
          {
            "timestamp": "00:00",
            "title": "Understanding Circadian Rhythm & Sleep",
            "bullets": [
              "How morning light exposure signals the brain to stop melatonin production.",
              "The negative impact of blue light exposure on deep REM sleep cycles."
            ]
          },
          {
            "timestamp": "04:30",
            "title": "Nutritional Fundamentals for Focus",
            "bullets": [
              "Why low-glycemic index foods prevent mid-afternoon energy crashes.",
              "The importance of proper hydration for cellular energy and cognitive performance."
            ]
          },
          {
            "timestamp": "08:45",
            "title": "Exercise and Brain Health",
            "bullets": [
              "How moderate aerobic activity triggers brain-derived neurotrophic factor (BDNF).",
              "Simple movement snacks to incorporate during desk job hours."
            ]
          },
          {
            "timestamp": "13:15",
            "title": "Daily Stress Management Practices",
            "bullets": [
              "Implementing breathing patterns like box breathing to activate the parasympathetic nervous system.",
              "Setting boundaries with digital devices to prevent mental fatigue."
            ]
          }
        ]
        raw_transcript = [
          {"start": 0.0, "end": 15.0, "text": "Welcome to the wellness podcast. Today we are looking at sleep, nutrition, and daily energy management."},
          {"start": 15.0, "end": 45.0, "text": "Your circadian rhythm is governed by light. Getting ten minutes of outdoor sunlight in the morning resets your cortisol clock."},
          {"start": 270.0, "end": 290.0, "text": "Now, at four minutes thirty, let's examine nutrition. High-sugar breakfasts trigger insulin spikes followed by brain fog."},
          {"start": 290.0, "end": 320.0, "text": "Consistent hydration is often overlooked. Even mild dehydration can decrease mental clarity and decision making by twenty percent."},
          {"start": 525.0, "end": 545.0, "text": "Let's pivot to movement. Aerobic exercise releases BDNF, which acts like fertilizer for new brain cells and memory."},
          {"start": 545.0, "end": 580.0, "text": "If you sit at a desk all day, introduce short movement snacks. Walk for two minutes every hour to stimulate blood flow."},
          {"start": 795.0, "end": 815.0, "text": "Finally, at thirteen fifteen, we address stress. Box breathing for just two minutes lowers heart rate and shifts you out of fight-or-flight."},
          {"start": 815.0, "end": 850.0, "text": "Setting a strict digital curfew helps clear the mind before bed. Turn off all notifications an hour before sleeping."}
        ]
    else:
        summary = notice_prefix + "This recording features a conversation about personal growth, acquiring new skills, and adapting to career transitions. The discussion centers on the psychology of learning, overcoming fear of failure, and establishing structured habits to achieve long-term goals."
        chapters = [
          {
            "timestamp": "00:00",
            "title": "The Science of Skill Acquisition",
            "bullets": [
              "Why deliberate practice and focused intervals beat passive learning.",
              "Overcoming the initial frustration phase when starting a new discipline."
            ]
          },
          {
            "timestamp": "04:00",
            "title": "Building Sustainable Habits",
            "bullets": [
              "How habit stacking links new routines to established daily triggers.",
              "The compound effect of small daily improvements over several months."
            ]
          },
          {
            "timestamp": "08:00",
            "title": "Overcoming Setbacks and Failure",
            "bullets": [
              "Viewing mistakes as data points rather than personal shortcomings.",
              "The importance of a growth mindset in developing long-term resilience."
            ]
          },
          {
            "timestamp": "12:30",
            "title": "Setting Effective Goals",
            "bullets": [
              "Structuring goals to be specific, measurable, and action-oriented.",
              "Focusing on process systems rather than just the final end result."
            ]
          }
        ]
        raw_transcript = [
          {"start": 0.0, "end": 15.0, "text": "Welcome to our discussion on learning and growth. Today we explore how habits and practice shape our abilities."},
          {"start": 15.0, "end": 45.0, "text": "Passive learning gives the illusion of progress. True skill acquisition requires deliberate practice and active recall."},
          {"start": 240.0, "end": 260.0, "text": "Moving to habits, habit stacking is a powerful strategy. Link your new habit to something you already do automatically every day."},
          {"start": 260.0, "end": 290.0, "text": "Consistency is key. Making a one percent improvement daily compounding over a year results in a thirty-seven fold improvement."},
          {"start": 480.0, "end": 500.0, "text": "At the eight minute mark, let's talk about failure. Failure is simply feedback telling you what adjustments to make next."},
          {"start": 500.0, "end": 530.0, "text": "Resilience is built by adopting a growth mindset, believing that intelligence and skills can be developed through effort."},
          {"start": 750.0, "end": 770.0, "text": "Finally, at twelve minutes thirty, we look at goal setting. Vague goals like 'getting better' rarely work."},
          {"start": 770.0, "end": 810.0, "text": "You need process goals, like coding for thirty minutes every day, focusing on the system rather than just the destination."}
        ]
        
    send_status_update(
        job_id=job_id,
        status="COMPLETED",
        summary=summary,
        chapters=chapters,
        raw_transcript=raw_transcript
    )

# Background Task Worker Thread Root
def process_job(job_id: str, media_url: str, user_id: str, media_source: str):
    print(f"[Pipeline] Started processing thread for Job: {job_id}")
    try:
        use_mock = os.getenv("USE_MOCK_AI", "true").lower() == "true"
        
        # Step 1: Notify start
        send_status_update(job_id, "PROCESSING", "Extracting video transcript...")
        
        if media_source == "YOUTUBE":
            try:
                # Try to extract the real transcript directly from YouTube captions
                transcript_text, raw_transcript = fetch_youtube_transcript(media_url)
                print(f"[Pipeline] Successfully fetched YouTube subtitles. Length: {len(transcript_text)} chars.")
                
                if use_mock:
                    run_mock_transcript_pipeline(job_id, transcript_text, raw_transcript)
                else:
                    try:
                        # Call local Ollama pipeline directly with the fetched transcript
                        run_local_ollama_pipeline(job_id, transcript_text, raw_transcript)
                    except Exception as ollama_err:
                        print(f"[Pipeline Warning] Local Ollama pipeline failed: {ollama_err}. Falling back to smart heuristic parser.")
                        warning = f"⚠️ [Local Ollama Error: {str(ollama_err)[:80]}... Falling back to local smart analyzer. Make sure Ollama is running and llama3 model is pulled.]\n\n"
                        run_mock_transcript_pipeline(job_id, transcript_text, raw_transcript, notice_prefix=warning)
                return
            except Exception as e:
                print(f"[Transcript API Fallback] Direct transcript fetch failed or was unavailable: {str(e)}")
                # If captions fail, fall back to audio download + local Faster-Whisper pipeline
        
        # Audio Download Fallback (or Local Upload file)
        send_status_update(job_id, "PROCESSING", "Preparing audio stream...")
        
        if use_mock:
            run_mock_pipeline(job_id, media_url, media_source)
        else:
            try:
                audio_path = prepare_audio(job_id, media_url, media_source)
            except Exception as prep_err:
                print(f"[Pipeline Warning] Audio download/preparation failed: {prep_err}. Falling back to mockup.")
                warning = f"⚠️ [Audio Stream Preparation Failed: {str(prep_err)[:80]}... YouTube download rate-limited or file missing. Falling back to local mockup.]\n\n"
                run_mock_pipeline(job_id, media_url, media_source, notice_prefix=warning)
                return
                
            # Perform transcription and structuring locally
            try:
                send_status_update(job_id, "PROCESSING", "Transcribing speech to text locally via Faster-Whisper...")
                transcript_text, raw_transcript = run_local_whisper(audio_path)
                
                # Perform structuring with local Ollama
                run_local_ollama_pipeline(job_id, transcript_text, raw_transcript)
            except Exception as local_ai_err:
                print(f"[Pipeline Warning] Local AI pipeline failed: {local_ai_err}. Falling back to mockup.")
                warning = f"⚠️ [Local AI Error: {str(local_ai_err)[:80]}... Falling back to local mockup. Ensure Ollama is running and llama3 model is pulled.]\n\n"
                run_mock_pipeline(job_id, media_url, media_source, notice_prefix=warning)
                
            # Clean up temp folder files if YouTube
            if media_source == "YOUTUBE":
                try:
                    temp_dir = Path("temp") / job_id
                    if temp_dir.exists():
                        for file in temp_dir.iterdir():
                            file.unlink()
                        temp_dir.rmdir()
                        print(f"[Pipeline] Cleaned up temporary files for YouTube job {job_id}")
                except Exception as clean_err:
                    print(f"[Pipeline Cleanup Warning] Failed to delete temp directory: {clean_err}")
                
    except Exception as err:
        print(f"[Pipeline Error] Critical unhandled error during job {job_id}: {str(err)}")
        err_str = str(err)
        send_status_update(job_id, "FAILED", error=err_str)


