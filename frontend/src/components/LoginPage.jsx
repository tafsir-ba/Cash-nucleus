import { useState } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const LoginPage = ({ onLogin }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await axios.post(
        `${API}/auth/login`,
        { email, password },
        { withCredentials: true }
      );
      onLogin(data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === "string") {
        setError(detail);
      } else if (Array.isArray(detail)) {
        setError(detail.map(e => e.msg || JSON.stringify(e)).join(" "));
      } else {
        setError("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4" data-testid="login-page">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 font-heading">
            Cash Pilot
          </h1>
          <p className="text-zinc-600 text-sm mt-1">Financial Decision Cockpit</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4" data-testid="login-form">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-lg px-4 py-3" data-testid="login-error">
              {error}
            </div>
          )}

          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full bg-zinc-900 border border-zinc-800 text-sm rounded-lg px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600 focus:border-zinc-600 transition-colors"
              required
              autoFocus
              data-testid="login-email-input"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full bg-zinc-900 border border-zinc-800 text-sm rounded-lg px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600 focus:border-zinc-600 transition-colors"
              required
              data-testid="login-password-input"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full bg-zinc-100 text-zinc-900 hover:bg-white font-medium py-3 rounded-lg transition-all duration-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="login-submit-btn"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="text-center text-zinc-700 text-xs mt-8">
          Protected access only
        </p>
      </div>
    </div>
  );
};
