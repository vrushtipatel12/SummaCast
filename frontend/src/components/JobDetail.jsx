import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import API_BASE_URL from '../config';

export default function JobDetail({ jobId, token, onBack, onRefreshJobs }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [socketStatus, setSocketStatus] = useState('');
  const [socketError, setSocketError] = useState('');
  const [activeTab, setActiveTab] = useState('summary');
  const [searchQuery, setSearchQuery] = useState('');
  const [openChapterIndex, setOpenChapterIndex] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);

  // Player references
  const videoRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytIntervalRef = useRef(null);

  const API_URL = `${API_BASE_URL}/api/jobs`;

  // Fetch job details
  const fetchJob = async () => {
    try {
      const response = await fetch(`${API_URL}/${jobId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch job.');
      }
      
      setJob(data);
      if (data.status === 'COMPLETED' || data.status === 'FAILED') {
        setLoading(false);
      }
    } catch (err) {
      setSocketError(err.message);
      setLoading(false);
    }
  };

  // 1. WebSocket progress listener
  useEffect(() => {
    fetchJob();

    const socket = io(API_BASE_URL);
    
    // Connect & subscribe to job room
    socket.on('connect', () => {
      socket.emit('join_job', jobId);
    });

    socket.on('status_update', (data) => {
      if (data.jobId === jobId) {
        setSocketStatus(data.message || data.status);
        
        // If job completed or failed, update state
        if (data.status === 'COMPLETED') {
          setSocketStatus('Finished!');
          setTimeout(() => {
            fetchJob();
            onRefreshJobs();
          }, 1000);
        } else if (data.status === 'FAILED') {
          setSocketError(data.error || 'Worker execution failed.');
          setLoading(false);
          fetchJob();
          onRefreshJobs();
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [jobId]);

  // 2. YouTube Iframe API Loader
  useEffect(() => {
    if (!job || job.status !== 'COMPLETED' || job.media_source !== 'YOUTUBE') return;

    const ytId = getYoutubeId(job.media_url);
    if (!ytId) return;

    // Callback when API is ready
    window.onYouTubeIframeAPIReady = () => {
      ytPlayerRef.current = new window.YT.Player('yt-player-frame', {
        height: '100%',
        width: '100%',
        videoId: ytId,
        playerVars: {
          enablejsapi: 1,
          origin: window.location.origin
        },
        events: {
          onReady: (event) => {
            console.log('YouTube Player Ready');
            // Check for initial time in query params
            const params = new URLSearchParams(window.location.search);
            const timeParam = params.get('t');
            if (timeParam) {
              const sec = parseInt(timeParam, 10);
              event.target.seekTo(sec, true);
            }
            
            // Track playback time
            ytIntervalRef.current = setInterval(() => {
              if (ytPlayerRef.current && ytPlayerRef.current.getCurrentTime) {
                const cur = ytPlayerRef.current.getCurrentTime();
                setCurrentTime(cur);
                savePlaybackTime(cur);
              }
            }, 1500);
          }
        }
      });
    };

    // Load script if not already loaded
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    } else {
      window.onYouTubeIframeAPIReady();
    }

    return () => {
      if (ytIntervalRef.current) {
        clearInterval(ytIntervalRef.current);
      }
    };
  }, [job]);

  // Track HTML5 video progress
  const handleHtml5TimeUpdate = () => {
    if (videoRef.current) {
      const cur = videoRef.current.currentTime;
      setCurrentTime(cur);
      savePlaybackTime(cur);
    }
  };

  // Restore HTML5 time on metadata load
  const handleHtml5LoadedMetadata = () => {
    const params = new URLSearchParams(window.location.search);
    const timeParam = params.get('t');
    if (timeParam && videoRef.current) {
      videoRef.current.currentTime = parseInt(timeParam, 10);
    }
  };

  // Helper: Extract YouTube ID
  const getYoutubeId = (url) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  // Helper: Format seconds to MM:SS
  const formatSeconds = (seconds) => {
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  // Helper: Parse MM:SS to seconds
  const parseTimeToSeconds = (timeStr) => {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return Number(timeStr) || 0;
  };

  // Save current time to query params
  const savePlaybackTime = (seconds) => {
    const sec = Math.floor(seconds);
    const url = new URL(window.location);
    url.searchParams.set('t', sec);
    window.history.replaceState({}, '', url);
  };

  // Core Click-to-Seek Synchronization
  const handleSeek = (timestamp) => {
    const seconds = parseTimeToSeconds(timestamp);
    
    if (job.media_source === 'YOUTUBE' && ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(seconds, true);
      ytPlayerRef.current.playVideo();
    } else if (job.media_source === 'UPLOAD' && videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(e => console.log('Autoplay blocked:', e));
    }
  };

  // Highlight search terms safely
  const highlightText = (text, highlight) => {
    if (!highlight.trim()) return text;
    const regex = new RegExp(`(${highlight})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, index) => 
      regex.test(part) ? <mark key={index}>{part}</mark> : part
    );
  };

  // Clipboard Copiers
  const handleCopySummary = () => {
    navigator.clipboard.writeText(job.summary);
    alert('Summary copied to clipboard!');
  };

  const handleCopyChapters = () => {
    const text = job.chapters
      .map(c => `${c.timestamp} - ${c.title}\n${c.bullets.map(b => `• ${b}`).join('\n')}`)
      .join('\n\n');
    navigator.clipboard.writeText(text);
    alert('YouTube chapters copied to clipboard!');
  };

  // Loading socket state screen
  if (loading || (job && (job.status === 'PENDING' || job.status === 'PROCESSING'))) {
    return (
      <div className="loading-dashboard">
        <div className="spinner-outer"></div>
        <h2 className="progress-stage-title">Analyzing Your Media</h2>
        <div className="glass-panel" style={{ width: '100%', padding: '24px' }}>
          <p className="progress-subtitle" style={{ fontWeight: '500', color: 'var(--color-primary)' }}>
            Status: {socketStatus || (job ? job.status : 'Connecting...')}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '12px' }}>
            We're extracting the audio track, parsing speech-to-text with Whisper, and structuring summaries with GPT-4o. This takes up to 45 seconds.
          </p>
        </div>
        <button className="btn-logout" onClick={onBack}>Cancel & Return</button>
      </div>
    );
  }

  // Error screen
  if (socketError || (job && job.status === 'FAILED')) {
    return (
      <div className="loading-dashboard" style={{ color: '#f87171' }}>
        <div style={{ fontSize: '4rem' }}>⚠️</div>
        <h2>Analysis Failed</h2>
        <div className="glass-panel alert-error" style={{ width: '100%', padding: '24px', textAlign: 'left' }}>
          <h4>Error Details:</h4>
          <p style={{ marginTop: '8px', fontSize: '0.9rem' }}>
            {socketError || job.raw_transcript || 'Worker timed out during speech processing.'}
          </p>
        </div>
        <button className="btn-primary" onClick={onBack} style={{ width: 'auto', padding: '12px 30px' }}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  // Loaded Detail View
  const localMediaSrc = `${API_BASE_URL}/api/jobs/${job.id}/media?token=${token}`; // Fetch auth direct stream

  return (
    <div className="detail-container">
      {/* LEFT: Media Player Pane */}
      <div className="detail-left">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="btn-logout" onClick={onBack}>← Back</button>
          <h2 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {job.media_source === 'UPLOAD' ? 'Uploaded Episode' : 'YouTube Broadcast'}
          </h2>
        </div>

        <div className="player-container glass-panel">
          <div className="player-aspect">
            {job.media_source === 'YOUTUBE' ? (
              <div id="yt-player-frame" style={{ width: '100%', height: '100%' }}></div>
            ) : (
              <video 
                ref={videoRef} 
                src={localMediaSrc} 
                controls 
                onTimeUpdate={handleHtml5TimeUpdate}
                onLoadedMetadata={handleHtml5LoadedMetadata}
              />
            )}
          </div>
          <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Source Link: <a href={job.media_url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>Link</a>
            </span>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, fontFamily: 'var(--font-display)', color: 'var(--color-accent)' }}>
              Time: {formatSeconds(currentTime)}
            </span>
          </div>
        </div>
      </div>

      {/* RIGHT: Tabs Analytics Pane */}
      <div className="detail-right glass-panel">
        <div className="detail-card-header" style={{ padding: '12px 24px', gap: '8px' }}>
          <button 
            className={`btn-icon ${activeTab === 'summary' ? 'active' : ''}`}
            onClick={() => setActiveTab('summary')}
            style={{ flex: 1, background: activeTab === 'summary' ? 'var(--color-primary)' : '' }}
          >
            Summary
          </button>
          <button 
            className={`btn-icon ${activeTab === 'chapters' ? 'active' : ''}`}
            onClick={() => setActiveTab('chapters')}
            style={{ flex: 1, background: activeTab === 'chapters' ? 'var(--color-primary)' : '' }}
          >
            Chapters
          </button>
          <button 
            className={`btn-icon ${activeTab === 'transcript' ? 'active' : ''}`}
            onClick={() => setActiveTab('transcript')}
            style={{ flex: 1, background: activeTab === 'transcript' ? 'var(--color-primary)' : '' }}
          >
            Transcript
          </button>
        </div>

        {/* Tab 1: Summary */}
        {activeTab === 'summary' && (
          <div className="detail-card-content" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Executive AI Summary</h3>
              <button className="btn-icon" onClick={handleCopySummary}>📋 Copy</button>
            </div>
            <p className="summary-text">{job.summary}</p>
          </div>
        )}

        {/* Tab 2: Accordion Chapters */}
        {activeTab === 'chapters' && (
          <div className="detail-card-content" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Chronological Chapters</h3>
              <button className="btn-icon" onClick={handleCopyChapters}>📋 Copy Description</button>
            </div>
            
            <div className="accordion-wrapper">
              {job.chapters && job.chapters.map((chapter, idx) => (
                <div 
                  key={idx} 
                  className={`accordion-item ${openChapterIndex === idx ? 'active' : ''}`}
                >
                  <div className="accordion-header">
                    <div className="accordion-header-left">
                      <span 
                        className="timestamp-seek-badge" 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSeek(chapter.timestamp);
                        }}
                      >
                        ⏱️ {chapter.timestamp}
                      </span>
                      <span className="accordion-title" onClick={() => setOpenChapterIndex(openChapterIndex === idx ? null : idx)}>
                        {chapter.title}
                      </span>
                    </div>
                    <span 
                      className="accordion-toggle-icon"
                      onClick={() => setOpenChapterIndex(openChapterIndex === idx ? null : idx)}
                    >
                      ▼
                    </span>
                  </div>
                  
                  <div className="accordion-content">
                    <ul className="accordion-bullets">
                      {chapter.bullets && chapter.bullets.map((bullet, bidx) => (
                        <li key={bidx}>{bullet}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: Transcript Search Panel */}
        {activeTab === 'transcript' && (
          <div className="transcript-card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="search-box-wrapper">
              <input 
                type="text" 
                className="search-input" 
                placeholder="Search transcript phrases (e.g. Indexing)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <div className="transcript-body">
              {job.raw_transcript && job.raw_transcript
                .filter(seg => seg.text.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((seg, idx) => {
                  const isActive = currentTime >= seg.start && currentTime <= seg.end;
                  return (
                    <div 
                      key={idx} 
                      className={`transcript-segment ${isActive ? 'active-playing' : ''}`}
                    >
                      <span 
                        className="segment-time"
                        onClick={() => handleSeek(formatSeconds(seg.start))}
                      >
                        {formatSeconds(seg.start)} 🔊
                      </span>
                      <p className="segment-text">
                        {highlightText(seg.text, searchQuery)}
                      </p>
                    </div>
                  );
                })}
              
              {job.raw_transcript && job.raw_transcript.filter(seg => seg.text.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '20px' }}>
                  No transcript segments match your search word.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
