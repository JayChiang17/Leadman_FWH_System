import { useState, useEffect, useContext } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AuthCtx } from "./AuthContext";
import api from "../services/api";
import "./Login.css";

export default function Login() {
  const { login } = useContext(AuthCtx);
  const nav = useNavigate();
  const location = useLocation();
  const redirect = location.state?.from?.pathname || "/";

  /* local state */
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  /* 進入 / 離開頁面時加背景 class */
  useEffect(() => {
    document.body.classList.add("login-body");
    return () => document.body.classList.remove("login-body");
  }, []);

  /* ---------- 提交 ---------- */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const { data } = await api.post(
        "/auth/token",
        new URLSearchParams({
          username,
          password,
          grant_type: "password",
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );

      /* 交給 AuthContext 解析/保存 JWT */
      login(data.access_token, data.refresh_token);
      nav(redirect, { replace: true });

    } catch (err) {
      setError(
        err.response?.status === 401
          ? "Invalid username or password"
          : "Server error – please try again"
      );
    } finally {
      setIsLoading(false);
    }
  };

  /* ---------- UI ---------- */
  return (
    <div className="login-wrapper">
      <form onSubmit={handleSubmit} className="glass-card">
        <h2 className="login-title">System Login</h2>

        <input
          className="login-input"
          placeholder="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={isLoading}
        />

        <input
          className="login-input"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isLoading}
        />

        {error && <p className="login-error">{error}</p>}
        
        <button 
          className="login-button" 
          disabled={!username || !password || isLoading}
        >
          {isLoading ? "Logging in..." : "Log In"}
        </button>
      </form>
    </div>
  );
}