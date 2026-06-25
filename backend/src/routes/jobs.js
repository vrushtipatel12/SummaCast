const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const queue = require('../queue');
const authMiddleware = require('../middleware/auth');

// POST /api/jobs/:id/status - Worker callback to report progress, completion, or failure
router.post('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, message, summary, chapters, raw_transcript, error } = req.body;

  const workerSecret = process.env.WORKER_SECRET || 'summacast_worker_secret_2026';
  if (req.headers['x-worker-secret'] !== workerSecret) {
    return res.status(403).json({ error: 'Forbidden. Invalid worker secret.' });
  }

  try {
    const job = await db.get('SELECT * FROM jobs WHERE id = ?', [id]);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    if (status === 'COMPLETED') {
      await db.run(
        'UPDATE jobs SET status = ?, summary = ?, chapters = ?, raw_transcript = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, summary, JSON.stringify(chapters), JSON.stringify(raw_transcript), id]
      );
      queue.broadcastStatus(id, 'COMPLETED', { message: 'Successfully completed AI extraction!' });
    } else if (status === 'FAILED') {
      await db.run(
        'UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, id]
      );
      queue.broadcastStatus(id, 'FAILED', { error: error || 'An error occurred during worker execution.' });
    } else {
      // For status = PROCESSING or others, update state and notify user
      await db.run(
        'UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, id]
      );
      queue.broadcastStatus(id, status, { message });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Worker callback update error:', err);
    res.status(500).json({ error: 'Failed to update job status.' });
  }
});

// Apply Auth Middleware to all Job routes
router.use(authMiddleware);

// Config Multer for dynamic vaults: /uploads/vault/user_<userId>/job_<jobId>/raw_audio.<ext>
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const jobId = uuidv4();
    req.jobId = jobId; // Store on req so route handler can access it
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const dest = path.resolve(uploadDir, 'vault', `user_${req.user.id}`, `job_${jobId}`);
    
    fs.mkdirSync(dest, { recursive: true });
    try {
      fs.writeFileSync(path.join(dest, 'metadata.json'), JSON.stringify({ originalname: file.originalname }));
    } catch (err) {
      console.error('Failed to write metadata.json:', err);
    }
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `raw_audio${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB frontend limit
});

// GET /api/jobs - List all jobs for the logged in user
router.get('/', async (req, res) => {
  try {
    const jobs = await db.all(
      'SELECT id, status, media_source, media_url, summary, chapters, raw_transcript, created_at, updated_at FROM jobs WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    
    // Parse JSON string fields back to objects for the client
    const formattedJobs = jobs.map(job => ({
      ...job,
      chapters: job.chapters ? JSON.parse(job.chapters) : null,
      raw_transcript: job.raw_transcript ? JSON.parse(job.raw_transcript) : null
    }));

    res.json(formattedJobs);
  } catch (error) {
    console.error('Fetch jobs error:', error);
    res.status(500).json({ error: 'Failed to fetch jobs.' });
  }
});

// GET /api/jobs/:id - Fetch details of a specific job
router.get('/:id', async (req, res) => {
  try {
    const job = await db.get(
      'SELECT * FROM jobs WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    res.json({
      ...job,
      chapters: job.chapters ? JSON.parse(job.chapters) : null,
      raw_transcript: job.raw_transcript ? JSON.parse(job.raw_transcript) : null
    });
  } catch (error) {
    console.error('Fetch job detail error:', error);
    res.status(500).json({ error: 'Failed to fetch job details.' });
  }
});

// POST /api/jobs/upload - Handle direct file upload (Mock S3/local mode)
router.post('/upload', upload.single('media'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No media file provided.' });
  }

  const jobId = req.jobId;
  const relativePath = path.relative(process.cwd(), req.file.path).replace(/\\/g, '/');
  // In dev mode, we pass the local file path as the media URL
  const mediaUrl = `local://${relativePath}`;

  try {
    // Insert pending job record in DB
    await db.run(
      'INSERT INTO jobs (id, user_id, status, media_source, media_url) VALUES (?, ?, ?, ?, ?)',
      [jobId, req.user.id, 'PENDING', 'UPLOAD', mediaUrl]
    );

    // Push task card to queue
    await queue.addJob(jobId, mediaUrl, req.user.id, 'UPLOAD');

    res.status(202).json({
      message: 'File upload successful. Job queued.',
      jobId
    });
  } catch (error) {
    console.error('Job upload queue error:', error);
    res.status(500).json({ error: 'Failed to queue job.' });
  }
});

// POST /api/jobs/youtube - Handle YouTube ingestion
router.post('/youtube', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'YouTube URL is required.' });
  }

  // Regex to validate typical YouTube video URLs
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=([^&\s]+)|embed\/([^\s]+)|([^\s]+))/;
  if (!youtubeRegex.test(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL structure.' });
  }

  const jobId = uuidv4();

  try {
    // Save job placeholder in DB
    await db.run(
      'INSERT INTO jobs (id, user_id, status, media_source, media_url) VALUES (?, ?, ?, ?, ?)',
      [jobId, req.user.id, 'PENDING', 'YOUTUBE', url]
    );

    // Queue the job
    await queue.addJob(jobId, url, req.user.id, 'YOUTUBE');

    res.status(202).json({
      message: 'YouTube link registered. Job queued.',
      jobId
    });
  } catch (error) {
    console.error('YouTube queue error:', error);
    res.status(500).json({ error: 'Failed to queue YouTube ingestion.' });
  }
});

// GET /api/jobs/:id/media - Streams local uploaded file securely
router.get('/:id/media', async (req, res) => {
  try {
    const job = await db.get(
      'SELECT * FROM jobs WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!job || job.media_source !== 'UPLOAD') {
      return res.status(404).json({ error: 'Media not found or not local.' });
    }

    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const folder = path.resolve(uploadDir, 'vault', `user_${req.user.id}`, `job_${job.id}`);
    
    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: 'Upload folder not found.' });
    }

    const files = fs.readdirSync(folder);
    const audioFile = files.find(f => f.startsWith('raw_audio'));

    if (!audioFile) {
      return res.status(404).json({ error: 'Media file not found.' });
    }

    const filePath = path.join(folder, audioFile);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Media streaming error:', error);
    res.status(500).json({ error: 'Failed to stream media.' });
  }
});

module.exports = router;

