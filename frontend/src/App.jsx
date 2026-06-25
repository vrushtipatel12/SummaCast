import React, { useState, useEffect } from 'react';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import JobDetail from './components/JobDetail';
import API_BASE_URL from './config';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('summacast_token') || '');
  const [refreshToken, setRefreshToken] = useState(localStorage.getItem('summacast_refresh_token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('summacast_user') || 'null'));
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);

  const API_URL = `${API_BASE_URL}/api/jobs`;

  // Fetch jobs for current user
  const fetchJobs = async () => {
    if (!token) return;
    try {
      const response = await fetch(API_URL, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok) {
        setJobs(data);
      } else {
        if (data.code === 'TOKEN_EXPIRED') {
          handleTokenRefresh();
        }
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    }
  };

  // Handle Token Refreshing
  const handleTokenRefresh = async () => {
    if (!refreshToken) {
      handleLogout();
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('summacast_token', data.accessToken);
        localStorage.setItem('summacast_refresh_token', data.refreshToken);
        setToken(data.accessToken);
        setRefreshToken(data.refreshToken);
      } else {
        handleLogout();
      }
    } catch (err) {
      console.error('Refresh token error:', err);
      handleLogout();
    }
  };

  // Fetch jobs when logged in
  useEffect(() => {
    if (token) {
      fetchJobs();
      // Periodically refresh list to update pending status (polling as backup to WebSocket)
      const interval = setInterval(fetchJobs, 10000);
      return () => clearInterval(interval);
    }
  }, [token]);

  // Handle URL Timestamp Navigation
  useEffect(() => {
    // If the URL has a job_id query parameter, we can open that job details immediately
    const params = new URLSearchParams(window.location.search);
    const jobParam = params.get('job');
    if (jobParam && token) {
      setSelectedJobId(jobParam);
    }
  }, [token]);

  // Auth Success hook
  const handleAuthSuccess = ({ accessToken, refreshToken, user }) => {
    localStorage.setItem('summacast_token', accessToken);
    localStorage.setItem('summacast_refresh_token', refreshToken);
    localStorage.setItem('summacast_user', JSON.stringify(user));
    
    setToken(accessToken);
    setRefreshToken(refreshToken);
    setUser(user);
  };

  // Logout session
  const handleLogout = () => {
    localStorage.removeItem('summacast_token');
    localStorage.removeItem('summacast_refresh_token');
    localStorage.removeItem('summacast_user');
    
    setToken('');
    setRefreshToken('');
    setUser(null);
    setJobs([]);
    setSelectedJobId(null);
    
    // Clear URL parameters
    const url = new URL(window.location);
    url.searchParams.delete('job');
    url.searchParams.delete('t');
    window.history.replaceState({}, '', url);
  };

  // Job selection hook
  const handleSelectJob = (jobId) => {
    setSelectedJobId(jobId);
    
    // Sync URL parameter so reloading lands on the same job
    const url = new URL(window.location);
    url.searchParams.set('job', jobId);
    window.history.replaceState({}, '', url);
  };

  // Return to list view
  const handleCloseJobDetail = () => {
    setSelectedJobId(null);
    
    // Clear URL parameter
    const url = new URL(window.location);
    url.searchParams.delete('job');
    url.searchParams.delete('t');
    window.history.replaceState({}, '', url);
    
    fetchJobs(); // Refresh jobs
  };

  return (
    <div>
      {/* Header Panel */}
      <header className="app-header glass-panel" style={{ borderBottomLeftRadius: '0', borderBottomRightRadius: '0' }}>
        <h1 className="app-logo" onClick={handleCloseJobDetail}>SummaCast: AI-Based Audio and Video Content Analysis Platform</h1>
        {user && (
          <div className="user-profile">
            <span className="user-email">{user.email}</span>
            <button className="btn-logout" onClick={handleLogout}>Log Out</button>
          </div>
        )}
      </header>

      {/* Main Body Routing */}
      <main>
        {!token ? (
          <Auth onAuthSuccess={handleAuthSuccess} />
        ) : selectedJobId ? (
          <JobDetail 
            jobId={selectedJobId} 
            token={token} 
            onBack={handleCloseJobDetail}
            onRefreshJobs={fetchJobs}
          />
        ) : (
          <Dashboard 
            jobs={jobs} 
            user={user}
            token={token}
            onSelectJob={handleSelectJob}
            onRefreshJobs={fetchJobs}
          />
        )}
      </main>
    </div>
  );
}
