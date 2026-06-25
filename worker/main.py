import os
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load env variables
load_dotenv()

app = FastAPI(title="SummaCast ML Worker")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class JobPayload(BaseModel):
    jobId: str
    mediaUrl: str
    userId: str
    mediaSource: str

# Import the core pipeline processor
from pipeline import process_job

@app.get("/")
def root():
    return {
        "message": "SummaCast ML Worker is running",
        "status": "online",
        "documentation": "/docs",
        "health": "/health"
    }


@app.post("/api/process", status_code=202)
def start_processing(payload: JobPayload, background_tasks: BackgroundTasks):
    print(f"[Worker] Received job request for Job: {payload.jobId}")
    background_tasks.add_task(
        process_job,
        payload.jobId,
        payload.mediaUrl,
        payload.userId,
        payload.mediaSource
    )
    return {"status": "processing_started", "jobId": payload.jobId}

@app.get("/health")
def health():
    return {
        "status": "ok",
        "mock_ai": os.getenv("USE_MOCK_AI", "true").lower() == "true",
        "backend_url": os.getenv("BACKEND_URL", "http://127.0.0.1:5000")
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"Starting worker server on port {port}...")
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=True)
