import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Brand, Icon } from "./icons.jsx";
import "./login.css";

const messages = {
  INVALID_LOGIN: ["Incorrect username or password.", "用户名或密码不正确。"],
  INVALID_CREDENTIALS: [
    "Use a username of 3–64 letters, digits, dots, dashes or underscores, and a unique password of 15–128 characters.",
    "用户名须为 3–64 个英文字母、数字、点、短横线或下划线，密码须为 15–128 个字符。",
  ],
  TOO_MANY_ATTEMPTS: [
    "Too many attempts. Try again in 15 minutes.",
    "尝试次数过多，请在 15 分钟后重试。",
  ],
  SETUP_CLOSED: [
    "An administrator already exists. Reload to sign in.",
    "管理员账号已存在。请刷新后登录。",
  ],
  unavailable: [
    "Cannot verify access right now. Check your connection and try again.",
    "暂时无法验证访问权限。请检查网络后重试。",
  ],
};

function Login() {
  const [language, setLanguage] = useState(() => {
    try {
      return localStorage.getItem("rhythm.language") === "zh" ? "zh" : "en";
    } catch {
      return "en";
    }
  });
  const t = (en, zh) => (language === "zh" ? zh : en);
  const [setup, setSetup] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [remember, setRemember] = useState(true);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    try {
      localStorage.setItem("rhythm.language", language);
    } catch {}
  }, [language]);
  async function load() {
    setError("");
    setReady(false);
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error();
      const state = await response.json();
      if (state.authenticated) {
        location.replace("/");
        return;
      }
      setSetup(state.setupRequired === true);
      setReady(true);
    } catch {
      setError("unavailable");
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (!ready || busy) return;
    if (setup && password !== confirmation) {
      setError("mismatch");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        setup ? "/api/auth/setup" : "/api/auth/login",
        {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
          headers: {
            "Content-Type": "application/json",
            "X-Rhythm-Request": "1",
          },
          body: JSON.stringify({ username, password, remember }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setPassword("");
      setConfirmation("");
      location.replace("/");
    } catch (failure) {
      setError(messages[failure.message] ? failure.message : "unavailable");
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand />
        <div className="story-content">
          <div className="login-eyebrow">
            {t("A SPACE TO GROW", "成长的空间")}
          </div>
          <h1>
            {t("Small steps.", "小小步伐。")}
            <br />
            {t("Your rhythm.", "你的节奏。")}
          </h1>
          <p>
            {t(
              "Make room for the things that make you feel like you. One day, one little habit at a time.",
              "为那些让你成为自己的事留出空间。每一天，每一个小习惯。",
            )}
          </p>
          <div className="story-art" aria-hidden="true">
            <span className="art-line" />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <span className="art-label">
              MON · TUE · WED · THU · FRI · SAT · SUN
            </span>
          </div>
          <div className="story-footer">
            <Icon name="leaf" size={18} />
            {t(
              "Progress is a practice, not a destination.",
              "进步来自实践，而不是终点。",
            )}
          </div>
        </div>
        <span className="story-bottom">
          RHYTHM — {t("ONE DAY AT A TIME", "一天一步")}
        </span>
      </section>
      <section className="login-panel">
        <div className="login-top">
          <span className="mobile-brand">
            <Brand />
          </span>
          <label>
            <span className="sr-only">Language</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value="en">English</option>
              <option value="zh">简体中文</option>
            </select>
          </label>
        </div>
        <div className="login-form-container">
          <span className="login-leaf">
            <Icon name="leaf" size={28} />
          </span>
          <div className="login-eyebrow">
            {t("YOUR PRIVATE JOURNAL", "你的私人日记")}
          </div>
          <h2>
            {setup
              ? t("Make it yours.", "开启你的专属空间。")
              : t("Welcome back.", "欢迎回来。")}
          </h2>
          <p>
            {setup
              ? t(
                  "Create your administrator account to begin.",
                  "创建管理员账号，开始记录。",
                )
              : t(
                  "Sign in and pick up where you left off.",
                  "登录，继续你的每一天。",
                )}
          </p>
          <form onSubmit={submit}>
            <label htmlFor="username">{t("Username", "用户名")}</label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              pattern="[A-Za-z0-9_.-]{3,64}"
              minLength={3}
              maxLength={64}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              placeholder={t("Your username", "你的用户名")}
              disabled={busy}
            />
            <label htmlFor="password">{t("Password", "密码")}</label>
            <div className="password-input">
              <input
                id="password"
                name="password"
                autoComplete={setup ? "new-password" : "current-password"}
                type={visible ? "text" : "password"}
                minLength={setup ? 15 : 1}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={busy}
                placeholder={t("Enter your password", "输入密码")}
              />
              <button
                type="button"
                onClick={() => setVisible(!visible)}
                aria-label={
                  visible
                    ? t("Hide password", "隐藏密码")
                    : t("Show password", "显示密码")
                }
              >
                {visible ? t("Hide", "隐藏") : t("Show", "显示")}
              </button>
            </div>
            {setup && (
              <>
                <p className="password-hint">
                  {t(
                    "Choose a unique passphrase of 15–128 characters.",
                    "请选择 15–128 个字符的独有密码。",
                  )}
                </p>
                <label htmlFor="confirm">
                  {t("Confirm password", "确认密码")}
                </label>
                <input
                  id="confirm"
                  name="confirm"
                  autoComplete="new-password"
                  type={visible ? "text" : "password"}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                  minLength={15}
                  maxLength={128}
                  disabled={busy}
                />
              </>
            )}
            <label className="remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                disabled={busy}
              />
              <span>{t("Remember me for 30 days", "记住我 30 天")}</span>
            </label>
            {error && (
              <div className="login-error" role="alert">
                {error === "mismatch"
                  ? t("The passwords do not match.", "两次输入的密码不一致。")
                  : t(...(messages[error] || messages.unavailable))}
                {!ready && (
                  <button type="button" onClick={load}>
                    {t("Try again", "重试")}
                  </button>
                )}
              </div>
            )}
            <button
              type="submit"
              className="login-submit"
              disabled={!ready || busy}
            >
              {busy || !ready ? (
                <>
                  <span className="spinner" />
                  {t("Please wait…", "请稍候…")}
                </>
              ) : (
                <>
                  {setup
                    ? t("Create account", "创建账号")
                    : t("Sign in", "登录")}
                  <Icon name="arrow" size={18} />
                </>
              )}
            </button>
          </form>
          <div className="login-note">
            <Icon name="journal" size={18} />
            <p>
              {t(
                "Your habits are saved to your account. Open the same journal from any browser.",
                "习惯保存在账号中，可在任何浏览器打开同一份日记。",
              )}
            </p>
          </div>
        </div>
        <footer className="login-bottom">
          {t("A little better, every day.", "每天进步一点点。")}
        </footer>
      </section>
    </main>
  );
}
createRoot(document.getElementById("auth-root")).render(<Login />);
