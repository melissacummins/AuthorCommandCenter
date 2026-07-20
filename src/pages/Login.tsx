import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { BookOpen, Mail, Lock, User, ArrowRight } from 'lucide-react';

export default function Login() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    if (isSignUp) {
      const result = await signUpWithEmail(email, password, fullName);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess('Account created! Check your email to confirm, then sign in.');
        setIsSignUp(false);
      }
    } else {
      const result = await signInWithEmail(email, password);
      if (result.error) {
        setError(result.error);
      }
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-card mb-4 shadow-lg shadow-amber-500/25">
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Author Command Center</h1>
          <p className="text-content-muted mt-2">Your publishing business, unified</p>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-card shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-content mb-6">
            {isSignUp ? 'Create Account' : 'Welcome Back'}
          </h2>

          {/* Google Sign In */}
          <button
            onClick={signInWithGoogle}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 border-2 border-edge rounded-card hover:bg-surface-hover transition-colors font-medium text-content"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center my-6">
            <div className="flex-1 border-t border-edge"></div>
            <span className="px-4 text-sm text-content-muted">or</span>
            <div className="flex-1 border-t border-edge"></div>
          </div>

          {/* Email Form */}
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            {isSignUp && (
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
                <input
                  type="text"
                  placeholder="Full Name"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 border-2 border-edge rounded-card focus:border-amber-500 focus:outline-none transition-colors"
                  required
                />
              </div>
            )}
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full pl-11 pr-4 py-3 border-2 border-edge rounded-card focus:border-amber-500 focus:outline-none transition-colors"
                required
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full pl-11 pr-4 py-3 border-2 border-edge rounded-card focus:border-amber-500 focus:outline-none transition-colors"
                required
                minLength={6}
              />
            </div>

            {error && (
              <p className="text-red-600 text-sm bg-red-50 px-4 py-2 rounded-control">{error}</p>
            )}
            {success && (
              <p className="text-green-600 text-sm bg-green-50 px-4 py-2 rounded-control">{success}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-white font-semibold rounded-card hover:from-amber-600 hover:to-amber-700 transition-all disabled:opacity-50 shadow-lg shadow-amber-500/25"
            >
              {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Toggle */}
          <p className="text-center text-sm text-content-secondary mt-6">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              onClick={() => { setIsSignUp(!isSignUp); setError(null); setSuccess(null); }}
              className="text-amber-600 font-semibold hover:text-amber-700"
            >
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
