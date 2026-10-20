import { useId, useRef, useState } from "react";
import Modal, { useDraftDirty } from "./Modal.jsx";
import { useConfirm } from "./Confirmation.jsx";

const english = (en) => en;
const MAX_MINUTES = 59999;
const ROW_KEY = Symbol("duration-editor-row");

function minuteValue(value) {
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= MAX_MINUTES
    ? number
    : null;
}

function durationLabel(minutes, t) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours
    ? `${hours}${t("h", "小时")} ${rest}${t("m", "分钟")}`
    : `${rest} ${t("min", "分钟")}`;
}

export default function DurationEditor({
  habit,
  entry,
  onSave,
  onClose,
  onDirtyChange,
  t = english,
}) {
  const formId = useId();
  const confirm = useConfirm();
  const confirmingClose = useRef(false);
  const nextId = useRef(0);
  const original = useRef({
    sessions: (entry.sessions ?? []).map((session) => ({
      ...session,
      minutes: String(session.minutes),
      [ROW_KEY]: nextId.current++,
    })),
    unassigned: String(
      Math.max(
        0,
        entry.minutes -
          (entry.sessions ?? []).reduce(
            (sum, session) => sum + session.minutes,
            0,
          ),
      ),
    ),
  });
  const [sessions, setSessions] = useState(original.current.sessions);
  const [unassigned, setUnassigned] = useState(original.current.unassigned);
  const [addedCategories, setAddedCategories] = useState([]);
  const [categoryName, setCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const categories = [...habit.options, ...addedCategories];
  const dirty =
    JSON.stringify(sessions) !== JSON.stringify(original.current.sessions) ||
    unassigned !== original.current.unassigned ||
    addedCategories.length > 0 ||
    categoryName.trim() !== "";
  useDraftDirty(dirty, onDirtyChange);
  const parsedSessions = sessions.map((session) => {
    const { [ROW_KEY]: rowKey, ...data } = session;
    return { ...data, minutes: minuteValue(session.minutes) };
  });
  const parsedUnassigned = minuteValue(unassigned);
  const validNumbers =
    parsedUnassigned !== null &&
    parsedSessions.every((session) => session.minutes !== null);
  const total = validNumbers
    ? parsedUnassigned +
      parsedSessions.reduce((sum, session) => sum + session.minutes, 0)
    : null;

  async function close() {
    if (saving.current || confirmingClose.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    confirmingClose.current = true;
    try {
      const discard = await confirm({
        title: t("Discard session changes?", "放弃时长更改？"),
        message: t(
          "Your unsubmitted session changes will be lost.",
          "尚未提交的时长更改将丢失。",
        ),
        confirmLabel: t("Discard changes", "放弃更改"),
        cancelLabel: t("Keep editing", "继续编辑"),
        danger: true,
        t,
      });
      if (discard) onClose();
    } finally {
      confirmingClose.current = false;
    }
  }

  function addCategory() {
    const name = categoryName.trim();
    if (!name) {
      setCategoryError(t("Enter a category name.", "请输入类别名称。"));
      return;
    }
    if ([...name].length > 200) {
      setCategoryError(
        t("Use up to 200 characters.", "最多可输入 200 个字符。"),
      );
      return;
    }
    if (categories.includes(name)) {
      setCategoryError(t("That category already exists.", "该类别已存在。"));
      return;
    }
    if (categories.length >= 30) {
      setCategoryError(
        t("You can have up to 30 categories.", "最多可添加 30 个类别。"),
      );
      return;
    }
    setAddedCategories((previous) => [...previous, name]);
    setCategoryName("");
    setCategoryError("");
    setError("");
  }

  function addSession() {
    setSessions((previous) => [
      ...previous,
      { [ROW_KEY]: nextId.current++, topic: categories[0], minutes: "30" },
    ]);
    setError("");
  }

  function updateSession(key, field, value) {
    setSessions((previous) =>
      previous.map((session) =>
        session[ROW_KEY] === key ? { ...session, [field]: value } : session,
      ),
    );
    setError("");
  }

  async function save(event) {
    event.preventDefault();
    if (saving.current) return;
    if (categoryName.trim()) {
      setCategoryError(
        t(
          "Add this category first, or clear its name before saving.",
          "请先添加此类别，或清空名称后再保存。",
        ),
      );
      return;
    }
    if (!validNumbers || total > MAX_MINUTES) {
      setError(
        t(
          "Use whole minutes. The daily total can be at most 59,999 minutes.",
          "请使用整数分钟，每日总计不能超过 59,999 分钟。",
        ),
      );
      return;
    }
    if (parsedSessions.some((session) => !categories.includes(session.topic))) {
      setError(
        t("Choose a category for each session.", "请为每条记录选择类别。"),
      );
      return;
    }
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const result = await onSave(
        { ...entry, minutes: total, sessions: parsedSessions },
        addedCategories,
      );
      if (result === false)
        setError(
          t(
            "Could not save. Your sessions are still here; please try again.",
            "保存失败。记录已保留，请重试。",
          ),
        );
      else {
        onDirtyChange?.(false);
        onClose();
      }
    } catch {
      setError(
        t(
          "Could not save. Your sessions are still here; please try again.",
          "保存失败。记录已保留，请重试。",
        ),
      );
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return (
    <Modal
      title={habit.title}
      subtitle={`${entry.day} · ${t("Every session counts.", "每一次投入都值得记录。")}`}
      onClose={close}
      wide
      flush
      busy={pending}
      t={t}
    >
      <form className="rf-form" onSubmit={save}>
        <fieldset className="rf-fields" disabled={pending}>
          <div className="rf-duration-total">
            <span>{t("Daily total", "每日总计")}</span>
            <strong aria-live="polite">
              {total === null ? "—" : durationLabel(total, t)}
            </strong>
            <small>
              {t("Goal", "目标")}: {durationLabel(habit.targetMinutes, t)}
            </small>
          </div>
          <div className="rf-section-heading">
            <div>
              <h3>{t("Sessions", "分次记录")}</h3>
              <p className="rf-hint">
                {t(
                  "Keep each session, even when the category repeats.",
                  "即使类别相同，也分别保留每次记录。",
                )}
              </p>
            </div>
            <button
              className="rf-button rf-button-secondary rf-button-small"
              type="button"
              onClick={addSession}
              disabled={!categories.length}
            >
              + {t("Add session", "添加记录")}
            </button>
          </div>
          {sessions.length === 0 && (
            <div className="rf-empty-sessions">
              {categories.length
                ? t(
                    "Add your first session, or record an uncategorized total below.",
                    "添加第一条记录，或在下方填写未分类总时长。",
                  )
                : t(
                    "Add a category below to track separate sessions, or enter your total minutes.",
                    "在下方添加类别以分别记录，或输入总分钟数。",
                  )}
            </div>
          )}
          <div className="rf-sessions">
            {sessions.map((session, index) => (
              <div className="rf-session" key={session[ROW_KEY]}>
                <span className="rf-session-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <label
                  className="rf-field"
                  htmlFor={`${formId}-topic-${session[ROW_KEY]}`}
                >
                  <span>
                    {t("Category", "类别")}{" "}
                    <span className="rf-sr-only">{index + 1}</span>
                  </span>
                  <select
                    id={`${formId}-topic-${session[ROW_KEY]}`}
                    value={session.topic}
                    onChange={(event) =>
                      updateSession(
                        session[ROW_KEY],
                        "topic",
                        event.target.value,
                      )
                    }
                  >
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className="rf-field rf-minutes-field"
                  htmlFor={`${formId}-minutes-${session[ROW_KEY]}`}
                >
                  <span>
                    {t("Minutes", "分钟")}{" "}
                    <span className="rf-sr-only">{index + 1}</span>
                  </span>
                  <input
                    id={`${formId}-minutes-${session[ROW_KEY]}`}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max={MAX_MINUTES}
                    step="1"
                    value={session.minutes}
                    required
                    onChange={(event) =>
                      updateSession(
                        session[ROW_KEY],
                        "minutes",
                        event.target.value,
                      )
                    }
                  />
                </label>
                <button
                  className="rf-icon-button rf-remove-session"
                  type="button"
                  aria-label={t(
                    `Remove session ${index + 1}`,
                    `删除第 ${index + 1} 条记录`,
                  )}
                  onClick={() => {
                    setSessions((previous) =>
                      previous.filter(
                        (item) => item[ROW_KEY] !== session[ROW_KEY],
                      ),
                    );
                    setError("");
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <div className="rf-add-category">
            <label className="rf-field" htmlFor={`${formId}-category`}>
              <span>
                {t("New category", "新类别")}{" "}
                <small>{t("optional", "选填")}</small>
              </span>
              <div className="rf-inline-input">
                <input
                  id={`${formId}-category`}
                  value={categoryName}
                  placeholder={t("Give it a name", "输入类别名称")}
                  maxLength={400}
                  aria-invalid={Boolean(categoryError)}
                  aria-describedby={
                    categoryError ? `${formId}-category-error` : undefined
                  }
                  onChange={(event) => {
                    setCategoryName(event.target.value);
                    setCategoryError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addCategory();
                    }
                  }}
                />
                <button
                  type="button"
                  className="rf-button rf-button-secondary"
                  onClick={addCategory}
                >
                  {t("Add category", "添加类别")}
                </button>
              </div>
            </label>
            {categoryError && (
              <p
                id={`${formId}-category-error`}
                className="rf-error"
                role="alert"
              >
                {categoryError}
              </p>
            )}
            {addedCategories.length > 0 && (
              <div className="rf-tags">
                {addedCategories.map((category) => (
                  <span className="rf-tag" key={category}>
                    {category} <small>{t("new", "新增")}</small>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="rf-unassigned">
            <label className="rf-field" htmlFor={`${formId}-unassigned`}>
              <span>{t("Uncategorized minutes", "未分类分钟数")}</span>
              <input
                id={`${formId}-unassigned`}
                type="number"
                inputMode="numeric"
                min="0"
                max={MAX_MINUTES}
                step="1"
                value={unassigned}
                required
                onChange={(event) => {
                  setUnassigned(event.target.value);
                  setError("");
                }}
              />
            </label>
            <p className="rf-hint">
              {t(
                "Time without a category is kept separately and included in your total.",
                "未分类时长单独保留，并计入总时长。",
              )}
            </p>
          </div>
        </fieldset>
        {error && (
          <p className="rf-error" role="alert">
            {error}
          </p>
        )}
        <div className="rf-form-actions">
          <button
            type="button"
            disabled={pending}
            className="rf-button rf-button-quiet"
            onClick={close}
          >
            {t("Cancel", "取消")}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rf-button rf-button-primary"
          >
            {pending && <span className="rf-spinner" aria-hidden="true" />}
            {pending ? t("Saving…", "保存中…") : t("Save time", "保存时长")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
