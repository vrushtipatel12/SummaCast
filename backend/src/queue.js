const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const db = require('./db');

const REDIS_URL = process.env.REDIS_URL;
let bullQueue = null;

if (REDIS_URL) {
  try {
    const connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null
    });
    bullQueue = new Queue('media-processing', { connection });
    console.log('BullMQ initialized successfully using Redis.');
  } catch (error) {
    console.error('Failed to initialize Redis connection for BullMQ:', error);
    console.warn('Falling back to local in-memory queue processor.');
  }
} else {
  console.log('No REDIS_URL provided. Operating in local in-memory/HTTP queue fallback mode.');
}

// Websocket references set from index.js
let ioInstance = null;
function setIo(io) {
  ioInstance = io;
}

// Helper to broadcast status changes
function broadcastStatus(jobId, status, details = {}) {
  if (ioInstance) {
    // Broadcast to job-specific room
    ioInstance.to(`job_${jobId}`).emit('status_update', {
      jobId,
      status,
      ...details
    });
    console.log(`[WS Broadcast] Job ${jobId}: ${status}`, details);
  }
}

async function addJob(jobId, mediaUrl, userId, mediaSource) {
  // 1. If BullMQ is active, push task card to Redis queue
  if (bullQueue) {
    try {
      await bullQueue.add('process-media', {
        jobId,
        mediaUrl,
        userId,
        mediaSource
      });
      console.log(`[Queue] Pushed Job ${jobId} to BullMQ Redis Queue`);
      broadcastStatus(jobId, 'PENDING', { message: 'Placed in queue line...' });
      return;
    } catch (err) {
      console.error('[Queue Error] BullMQ push failed, trying local fallback:', err);
    }
  }

  // 2. Fallback: Local HTTP-based queue dispatcher to Python Worker
  broadcastStatus(jobId, 'PENDING', { message: 'Queue processing started...' });
  
  // Fire background HTTP request to Python worker to begin processing without blocking Express
  const workerUrl = process.env.PYTHON_WORKER_URL || 'http://127.0.0.1:8000';
  
  // Running this asynchronously in the background
  (async () => {
    try {
      // Small timeout delay to simulate queuing
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const response = await fetch(`${workerUrl}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, mediaUrl, userId, mediaSource })
      });
      
      if (!response.ok) {
        throw new Error(`Worker returned status ${response.status}`);
      }
      
      console.log(`[Local Queue] Dispatched job ${jobId} to Python Worker successfully.`);
    } catch (error) {
      console.error(`[Local Queue Error] Failed to dispatch job ${jobId} to worker:`, error.message);
      // Update DB to failed
      await db.run(
        'UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['FAILED', jobId]
      );
      broadcastStatus(jobId, 'FAILED', { error: 'Failed to contact transcription worker.' });
    }
  })();
}

module.exports = {
  addJob,
  setIo,
  broadcastStatus
};
