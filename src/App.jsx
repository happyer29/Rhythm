import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createJournalStore } from "./journal-store.js";
import {
  todayKey,
  validDay,
  shiftDay,
  entryFor,
  emptyEntry,
  dailyHabits,
  daySummary,
  habitProgress,
  habitStats,
  journalStats,
  formatMinutes,
  parseJournal,
  hasValue,
} from "./journal.js";
import HabitEditor from "./components/HabitEditor.jsx";
import DurationEditor from "./components/DurationEditor.jsx";
import EntryControl from "./components/EntryControl.jsx";
import Modal from "./components/Modal.jsx";
import { useConfirm } from "./components/Confirmation.jsx";
import { Brand, Icon, habitIcon } from "./icons.jsx";

const store = createJournalStore(window.rhythmAccountStorage);
const preference = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};
const color = (habit) =>
  /^[0-9a-f]{6}$/i.test(habit.colorHex) ? `#${habit.colorHex}` : "#19796b";
const civilDate = (day) => new Date(`${day}T12:00:00`);
const percentage = (value) =>
  Math.round(Math.max(0, Math.min(1, value || 0)) * 100);
const kindName = (kind, t) =>
  ({
    check: t("Check-in", "打卡"),
    single: t("Choose one", "单选"),
    multiple: t("Choose many", "多选"),
    duration: t("Time", "时长"),
    number: t("Number", "数值"),
    text: t("Reflection", "文字"),
  })[kind];

function errorMessage(error, t) {
  if (error?.code === "conflict")
    return t(
      "Another tab saved a newer journal. Export your draft, then load the saved version.",
      "其他标签页已保存更新的日记。请先导出草稿，再加载已保存版本。",
    );
  if (error?.code === "quota" || error?.message === "JOURNAL_TOO_LARGE")
    return t(
      "This journal exceeds the account storage limit. Export a backup before making changes.",
      "日记已超出存储限制。更改前请导出备份。",
    );
  if (error?.code === "unsupported-number")
    return t(
      "Update your browser to open this backup without changing its numeric values.",
      "请更新浏览器，以便完整保留备份中的数值。",
    );
  if (error?.code === "invalid" || error?.message === "INVALID_JOURNAL")
    return t(
      "This data could not be saved. Check the values and the backup format.",
      "无法保存这些数据。请检查数值和备份格式。",
    );
  return t(
    "Your journal could not be saved or loaded. Check your connection. Unsaved changes remain in this tab.",
    "无法保存或加载日记。请检查网络连接，未保存的更改仍在此标签页中。",
  );
}

