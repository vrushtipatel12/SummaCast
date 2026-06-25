require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./db');
const queue = require('./queue');

const authRoutes = require('./routes/auth');
const jobsRoutes = require('./routes/jobs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow Netlify frontend / local Vite connection
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;

// Enable Middlewares
app.use(cors());
app.use(express.json());

// Set socket.io instance in queue orchestrator
queue.setIo(io);

// Mount API Routes
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobsRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: process.env.DB_TYPE || 'sqlite', time: new Date() });
});

// Socket.io Connection Room Setup
io.on('connection', (socket) => {
  console.log(`[WebSocket] Client connected: ${socket.id}`);
  
  socket.on('join_job', (jobId) => {
    socket.join(`job_${jobId}`);
    console.log(`[WebSocket] Client ${socket.id} joined room: job_${jobId}`);
    socket.emit('joined', { room: `job_${jobId}` });
  });

  socket.on('disconnect', () => {
    console.log(`[WebSocket] Client disconnected: ${socket.id}`);
  });
});

// Initialize server
async function startServer() {
  try {
    await db.init();
    server.listen(PORT, () => {
      console.log(`🚀 SummaCast Backend running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    });
  } catch (error) {
    console.error('Fatal: Failed to start backend server:', error);
    process.exit(1);
  }
}

startServer();
