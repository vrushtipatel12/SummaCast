import React, { useState } from 'react';
import API_BASE_URL from '../config';

export default function Auth({ onAuthSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const API_URL = `${API_BASE_URL}/api/auth`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    
    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }

    if (isRegister && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const endpoint = isRegister ? '/register' : '/login';
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong.');
      }

      if (isRegister) {
        setMessage('Registration successful! You can now log in.');
        setIsRegister(false);
        setPassword('');
        setConfirmPassword('');
      } else {
        // Logged in!
        onAuthSuccess({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          user: data.user
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card glass-panel">
        <div className="auth-header">
          <div className="auth-logo">SummaCast</div>
          <p className="auth-subtitle">
            {isRegister ? 'Create an account to transcribe & summarize' : 'Sign in to access your media vault'}
          </p>
        </div>

        {error && (
          <div className="alert-banner alert-error" style={{ marginBottom: '20px' }}>
            <span>⚠️</span> {error}
          </div>
        )}

        {message && (
          <div className="alert-banner alert-success" style={{ marginBottom: '20px' }}>
            <span>✅</span> {message}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {isRegister && (
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                type="password"
                id="confirmPassword"
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
          )}

          <button type="submit" className="btn-primary" style={{ marginTop: '10px' }} disabled={loading}>
            {loading ? 'Processing...' : isRegister ? 'Register Account' : 'Sign In'}
          </button>
        </form>

        <div className="auth-toggle">
          {isRegister ? (
            <>
              Already have an account? 
              <span className="auth-toggle-link" onClick={() => { setIsRegister(false); setError(''); }}>Sign In</span>
            </>
          ) : (
            <>
              Don't have an account? 
              <span className="auth-toggle-link" onClick={() => { setIsRegister(true); setError(''); }}>Create one</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
