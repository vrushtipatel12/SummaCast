import React, { useState } from 'react';
import API_BASE_URL from '../config';

export default function Dashboard({ jobs, user, token, onSelectJob, onRefreshJobs }) {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const API_URL = `${API_BASE_URL}/api/jobs`;

  // Format dates nicely
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Submit YouTube Link
  const handleYoutubeSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!youtubeUrl) {
      setError('Please paste a YouTube link.');
      return;
    }

    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=([^&\s]+)|embed\/([^\s]+)|([^\s]+))/;
    if (!youtubeRegex.test(youtubeUrl)) {
      setError('Please enter a valid YouTube video link structure.');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/youtube`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ url: youtubeUrl })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit YouTube link.');
      }

      setYoutubeUrl('');
      setSuccess('YouTube link queued successfully!');
      onRefreshJobs(); // Reload jobs list
      
      // Auto open the newly created job
      if (data.jobId) {
        setTimeout(() => onSelectJob(data.jobId), 1500);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // Upload Local File
  const processUpload = async (file) => {
    setError('');
    setSuccess('');

    // Ingestion Checklist 3: Frontend file limit check
    if (file.size > 100 * 1024 * 1024) {
      setError('File size exceeds the 100MB limit. Please upload a smaller audio clip.');
      return;
    }

    const formData = new FormData();
    formData.append('media', file);

    setUploading(true);

    try {
      const response = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload media file.');
      }

      setSuccess('Audio uploaded successfully and queued!');
      onRefreshJobs();
      
      if (data.jobId) {
        setTimeout(() => onSelectJob(data.jobId), 1500);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processUpload(e.target.files[0]);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="dashboard-container">
      {/* Alert Banners */}
      {error && (
        <div className="alert-banner alert-error">
          <span>⚠️</span> {error}
        </div>
      )}
      {success && (
        <div className="alert-banner alert-success">
          <span>✅</span> {success}
        </div>
      )}

      {/* Ingestion Cards */}
      <div className="upload-section">
        {/* Local File Upload Card */}
        <div className="upload-card glass-panel" onDragEnter={handleDrag}>
          <h2>Upload Local Podcast</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Directly upload audio/video tracks to generate structured summaries.
          </p>
          
          <div 
            className={`upload-drag-area ${dragActive ? 'active' : ''}`}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-upload-input').click()}
          >
            <div className="upload-icon">📥</div>
            <p style={{ fontWeight: 500 }}>
              {uploading ? 'Uploading media track...' : 'Drag & drop media file here or browse'}
            </p>
            <span className="upload-file-limit">Supports MP3, MP4, M4A up to 100MB</span>
            <input 
              type="file" 
              id="file-upload-input" 
              style={{ display: 'none' }} 
              accept="audio/*,video/*"
              onChange={handleFileChange}
              disabled={uploading}
            />
          </div>
        </div>

        {/* YouTube Link Ingest Card */}
        <div className="upload-card glass-panel" style={{ justifyContent: 'center' }}>
          <h2>YouTube Ingestion</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '20px' }}>
            Paste a public YouTube link to stream audio directly into the cloud.
          </p>
          
          <form onSubmit={handleYoutubeSubmit} style={{ width: '100%' }}>
            <div className="youtube-input-wrapper">
              <input 
                type="text" 
                className="form-input" 
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                disabled={uploading}
              />
              <button 
                type="submit" 
                className="btn-primary" 
                style={{ width: 'auto', padding: '0 24px' }}
                disabled={uploading}
              >
                Ingest URL
              </button>
            </div>
          </form>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '16px' }}>
            We'll extract the audio stream background layer to conserve cloud memory.
          </p>
        </div>
      </div>

      {/* History Grid */}
      <div>
        <h2 className="jobs-section-title">Media Vault Records</h2>
        
        {jobs.length === 0 ? (
          <div className="glass-panel" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>📁</div>
            <h3>Your Media Vault is empty</h3>
            <p style={{ marginTop: '8px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Upload an audio file or insert a YouTube link above to start analyzing.
            </p>
          </div>
        ) : (
          <div className="jobs-grid">
            {jobs.map((job) => (
              <div 
                key={job.id} 
                className="job-card glass-panel" 
                onClick={() => onSelectJob(job.id)}
              >
                <div className="job-card-header">
                  <span className="job-source-badge">{job.media_source}</span>
                  <span className={`job-status-badge status-${job.status.toLowerCase()}`}>
                    {job.status}
                  </span>
                </div>
                
                <h3 className="job-title" title={job.media_url}>
                  {job.media_source === 'UPLOAD' 
                    ? `Upload: ${job.media_url.split('/').pop()}` 
                    : job.media_url
                  }
                </h3>
                
                {job.summary ? (
                  <p style={{ 
                    color: 'var(--text-secondary)', 
                    fontSize: '0.85rem', 
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: '1.5'
                  }}>
                    {job.summary}
                  </p>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                    {job.status === 'FAILED' ? 'Processing failed. Click to see details.' : 'AI analysis in progress...'}
                  </p>
                )}

                <div className="job-date">
                  {formatDate(job.created_at || job.updated_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