export default function App() {
  const confirm = useConfirm();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [language, setLanguage] = useState(() =>
    preference("rhythm.language", "en") === "zh" ? "zh" : "en",
  );
  const [theme, setTheme] = useState(() =>
    preference("rhythm.theme", "light") === "dark" ? "dark" : "light",
  );
  const t = useCallback((en, zh) => (language === "zh" ? zh : en), [language]);
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [today, setToday] = useState(todayKey);
  const [day, setDay] = useState(todayKey);
  const [view, setView] = useState("journal");
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view, day]);
  const [search, setSearch] = useState("");
  const [archive, setArchive] = useState(false);
  const [editor, setEditor] = useState(null);
  const [duration, setDuration] = useState(null);
  const [detail, setDetail] = useState(null);
  const [importing, setImporting] = useState(null);
  const [notice, setNotice] = useState(null);
  const [draftCount, setDraftCount] = useState(0);
  const [entryEpoch, setEntryEpoch] = useState(0);
  const [entryResets, setEntryResets] = useState({});
  const drafts = useRef(new Set());
  const noticeTimer = useRef();
  const [range, setRange] = useState(30);
  const [year, setYear] = useState(() => Number(todayKey().slice(0, 4)));
  const [filterHabit, setFilterHabit] = useState("");
  const journal = state.journal;
  const busy = state.loading || !state.ready;
  const stats = useMemo(() => journalStats(journal, today), [journal, today]);
  const summary = useMemo(() => daySummary(journal, day), [journal, day]);
  const visibleHabits = dailyHabits(journal, day, today).filter((habit) =>
    habit.title.toLowerCase().includes(search.toLowerCase()),
  );
  const activeCount = journal.habits.filter(
    (habit) => !habit.archivedOn,
  ).length;
  const dirty = state.unsaved || draftCount > 0;
  const notify = useCallback((text, action) => {
    clearTimeout(noticeTimer.current);
    setNotice({ text, action });
    noticeTimer.current = setTimeout(
      () => setNotice(null),
      action ? 12000 : 6000,
    );
  }, []);
  const setDraft = useCallback((key, value) => {
    if (value) drafts.current.add(key);
    else drafts.current.delete(key);
    setDraftCount(drafts.current.size);
  }, []);
  const resetFormDrafts = () => {
    drafts.current.clear();
    setDraftCount(0);
    setEntryEpoch((value) => value + 1);
  };
  const canNavigate = async () => {
    if (!drafts.current.size) return true;
    if (
      !(await confirm({
        title: t("Discard unsaved changes?", "放弃未保存的更改？"),
        message: t(
          "Discard the changes you have not submitted in this form?",
          "放弃表单中尚未提交的更改？",
        ),
        confirmLabel: t("Discard changes", "放弃更改"),
        cancelLabel: t("Keep editing", "继续编辑"),
        danger: true,
        t,
      }))
    )
      return false;
    resetFormDrafts();
    return true;
  };
  const changeSearch = async (value) => {
    if (await canNavigate()) setSearch(value);
  };
  const submitChange = async (action) => {
    const before = store.getSnapshot();
    const ok = await action();
    // A second explicit Save retries the latest draft. Never rebase onto a
    // newer server revision: the account's compare-and-swap still applies.
    const after = store.getSnapshot();
    if (
      !ok &&
      before.unsaved &&
      before.error &&
      after.journal !== before.journal &&
      after.error?.code !== "conflict" &&
      !after.saving
    )
      return store.retrySave();
    return ok;
  };
  const selectDay = async (value) => {
    if (!validDay(value) || !(await canNavigate())) return false;
    setDay(value);
    setView("journal");
    setSearch("");
    return true;
  };
  const navigate = async (value) => {
    if (value === view || !(await canNavigate())) return false;
    setView(value);
    setSearch("");
    return true;
  };
  const exportCurrent = useCallback(() => {
    try {
      window.rhythmBrowser.download(
        `rhythm-${todayKey()}.json`,
        store.exportJSON(),
      );
      notify(t("Journal exported.", "日记已导出。"));
    } catch {
      notify(
        t(
          "Could not export. Verify your account access and try again.",
          "导出失败，请验证账号访问权限后重试。",
        ),
      );
    }
  }, [notify, t]);
  const exportPrevious = async () => {
    try {
      const json = await store.exportPreviousJSON();
      if (json == null) {
        notify(t("There is no previous snapshot yet.", "暂无上一版本。"));
        return;
      }
      window.rhythmBrowser.download(`rhythm-previous-${today}.json`, json);
      notify(t("Previous snapshot exported.", "上一版本已导出。"));
    } catch {
      notify(t("Could not load the previous snapshot.", "无法加载上一版本。"));
    }
  };
  const pickImport = async () => {
    if (dirty || state.saving) {
      notify(
        t(
          "Save or export your current changes before importing.",
          "导入前请保存或导出当前更改。",
        ),
      );
      return;
    }
    try {
      const result = JSON.parse(await window.rhythmBrowser.pickBackup());
      if (result.cancelled) return;
      if (result.error) throw new Error();
      const parsed = parseJournal(result.json);
      setImporting({ json: result.json, journal: parsed });
    } catch {
      notify(
        t(
          "This backup could not be read. Choose a valid Rhythm JSON file within the storage limit.",
          "无法读取此备份。请选择存储限制内的有效 Rhythm JSON 文件。",
        ),
      );
    }
  };
  const openCreate = () => {
    if (!busy) setEditor({ habit: null });
  };
  const archiveHabit = async (habit) => {
    if (!(await canNavigate())) return;
    if (await store.archiveHabit(habit.id)) {
      notify(
        t(
          "Habit archived. Your history is preserved.",
          "习惯已归档，历史记录已保留。",
        ),
        {
          label: t("Undo", "撤销"),
          run: async () => {
            if (await store.restoreHabit(habit.id))
              notify(t("Habit restored.", "习惯已恢复。"));
          },
        },
      );
    }
  };

  useEffect(() => {
    const start = async () => {
      try {
        await window.rhythmAuth.ready;
        await store.load();
      } catch {}
    };
    start();
    window.rhythmJournalExport = () => store.exportJSON();
    return () => {
      delete window.rhythmJournalExport;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("rhythm.language", language);
      localStorage.setItem("rhythm.theme", theme);
    } catch {}
  }, [language, theme, locale]);
  useEffect(() => {
    window.rhythmBrowser?.setUnsaved(dirty);
  }, [dirty]);
  useEffect(() => {
    const timer = setInterval(() => {
      const next = todayKey();
      setToday((previous) => {
        if (next !== previous && !drafts.current.size)
          setDay((value) => (value === previous ? next : value));
        return next;
      });
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    window.rhythmBrowser.attach(async (name, json) => {
      const input = JSON.parse(json);
      if (name === "read_journal")
        return JSON.stringify({
          ...store.getSnapshot().journal,
          saving: store.getSnapshot().saving,
          unsaved: store.getSnapshot().unsaved,
        });
      if (name === "open_journal_day") {
        if (!validDay(input.day) || drafts.current.size)
          throw new Error("Invalid day or unsaved form.");
        setDay(input.day);
        setView("journal");
        setSearch("");
        return JSON.stringify({ day: input.day });
      }
      if (name === "start_habit_creation") {
        if (!store.getSnapshot().ready || drafts.current.size)
          throw new Error("Journal not ready.");
        setEditor({ habit: null });
        return JSON.stringify({ opened: true });
      }
      if (name === "record_habit_entries") {
        if (drafts.current.size || !Array.isArray(input.entries))
          throw new Error("Unsaved form or invalid entries.");
        const entries = input.entries.map((entry) => ({
          ...entryFor(store.getSnapshot().journal, entry.habitID, entry.day),
          ...entry,
        }));
        if (!(await store.recordEntries(entries)))
          throw new Error("Entries were not saved.");
        return JSON.stringify({ saved: true });
      }
      throw new Error("Unknown action.");
    });
    return () => window.rhythmBrowser.detach();
  }, []);

  const tabs = [
    ["journal", "journal", t("Daily journal", "每日日记")],
    ["insights", "chart", t("Insights", "统计")],
    ["habits", "habits", t("My habits", "我的习惯")],
  ];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t("Skip to journal", "跳转到日记")}
      </a>
      <aside className="sidebar">
        <a
          href="/"
          className="brand-link"
          aria-label="Rhythm home"
          onClick={(event) => {
            event.preventDefault();
            navigate("journal");
          }}
        >
          <Brand />
        </a>
        <p className="sidebar-caption">
          {t("A little better, every day.", "每天进步一点点。")}
        </p>
        <div className="nav-label">{t("YOUR SPACE", "你的空间")}</div>
        <nav aria-label={t("Main navigation", "主导航")}>
          {tabs.map(([id, icon, label]) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {id === "habits" && (
                <span className="nav-count">{activeCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-leaf">
            <Icon name="leaf" size={22} />
          </span>
          <p>{t("Progress is a practice.", "进步来自坚持。")}</p>
          <span>
            {t(
              "Show up for yourself. The small things add up.",
              "为自己坚持。点滴行动，积少成多。",
            )}
          </span>
        </div>
        <div className="sidebar-bottom">
          <label className="language-picker">
            <span>{t("Language", "语言")}</span>
            <select
              aria-label="Language"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value="en">English</option>
              <option value="zh">简体中文</option>
            </select>
          </label>
          <button
            className="nav-item subtle"
            onClick={() =>
              setTheme((value) => (value === "light" ? "dark" : "light"))
            }
          >
            <Icon name={theme === "light" ? "moon" : "sun"} />
            {theme === "light"
              ? t("Dark appearance", "深色外观")
              : t("Light appearance", "浅色外观")}
          </button>
          <button
            className="nav-item subtle"
            onClick={() => window.rhythmBrowser.logout()}
          >
            <Icon name="logout" />
            {t("Sign out", "退出登录")}
          </button>
          <div className="account-label">
            <span className="account-avatar">R</span>
            <span>
              {t("Your private space", "你的私人空间")}
              <small>{t("Account journal", "账号日记")}</small>
            </span>
            <span className="online-dot" />
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Rhythm</span>
            <span>/</span>
            <strong>{tabs.find((tab) => tab[0] === view)[2]}</strong>
          </div>
          <div className="topbar-actions">
            <span
              className={`save-status ${state.error ? "error" : ""}`}
              role="status"
            >
              {state.saving ? (
                <span className="spinner" />
              ) : (
                <span className="status-dot" />
              )}
              {state.loading
                ? t("Loading…", "加载中…")
                : state.saving
                  ? t("Saving…", "保存中…")
                  : state.unsaved
                    ? t("Not saved", "未保存")
                    : draftCount
                      ? t("Unsubmitted draft", "未提交草稿")
                      : state.ready
                        ? t("Saved to account", "已保存到账号")
                        : t("Unavailable", "不可用")}
            </span>
            <details className="backup-menu">
              <summary
                className="icon-button"
                aria-label={t("Backup options", "备份选项")}
              >
                <Icon name="download" />
              </summary>
              <div className="dropdown">
                <button onClick={exportCurrent} disabled={!state.ready}>
                  <Icon name="download" size={16} />
                  {t("Export JSON", "导出 JSON")}
                </button>
                <button onClick={exportPrevious}>
                  <Icon name="restore" size={16} />
                  {t("Export previous version", "导出上一版本")}
                </button>
                <button onClick={pickImport} disabled={dirty || state.saving}>
                  <Icon name="upload" size={16} />
                  {t("Restore from JSON", "从 JSON 恢复")}
                </button>
              </div>
            </details>
            <details className="account-menu">
              <summary
                className="icon-button account-avatar"
                aria-label={t("Account settings", "账号设置")}
              >
                R
              </summary>
              <div className="dropdown">
                <label className="account-language">
                  {t("Language", "语言")}
                  <select
                    aria-label={t("Account language", "账号语言")}
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                  >
                    <option value="en">English</option>
                    <option value="zh">简体中文</option>
                  </select>
                </label>
                <button
                  onClick={() =>
                    setTheme((value) => (value === "light" ? "dark" : "light"))
                  }
                >
                  <Icon name={theme === "light" ? "moon" : "sun"} size={16} />
                  {theme === "light"
                    ? t("Dark appearance", "深色外观")
                    : t("Light appearance", "浅色外观")}
                </button>
                <button onClick={() => window.rhythmBrowser.logout()}>
                  <Icon name="logout" size={16} />
                  {t("Sign out", "退出登录")}
                </button>
              </div>
            </details>
          </div>
        </header>

        <main id="main-content" className="main-content">
          {state.error && (
            <section className="error-banner" role="alert">
              <div>
                <strong>
                  {state.unsaved
                    ? t("Your changes need attention", "请检查未保存更改")
                    : t("Could not open your journal", "无法打开日记")}
                </strong>
                <p>{errorMessage(state.error, t)}</p>
              </div>
              <div className="button-row">
                {state.ready && (
                  <button className="button small" onClick={exportCurrent}>
                    {t("Export draft", "导出草稿")}
                  </button>
                )}
                {state.unsaved && state.error.code !== "conflict" && (
                  <button
                    className="button small"
                    disabled={state.saving}
                    onClick={() => store.retrySave()}
                  >
                    {t("Retry save", "重试保存")}
                  </button>
                )}
                <button
                  className="button small"
                  disabled={state.saving}
                  onClick={async () => {
                    if (
                      !dirty ||
                      (await confirm({
                        title: t("Load saved version?", "加载已保存版本？"),
                        message: t(
                          "Replace the current draft with the saved account version? Export it first if you need it.",
                          "用账号已保存版本替换当前草稿？如需保留，请先导出。",
                        ),
                        confirmLabel: t("Load saved version", "加载已保存版本"),
                        cancelLabel: t("Keep draft", "保留草稿"),
                        danger: true,
                        t,
                      }))
                    ) {
                      if (await store.reloadSaved()) resetFormDrafts();
                    }
                  }}
                >
                  {t("Load saved version", "加载已保存版本")}
                </button>
                {!state.ready && (
                  <button className="button small" onClick={pickImport}>
                    {t("Restore backup", "恢复备份")}
                  </button>
                )}
              </div>
            </section>
          )}

          {state.loading && !state.ready ? (
            <div className="loading-state" role="status">
              <span className="spinner" />
              <h1>{t("Opening your journal…", "正在打开日记…")}</h1>
              <p>
                {t(
                  "Getting the latest version from your account.",
                  "正在获取账号的最新版本。",
                )}
              </p>
            </div>
          ) : !state.ready ? (
            <div className="empty-state">
              <Icon name="journal" size={40} />
              <h1>{t("Your journal is waiting.", "你的日记正在等待。")}</h1>
              <p>
                {t(
                  "Reconnect or sign in again to open your saved records.",
                  "重新连接或登录以打开已保存的记录。",
                )}
              </p>
              <button className="button primary" onClick={() => store.load()}>
                {t("Try again", "重试")}
              </button>
            </div>
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">
                    {view === "journal"
                      ? civilDate(day).toLocaleDateString(locale, {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                        })
                      : t("YOUR RHYTHM, OVER TIME", "日积月累的节奏")}
                  </div>
                  <h1>
                    {view === "journal"
                      ? day === today
                        ? t("Make today count.", "让今天充满意义。")
                        : t(
                            "Every day tells a story.",
                            "每一天都有自己的故事。",
                          )
                      : view === "insights"
                        ? t("See how far you’ve come.", "看看你走了多远。")
                        : t("Build your own rhythm.", "创造自己的节奏。")}
                  </h1>
                  <p>
                    {view === "journal"
                      ? t(
                          "A small step today. A little more momentum tomorrow.",
                          "今天迈出一小步，明天增添一点动力。",
                        )
                      : view === "insights"
                        ? t(
                            "The bigger picture, made of small moments.",
                            "用微小的时刻，绘成成长的全貌。",
                          )
                        : t(
                            "Choose what matters. Make space for it.",
                            "选择重要的事，为它留出空间。",
                          )}
                  </p>
                </div>
                <button
                  className="button primary new-habit-button"
                  onClick={openCreate}
                >
                  <Icon name="plus" size={18} />
                  {t("New habit", "新建习惯")}
                </button>
              </section>

              {view === "journal" && (
                <>
                  <section
                    className="overview-grid"
                    aria-label={t("Daily summary", "每日概览")}
                  >
                    <Metric
                      icon="check"
                      label={t("Completed", "已完成")}
                      value={`${summary.completed} / ${summary.total}`}
                      description={t("habits for this day", "当天习惯")}
                    />
                    <Metric
                      icon="clock"
                      label={t("Time invested", "投入时间")}
                      value={formatMinutes(summary.minutes)}
                      description={t("one minute at a time", "每一分钟都算数")}
                    />
                    <Metric
                      icon="leaf"
                      label={t("Current streak", "当前连续")}
                      value={`${stats.streak || 0} ${t("days", "天")}`}
                      description={t(
                        "days with a check-in",
                        "有记录的连续天数",
                      )}
                    />
                  </section>
                  <div className="journal-layout">
                    <div className="journal-main">
                      <WeekStrip
                        day={day}
                        today={today}
                        journal={journal}
                        selectDay={selectDay}
                        locale={locale}
                        t={t}
                      />
                      <div className="section-heading">
                        <h2>
                          {day === today
                            ? t("Today’s habits", "今日习惯")
                            : t("Daily habits", "当天习惯")}
                          <span className="count-pill">
                            {visibleHabits.length}
                          </span>
                        </h2>
                        <label className="search-field">
                          <Icon name="search" size={16} />
                          <input
                            aria-label={t("Search habits", "搜索习惯")}
                            placeholder={t("Find a habit…", "查找习惯…")}
                            value={search}
                            onChange={(event) =>
                              changeSearch(event.target.value)
                            }
                          />
                        </label>
                      </div>
                      {day > today && (
                        <div className="info-banner">
                          {t(
                            "A little ahead of yourself. You can record this day when it arrives.",
                            "这一天还未到来。届时即可记录。",
                          )}
                        </div>
                      )}
                      {visibleHabits.length === 0 ? (
                        <div className="empty-state card">
                          <Icon name="leaf" size={38} />
                          <h2>
                            {search
                              ? t("No habits found", "未找到习惯")
                              : activeCount
                                ? t("A quiet day.", "平静的一天。")
                                : t(
                                    "Start with one small thing.",
                                    "从一件小事开始。",
                                  )}
                          </h2>
                          <p>
                            {search
                              ? t(
                                  "Try a different search.",
                                  "请尝试其他关键词。",
                                )
                              : t(
                                  "Add a habit that makes your day feel a little better.",
                                  "添加一个让生活更美好的习惯。",
                                )}
                          </p>
                          {!search && (
                            <button
                              className="button primary"
                              onClick={openCreate}
                            >
                              <Icon name="plus" size={16} />
                              {t("Create a habit", "创建习惯")}
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="habit-grid">
                          {visibleHabits.map((habit) => {
                            const entry = entryFor(journal, habit.id, day);
                            const progress = habitProgress(habit, entry);
                            return (
                              <article
                                key={`${habit.id}/${day}`}
                                className={`habit-card ${progress >= 1 ? "is-complete" : ""}`}
                                style={{ "--habit-color": color(habit) }}
                              >
                                <div className="habit-card-header">
                                  <span className="habit-symbol">
                                    <Icon
                                      name={habitIcon(habit.symbol)}
                                      size={22}
                                    />
                                  </span>
                                  <div className="habit-title">
                                    <button
                                      className="text-button"
                                      onClick={() => setDetail(habit.id)}
                                    >
                                      <h3>{habit.title}</h3>
                                    </button>
                                    <span>
                                      {kindName(habit.kind, t)}
                                      {habit.archivedOn
                                        ? ` · ${t("Archived", "已归档")}`
                                        : ""}
                                    </span>
                                  </div>
                                  <details className="habit-menu">
                                    <summary
                                      className="icon-button"
                                      aria-label={`${t("Options for", "选项：")} ${habit.title}`}
                                    >
                                      <Icon name="more" />
                                    </summary>
                                    <div className="dropdown">
                                      <button
                                        onClick={async () => {
                                          if (await canNavigate())
                                            setEditor({ habit });
                                        }}
                                      >
                                        <Icon name="edit" size={16} />
                                        {t("Edit habit", "编辑习惯")}
                                      </button>
                                      <button
                                        onClick={() => setDetail(habit.id)}
                                      >
                                        <Icon name="chart" size={16} />
                                        {t("View history", "查看历史")}
                                      </button>
                                      <button
                                        disabled={
                                          day > today || !hasValue(entry)
                                        }
                                        onClick={async () => {
                                          if (
                                            await confirm({
                                              title: t(
                                                "Clear this day?",
                                                "清除当天记录？",
                                              ),
                                              message: t(
                                                "Clear this entry and any unsubmitted edit? The habit and other days will stay.",
                                                "清除此记录及未提交更改？习惯和其他日期将保留。",
                                              ),
                                              confirmLabel: t(
                                                "Clear entry",
                                                "清除记录",
                                              ),
                                              cancelLabel: t(
                                                "Keep entry",
                                                "保留记录",
                                              ),
                                              danger: true,
                                              t,
                                            })
                                          ) {
                                            if (
                                              await store.updateEntry(
                                                emptyEntry(habit.id, day),
                                              )
                                            ) {
                                              setDraft(
                                                `entry:${habit.id}/${day}`,
                                                false,
                                              );
                                              setEntryResets((values) => ({
                                                ...values,
                                                [`${habit.id}/${day}`]:
                                                  (values[
                                                    `${habit.id}/${day}`
                                                  ] || 0) + 1,
                                              }));
                                            }
                                          }
                                        }}
                                      >
                                        {t("Clear this day", "清除当天")}
                                      </button>
                                      {!habit.archivedOn && (
                                        <button
                                          onClick={() => archiveHabit(habit)}
                                        >
                                          <Icon name="archive" size={16} />
                                          {t("Archive habit", "归档习惯")}
                                        </button>
                                      )}
                                    </div>
                                  </details>
                                </div>
                                {habit.note && (
                                  <p className="habit-note">{habit.note}</p>
                                )}
                                <EntryControl
                                  key={`${entryEpoch}/${entryResets[`${habit.id}/${day}`] || 0}`}
                                  habit={habit}
                                  entry={entry}
                                  disabled={busy || day > today}
                                  onChange={(next) =>
                                    submitChange(() => store.updateEntry(next))
                                  }
                                  onSessions={() =>
                                    setDuration({ habit, entry })
                                  }
                                  onDirtyChange={(value) =>
                                    setDraft(`entry:${habit.id}/${day}`, value)
                                  }
                                  t={t}
                                />
                                <div className="habit-progress">
                                  <span className="progress-track">
                                    <span
                                      style={{
                                        width: `${percentage(progress)}%`,
                                      }}
                                    />
                                  </span>
                                  <span>
                                    {progress >= 1 ? (
                                      <>
                                        <Icon name="check" size={13} />
                                        {t("Done", "完成")}
                                      </>
                                    ) : (
                                      `${percentage(progress)}%`
                                    )}
                                  </span>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <aside className="daily-aside">
                      <section className="momentum-card">
                        <div className="eyebrow">
                          {t("YOUR DAILY MOMENTUM", "每日动力")}
                        </div>
                        <ProgressRing value={summary.progress} />
                        <h3>
                          {summary.completed &&
                          summary.completed === summary.total
                            ? t("You showed up.", "今天做到了。")
                            : summary.completed
                              ? t("Keep your rhythm.", "保持你的节奏。")
                              : t("One step is a start.", "一步就是开始。")}
                        </h3>
                        <p>
                          {summary.completed === summary.total && summary.total
                            ? t(
                                "Every habit, a little promise kept. Take a moment to enjoy it.",
                                "每个习惯，都是一个兑现的小承诺。享受这一刻。",
                              )
                            : t(
                                "You don’t have to do everything. Just give the next small thing your attention.",
                                "不必一口气完成所有事，专注于下一件小事。",
                              )}
                        </p>
                      </section>
                      <WeekBars
                        journal={journal}
                        today={today}
                        locale={locale}
                        t={t}
                        onDay={selectDay}
                      />
                      <div className="privacy-note">
                        <Icon name="journal" size={18} />
                        <span>
                          {t(
                            "Your journal stays with your account, wherever you sign in.",
                            "无论在哪里登录，日记都与你的账号相伴。",
                          )}
                        </span>
                      </div>
                    </aside>
                  </div>
                </>
              )}

              {view === "habits" && (
                <>
                  <div className="management-toolbar">
                    <div
                      className="segmented"
                      role="group"
                      aria-label={t("Habit list", "习惯列表")}
                    >
                      <button
                        aria-pressed={!archive}
                        className={!archive ? "selected" : ""}
                        onClick={() => setArchive(false)}
                      >
                        {t("Active", "进行中")} <span>{activeCount}</span>
                      </button>
                      <button
                        aria-pressed={archive}
                        className={archive ? "selected" : ""}
                        onClick={() => setArchive(true)}
                      >
                        {t("Archive", "归档")}{" "}
                        <span>{journal.habits.length - activeCount}</span>
                      </button>
                    </div>
                    <label className="search-field">
                      <Icon name="search" size={16} />
                      <input
                        aria-label={t("Search habits", "搜索习惯")}
                        placeholder={t("Find a habit…", "查找习惯…")}
                        value={search}
                        onChange={(event) => changeSearch(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="managed-habits">
                    {journal.habits
                      .filter(
                        (habit) =>
                          Boolean(habit.archivedOn) === archive &&
                          habit.title
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .map((habit) => (
                        <article
                          className="managed-habit card"
                          key={habit.id}
                          style={{ "--habit-color": color(habit) }}
                        >
                          <span className="habit-symbol">
                            <Icon name={habitIcon(habit.symbol)} size={23} />
                          </span>
                          <div className="managed-description">
                            <button
                              className="text-button"
                              onClick={() => setDetail(habit.id)}
                            >
                              <h3>{habit.title}</h3>
                            </button>
                            <p>
                              {kindName(habit.kind, t)} ·{" "}
                              {habit.kind === "duration"
                                ? `${formatMinutes(habit.targetMinutes)} ${t("daily goal", "每日目标")}`
                                : habit.kind === "number"
                                  ? `${habit.targetNumber} ${habit.unit}`
                                  : t("One day at a time", "一天一步")}
                            </p>
                            {habit.options.length > 0 && (
                              <div className="category-tags">
                                {habit.options.map((option) => (
                                  <span key={option}>{option}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="managed-actions">
                            <button
                              className="button small"
                              onClick={async () => {
                                if (await canNavigate()) setEditor({ habit });
                              }}
                            >
                              <Icon name="edit" size={15} />
                              {t("Edit", "编辑")}
                            </button>
                            <button
                              className="button small"
                              onClick={async () => {
                                if (archive) {
                                  if (await store.restoreHabit(habit.id))
                                    notify(
                                      t("Habit restored.", "习惯已恢复。"),
                                    );
                                } else await archiveHabit(habit);
                              }}
                            >
                              <Icon
                                name={archive ? "restore" : "archive"}
                                size={15}
                              />
                              {archive
                                ? t("Restore", "恢复")
                                : t("Archive", "归档")}
                            </button>
                          </div>
                        </article>
                      ))}
                  </div>
                  {!journal.habits.some(
                    (habit) =>
                      Boolean(habit.archivedOn) === archive &&
                      habit.title.toLowerCase().includes(search.toLowerCase()),
                  ) && (
                    <div className="empty-state card">
                      <Icon name={archive ? "archive" : "leaf"} size={36} />
                      <h2>
                        {archive
                          ? t("Nothing in the archive.", "暂无归档。")
                          : t("Make it your own.", "创造你的习惯。")}
                      </h2>
                      <p>
                        {archive
                          ? t(
                              "Archived habits wait here, with all their history. Restore them anytime.",
                              "归档习惯和历史记录会保留在这里，可随时恢复。",
                            )
                          : t(
                              "Add your first habit to begin.",
                              "添加第一个习惯，开始记录。",
                            )}
                      </p>
                    </div>
                  )}
                </>
              )}

              {view === "insights" && (
                <Insights
                  journal={journal}
                  today={today}
                  stats={stats}
                  range={range}
                  setRange={setRange}
                  year={year}
                  setYear={setYear}
                  filterHabit={filterHabit}
                  setFilterHabit={setFilterHabit}
                  onDay={selectDay}
                  onHabit={setDetail}
                  locale={locale}
                  t={t}
                />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              {t("Small steps. Lasting change.", "小小步伐，长久改变。")}
            </span>
            <span>Rhythm</span>
          </footer>
        </main>
      </div>
      {editor && (
        <HabitEditor
          key={editor.habit?.id || "new"}
          habit={editor.habit}
          initialDay={day > today ? today : day}
          today={today}
          t={t}
          onClose={() => setEditor(null)}
          onDirtyChange={(value) => setDraft("editor", value)}
          onSave={async (habit) => {
            const ok = await submitChange(() => store.saveHabit(habit));
            if (ok) notify(t("Habit saved.", "习惯已保存。"));
            return ok;
          }}
        />
      )}
      {duration && (
        <DurationEditor
          key={`${duration.habit.id}/${duration.entry.day}`}
          habit={duration.habit}
          entry={duration.entry}
          t={t}
          onClose={() => setDuration(null)}
          onDirtyChange={(value) => setDraft("duration", value)}
          onSave={async (entry, categories) => {
            const ok = await submitChange(() =>
              store.saveSessions(entry, categories),
            );
            if (ok) notify(t("Time recorded.", "时间已记录。"));
            return ok;
          }}
        />
      )}
      {detail && journal.habits.some((habit) => habit.id === detail) && (
        <HabitDetail
          habit={journal.habits.find((habit) => habit.id === detail)}
          journal={journal}
          today={today}
          locale={locale}
          t={t}
          onClose={() => setDetail(null)}
          onDay={async (value) => {
            if (await selectDay(value)) setDetail(null);
          }}
        />
      )}
      {importing && (
        <Modal
          t={t}
          busy={state.saving}
          title={t("Restore this journal?", "恢复此日记？")}
          subtitle={t(
            "This replaces the journal saved to your account in every browser.",
            "这将替换所有浏览器中账号保存的日记。",
          )}
          onClose={() => {
            if (!state.saving) setImporting(null);
          }}
        >
          <>
            {state.error && (
              <p className="field-error" role="alert">
                {errorMessage(state.error, t)}
              </p>
            )}
          </>
          <div className="import-summary">
            <Metric
              icon="habits"
              value={importing.journal.habits.length}
              label={t("Habits", "习惯")}
            />
            <Metric
              icon="journal"
              value={importing.journal.entries.length}
              label={t("Entries", "记录")}
            />
          </div>
          <p className="muted">
            {t(
              "Export your current journal first if you want to keep a separate copy. Your current saved journal becomes the previous snapshot after a successful restore.",
              "如需保留当前日记，请先导出。恢复成功后，当前已保存日记将成为上一版本。",
            )}
          </p>
          <div className="button-row modal-actions">
            <button
              className="button"
              disabled={state.saving}
              onClick={() => setImporting(null)}
            >
              {t("Cancel", "取消")}
            </button>
            <button
              className="button primary"
              disabled={state.saving}
              onClick={async () => {
                if (await store.importJournal(importing.json)) {
                  setImporting(null);
                  notify(t("Journal restored.", "日记已恢复。"));
                }
              }}
            >
              {state.saving
                ? t("Restoring…", "恢复中…")
                : t("Replace account journal", "替换账号日记")}
            </button>
          </div>
        </Modal>
      )}
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          <span>{notice.text}</span>
          {notice.action && (
            <button onClick={notice.action.run}>{notice.action.label}</button>
          )}
          <button
            className="toast-close"
            aria-label={t("Dismiss message", "关闭消息")}
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value, description }) {
  return (
    <div className="metric card">
      <span className="metric-icon">
        <Icon name={icon} size={19} />
      </span>
      <div>
        <span className="metric-label">{label}</span>
        <strong>{value}</strong>
        {description && <small>{description}</small>}
      </div>
    </div>
  );
}

function ProgressRing({ value }) {
  const percent = percentage(value);
  return (
    <div
      className="progress-ring"
      role="img"
      aria-label={`${percent}% complete`}
    >
      <svg viewBox="0 0 120 120">
        <circle className="ring-track" cx="60" cy="60" r="50" />
        <circle
          className="ring-value"
          cx="60"
          cy="60"
          r="50"
          pathLength="100"
          strokeDasharray={`${percent} 100`}
        />
      </svg>
      <span>
        {percent}
        <small>%</small>
      </span>
    </div>
  );
}

function WeekStrip({ day, today, journal, selectDay, locale, t }) {
  const date = civilDate(day);
  const start = shiftDay(day, -((date.getDay() + 6) % 7));
  return (
    <section className="week-picker card">
      <div className="week-picker-heading">
        <strong>
          {date.toLocaleDateString(locale, { month: "long", year: "numeric" })}
        </strong>
        <div className="button-row">
          <button
            className="text-button today-link"
            onClick={() => selectDay(today)}
          >
            {t("Today", "今天")}
          </button>
          <label className="date-picker-label">
            <Icon name="calendar" size={17} />
            <input
              aria-label={t("Choose date", "选择日期")}
              type="date"
              value={day}
              onChange={(event) => selectDay(event.target.value)}
            />
          </label>
          <button
            className="icon-button previous"
            aria-label={t("Previous week", "上一周")}
            onClick={() => selectDay(shiftDay(day, -7))}
          >
            <Icon name="chevron" size={17} />
          </button>
          <button
            className="icon-button"
            aria-label={t("Next week", "下一周")}
            onClick={() => selectDay(shiftDay(day, 7))}
          >
            <Icon name="chevron" size={17} />
          </button>
        </div>
      </div>
      <div className="week-days">
        {Array.from({ length: 7 }, (_, i) => {
          const current = shiftDay(start, i);
          const recorded = daySummary(journal, current).recorded > 0;
          return (
            <button
              key={current}
              className={`week-day ${current === day ? "selected" : ""} ${current === today ? "is-today" : ""}`}
              aria-pressed={current === day}
              aria-label={civilDate(current).toLocaleDateString(locale, {
                dateStyle: "full",
              })}
              onClick={() => selectDay(current)}
            >
              <span>
                {civilDate(current).toLocaleDateString(locale, {
                  weekday: "short",
                })}
              </span>
              <strong>{Number(current.slice(-2))}</strong>
              <i className={recorded ? "recorded" : ""} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WeekBars({ journal, today, locale, t, onDay }) {
  return (
    <section className="week-bars card">
      <div className="section-heading">
        <h3>{t("Last 7 days", "最近 7 天")}</h3>
        <Icon name="chart" size={18} />
      </div>
      <div className="bar-chart">
        {Array.from({ length: 7 }, (_, i) => {
          const day = shiftDay(today, i - 6);
          const summary = daySummary(journal, day);
          return (
            <button
              className="bar-column"
              key={day}
              onClick={() => onDay(day)}
              aria-label={`${day}: ${summary.completed}/${summary.total}`}
              title={`${day}: ${summary.completed}/${summary.total}`}
            >
              <span className="bar-track">
                <span style={{ height: `${percentage(summary.progress)}%` }} />
              </span>
              <span>
                {civilDate(day).toLocaleDateString(locale, {
                  weekday: "narrow",
                })}
              </span>
            </button>
          );
        })}
      </div>
      <p>{t("Tap a day to revisit it.", "点击日期，回顾记录。")}</p>
    </section>
  );
}

function Insights({
  journal,
  today,
  stats,
  range,
  setRange,
  year,
  setYear,
  filterHabit,
  setFilterHabit,
  onDay,
  onHabit,
  locale,
  t,
}) {
  const firstDay = shiftDay(today, -(range - 1));
  const habits = journal.habits.filter(
    (habit) => !filterHabit || habit.id === filterHabit,
  );
  const ids = new Set(habits.map((habit) => habit.id));
  const entries = journal.entries.filter(
    (entry) =>
      ids.has(entry.habitID) && entry.day >= firstDay && entry.day <= today,
  );
  const recorded = new Set(entries.filter(hasValue).map((entry) => entry.day))
    .size;
  const minutes = entries.reduce(
    (total, entry) =>
      total +
      (habits.find((habit) => habit.id === entry.habitID)?.kind === "duration"
        ? entry.minutes
        : 0),
    0,
  );
  const topics = new Map();
  for (const entry of entries) {
    const habit = habits.find((habit) => habit.id === entry.habitID);
    if (habit.kind !== "duration") continue;
    let sum = 0;
    for (const session of entry.sessions || []) {
      const key = JSON.stringify([habit.id, "category", session.topic]);
      const current = topics.get(key) || {
        label: session.topic,
        habit: habit.title,
        minutes: 0,
        color: color(habit),
      };
      current.minutes += session.minutes;
      sum += session.minutes;
      topics.set(key, current);
    }
    if (entry.minutes > sum) {
      const key = JSON.stringify([habit.id, "unassigned"]);
      const current = topics.get(key) || {
        label: t("Uncategorized", "未分类"),
        habit: habit.title,
        minutes: 0,
        color: color(habit),
      };
      current.minutes += entry.minutes - sum;
      topics.set(key, current);
    }
  }
  const categoryRows = [...topics.values()].sort(
    (a, b) => b.minutes - a.minutes,
  );
  const filtered = {
    ...journal,
    habits,
    entries: journal.entries.filter((entry) => ids.has(entry.habitID)),
  };
  const heatStart = `${String(year).padStart(4, "0")}-01-01`;
  const firstMonday = shiftDay(
    heatStart,
    -((civilDate(heatStart).getDay() + 6) % 7),
  );
  const yearEnd = `${String(year).padStart(4, "0")}-12-31`;
  const dayCount =
    Math.round(
      (Date.parse(`${yearEnd}T12:00:00Z`) -
        Date.parse(`${firstMonday}T12:00:00Z`)) /
        86400000,
    ) + 1;
  const heatDays = Array.from({ length: Math.ceil(dayCount / 7) * 7 }, (_, i) =>
    shiftDay(firstMonday, i),
  );
  return (
    <>
      <div className="management-toolbar">
        <div
          className="segmented"
          aria-label={t("Statistics period", "统计周期")}
          role="group"
        >
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              aria-pressed={range === days}
              className={range === days ? "selected" : ""}
              onClick={() => setRange(days)}
            >
              {days} {t("days", "天")}
            </button>
          ))}
        </div>
        <select
          className="filter-select"
          aria-label={t("Filter statistics by habit", "按习惯筛选统计")}
          value={filterHabit}
          onChange={(event) => setFilterHabit(event.target.value)}
        >
          <option value="">{t("All habits", "所有习惯")}</option>
          {journal.habits.map((habit) => (
            <option key={habit.id} value={habit.id}>
              {habit.title}
              {habit.archivedOn ? ` (${t("archived", "已归档")})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="overview-grid">
        <Metric
          icon="calendar"
          label={t("Active days", "活跃天数")}
          value={`${recorded} / ${range}`}
          description={t(
            "days with a record in this period",
            "此周期有记录的天数",
          )}
        />
        <Metric
          icon="clock"
          label={t("Time invested", "投入时间")}
          value={formatMinutes(minutes)}
          description={t("across your timed habits", "计时习惯的累计时间")}
        />
        <Metric
          icon="leaf"
          label={t("Current streak", "当前连续")}
          value={`${stats.streak || 0} ${t("days", "天")}`}
          description={t("across all your habits", "所有习惯的连续记录")}
        />
      </div>
      <section className="heatmap-panel card">
        <div className="section-heading">
          <div>
            <h2>{t("A year of showing up", "一年的坚持")}</h2>
            <p className="muted">
              {t(
                "Every square is a day. Select one to open your journal.",
                "每个方格代表一天，点击即可打开日记。",
              )}
            </p>
          </div>
          <div className="button-row">
            <button
              className="icon-button previous"
              disabled={year <= 2}
              aria-label={t("Previous year", "上一年")}
              onClick={() => setYear(year - 1)}
            >
              <Icon name="chevron" size={17} />
            </button>
            <strong>{year}</strong>
            <button
              className="icon-button"
              disabled={year >= Number(today.slice(0, 4))}
              aria-label={t("Next year", "下一年")}
              onClick={() => setYear(year + 1)}
            >
              <Icon name="chevron" size={17} />
            </button>
          </div>
        </div>
        <div className="heatmap-scroll">
          <div className="heatmap-months">
            {Array.from({ length: 12 }, (_, month) => (
              <span key={month}>
                {new Date(2024, month, 1).toLocaleDateString(locale, {
                  month: "short",
                })}
              </span>
            ))}
          </div>
          <div className="heatmap-grid">
            {heatDays.map((current) => {
              const inYear = Number(current.slice(0, 4)) === year;
              const summary = daySummary(filtered, current);
              const level =
                summary.progress > 0
                  ? Math.min(4, Math.max(1, Math.ceil(summary.progress * 4)))
                  : summary.recorded
                    ? 1
                    : 0;
              if (!inYear)
                return <span className="heat-cell outside" key={current} />;
              return (
                <button
                  key={current}
                  disabled={current > today}
                  className={`heat-cell level-${level}`}
                  onClick={() => onDay(current)}
                  title={`${current} · ${summary.completed}/${summary.total} · ${formatMinutes(summary.minutes)}`}
                  aria-label={`${civilDate(current).toLocaleDateString(locale, { dateStyle: "full" })}: ${percentage(summary.progress)}%`}
                />
              );
            })}
          </div>
        </div>
        <div className="heatmap-legend">
          <span>{t("Less", "少")}</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className={`heat-cell level-${level}`} />
          ))}
          <span>{t("More", "多")}</span>
        </div>
      </section>
      <div className="insights-grid">
        <section className="card insights-card">
          <h2>{t("Time by category", "分类时间")}</h2>
          <p className="muted">
            {t(
              "Where you put your attention in this period.",
              "此周期里，你把注意力放在了哪里。",
            )}
          </p>
          {categoryRows.length ? (
            <div className="category-breakdown">
              {categoryRows.map((row, i) => (
                <div key={i}>
                  <div className="category-row-title">
                    <span>
                      {row.label}
                      <small>{row.habit}</small>
                    </span>
                    <strong>{formatMinutes(row.minutes)}</strong>
                  </div>
                  <div className="category-bar">
                    <span
                      style={{
                        width: `${minutes ? (row.minutes / minutes) * 100 : 0}%`,
                        background: row.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="inline-empty">
              <Icon name="clock" size={28} />
              <p>
                {t(
                  "Record a timed session to see your categories here.",
                  "记录计时活动后，即可在这里查看分类。",
                )}
              </p>
            </div>
          )}
        </section>
        <section className="card insights-card">
          <h2>{t("Habit by habit", "每一个习惯")}</h2>
          <p className="muted">
            {t("A look at your all-time progress.", "回顾全部进展。")}
          </p>
          {habits.length ? (
            <div className="habit-stats-list">
              {habits.map((habit) => {
                const data = habitStats(journal, habit, today);
                return (
                  <button key={habit.id} onClick={() => onHabit(habit.id)}>
                    <span
                      className="habit-symbol"
                      style={{ "--habit-color": color(habit) }}
                    >
                      <Icon name={habitIcon(habit.symbol)} size={18} />
                    </span>
                    <span>
                      <strong>{habit.title}</strong>
                      <small>
                        {data.completedDays} {t("days completed", "天已完成")}
                        {habit.archivedOn
                          ? ` · ${t("Archived", "已归档")}`
                          : ""}
                      </small>
                    </span>
                    <Icon name="chevron" size={16} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="inline-empty">
              <p>
                {t("Your habits will appear here.", "你的习惯将显示在这里。")}
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function HabitDetail({ habit, journal, today, locale, t, onClose, onDay }) {
  const [limit, setLimit] = useState(50);
  const stats = habitStats(journal, habit, today);
  const entries = journal.entries
    .filter((entry) => entry.habitID === habit.id)
    .sort((a, b) => b.day.localeCompare(a.day));
  return (
    <Modal
      t={t}
      title={habit.title}
      subtitle={t("Your history, kept together.", "完整保存的历史记录。")}
      wide
      onClose={onClose}
    >
      <div className="detail-metrics">
        <Metric
          icon="check"
          label={t("Completed days", "完成天数")}
          value={stats.completedDays}
        />
        <Metric
          icon="calendar"
          label={t("Recorded days", "记录天数")}
          value={stats.recordedDays}
        />
        {habit.kind === "duration" && (
          <Metric
            icon="clock"
            label={t("Total time", "总时间")}
            value={formatMinutes(stats.totalMinutes)}
          />
        )}
      </div>
      {habit.note && <p className="muted">{habit.note}</p>}
      <h3>{t("Entries", "记录")}</h3>
      {entries.length ? (
        <div className="history-list">
          {entries.slice(0, limit).map((entry) => (
            <button
              className="history-entry"
              key={entry.day}
              onClick={() => onDay(entry.day)}
            >
              <span>
                <strong>
                  {civilDate(entry.day).toLocaleDateString(locale, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </strong>
                <small>
                  {habit.kind === "duration"
                    ? (entry.sessions || [])
                        .map(
                          (session) =>
                            `${session.topic} · ${formatMinutes(session.minutes)}`,
                        )
                        .join(" / ")
                    : habit.kind === "text"
                      ? entry.text
                      : (entry.selections || []).join(", ")}
                </small>
              </span>
              <span className="history-value">
                {habit.kind === "duration" ? (
                  formatMinutes(entry.minutes)
                ) : habit.kind === "number" ? (
                  `${entry.number ?? "—"} ${habit.unit}`
                ) : habitProgress(habit, entry) >= 1 ? (
                  <Icon name="check" size={18} />
                ) : (
                  "—"
                )}
                <Icon name="chevron" size={15} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="inline-empty">
          <p>
            {t(
              "No entries yet. Start whenever you’re ready.",
              "暂无记录，随时可以开始。",
            )}
          </p>
        </div>
      )}
      {entries.length > limit && (
        <button className="button" onClick={() => setLimit(limit + 50)}>
          {t("Show more", "显示更多")}
        </button>
      )}
    </Modal>
  );
}
