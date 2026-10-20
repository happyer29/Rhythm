import { useEffect, useId, useRef, useState } from "react";
import { useDraftDirty } from "./Modal.jsx";

const english = (en) => en;

function durationLabel(minutes, t) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours
    ? `${hours}${t("h", "小时")} ${rest}${t("m", "分钟")}`
    : `${rest} ${t("min", "分钟")}`;
}

/** Reset drafts on a new day without ever publishing an unfinished edit. */
export default function EntryControl(props) {
  return <EntryInput key={`${props.habit.id}:${props.entry.day}`} {...props} />;
}

function EntryInput({
  habit,
  entry,
  disabled = false,
  onChange,
  onSessions,
  onDirtyChange,
  t = english,
}) {
  const fieldId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function publish(updated) {
    if (disabled || saving.current) return false;
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const result = await onChange(updated);
      if (result === false) throw new Error("SAVE_FAILED");
      return true;
    } catch {
      if (mounted.current)
        setError(t("Could not save. Please try again.", "保存失败，请重试。"));
      return false;
    } finally {
      saving.current = false;
      if (mounted.current) setPending(false);
    }
  }
  const locked = disabled || pending;
  let control;
  switch (habit.kind) {
    case "check":
      control = (
        <label
          className={`rf-check-in${entry.checked ? " is-complete" : ""}${locked ? " is-disabled" : ""}`}
        >
          <input
            type="checkbox"
            checked={Boolean(entry.checked)}
            disabled={locked}
            onChange={(event) =>
              publish({ ...entry, checked: event.target.checked })
            }
            aria-label={t(
              `Mark ${habit.title} complete`,
              `标记完成：${habit.title}`,
            )}
          />
          <span className="rf-check-box" aria-hidden="true">
            ✓
          </span>
          <span>
            {pending
              ? t("Saving…", "保存中…")
              : entry.checked
                ? t("Completed", "已完成")
                : t("Mark complete", "标记完成")}
          </span>
        </label>
      );
      break;
    case "single":
    case "multiple":
      control = (
        <div
          className="rf-choice-options"
          role="group"
          aria-label={
            habit.kind === "single"
              ? t("Choose one option", "选择一个选项")
              : t("Choose all that apply", "选择所有适用选项")
          }
        >
          {habit.options.map((option) => {
            const selected = (entry.selections ?? []).includes(option);
            return (
              <button
                key={option}
                type="button"
                className={`rf-option-pill${selected ? " is-selected" : ""}`}
                aria-pressed={selected}
                disabled={locked}
                onClick={() => {
                  const selections =
                    habit.kind === "single"
                      ? selected
                        ? []
                        : [option]
                      : habit.options.filter((item) =>
                          item === option
                            ? !selected
                            : (entry.selections ?? []).includes(item),
                        );
                  publish({ ...entry, selections });
                }}
              >
                {selected && <span aria-hidden="true">✓ </span>}
                {option}
              </button>
            );
          })}
        </div>
      );
      break;
    case "duration": {
      const sessions = entry.sessions ?? [];
      const unassigned = Math.max(
        0,
        entry.minutes -
          sessions.reduce((sum, session) => sum + session.minutes, 0),
      );
      const topics = [...new Set(sessions.map((session) => session.topic))];
      control = (
        <div className="rf-duration-control">
          <div className="rf-time-line">
            <strong>{durationLabel(entry.minutes, t)}</strong>
            <span>
              {t("of", "/")} {durationLabel(habit.targetMinutes, t)}
            </span>
            <button
              type="button"
              className="rf-button rf-button-secondary rf-button-small"
              onClick={onSessions}
              disabled={locked}
            >
              {entry.minutes || sessions.length
                ? t("Edit time", "编辑时长")
                : t("Log time", "记录时长")}{" "}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
          {topics.length > 0 && (
            <div className="rf-duration-categories">
              {topics.map((topic) => (
                <span key={topic}>
                  {topic}
                  <b>
                    {durationLabel(
                      sessions
                        .filter((session) => session.topic === topic)
                        .reduce((sum, session) => sum + session.minutes, 0),
                      t,
                    )}
                  </b>
                </span>
              ))}
              {unassigned > 0 && (
                <span>
                  {t("Uncategorized", "未分类")}
                  <b>{durationLabel(unassigned, t)}</b>
                </span>
              )}
            </div>
          )}
          {sessions.length > 0 && (
            <small className="rf-hint">
              {t(
                `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`,
                `${sessions.length} 条记录`,
              )}
            </small>
          )}
        </div>
      );
      break;
    }
    case "number":
    case "text":
      control = (
        <DraftInput
          habit={habit}
          entry={entry}
          disabled={locked}
          pending={pending}
          publish={publish}
          onDirtyChange={onDirtyChange}
          fieldId={fieldId}
          t={t}
        />
      );
      break;
    default:
      control = null;
  }
  return (
    <div className="rf-entry-control" aria-busy={pending}>
      {control}
      {error && (
        <p className="rf-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function DraftInput({
  habit,
  entry,
  disabled,
  pending,
  publish,
  onDirtyChange,
  fieldId,
  t,
}) {
  const isNumber = habit.kind === "number";
  const storedValue = isNumber
    ? entry.number == null
      ? ""
      : String(entry.number)
    : (entry.text ?? "");
  const [draft, setDraft] = useState(storedValue);
  const [validation, setValidation] = useState("");
  const previousStored = useRef(storedValue);
  const dirty = draft !== storedValue;
  useDraftDirty(dirty, onDirtyChange);
  useEffect(() => {
    if (previousStored.current === storedValue) return;
    const previous = previousStored.current;
    previousStored.current = storedValue;
    // An unrelated account refresh must not erase an unfinished local edit.
    setDraft((current) => (current === previous ? storedValue : current));
  }, [storedValue]);

  async function save(event) {
    event.preventDefault();
    let updated;
    if (isNumber) {
      const value = draft.trim().replace(",", ".");
      const number = value === "" ? null : Number(value);
      if (
        number !== null &&
        (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ||
          !Number.isFinite(number) ||
          number < 0 ||
          number > 1e9)
      ) {
        setValidation(
          t(
            "Enter a number from 0 to 1 billion.",
            "请输入 0 至 10 亿之间的数字。",
          ),
        );
        return;
      }
      updated = { ...entry, number };
    } else {
      if ([...draft].length > 10000) {
        setValidation(
          t(
            "Keep your note under 10,001 characters.",
            "笔记不能超过 10,000 个字符。",
          ),
        );
        return;
      }
      updated = { ...entry, text: draft };
    }
    setValidation("");
    const saved = await publish(updated);
    if (saved) {
      onDirtyChange?.(false);
      if (isNumber)
        setDraft(updated.number == null ? "" : String(updated.number));
    }
  }

  return (
    <form
      className={`rf-draft-input${isNumber ? " rf-number-entry" : " rf-text-entry"}`}
      onSubmit={save}
    >
      <label htmlFor={fieldId} className="rf-sr-only">
        {isNumber
          ? `${habit.title} · ${habit.unit || t("Value", "数值")}`
          : t(`A note for ${habit.title}`, `${habit.title} 的笔记`)}
      </label>
      <div className="rf-draft-line">
        {isNumber ? (
          <div className="rf-number-wrap">
            <input
              id={fieldId}
              type="text"
              inputMode="decimal"
              value={draft}
              disabled={disabled}
              placeholder="0"
              aria-invalid={Boolean(validation)}
              aria-describedby={validation ? `${fieldId}-error` : undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                setValidation("");
              }}
            />
            {habit.unit && <span>{habit.unit}</span>}
          </div>
        ) : (
          <textarea
            id={fieldId}
            value={draft}
            disabled={disabled}
            rows={2}
            placeholder={t(
              "A thought, a moment, a small win…",
              "一个想法，一个瞬间，一点小收获…",
            )}
            maxLength={10000}
            aria-invalid={Boolean(validation)}
            aria-describedby={validation ? `${fieldId}-error` : undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              setValidation("");
            }}
          />
        )}
        <button
          type="submit"
          className="rf-button rf-button-secondary rf-button-small"
          disabled={disabled || !dirty}
        >
          {pending ? t("Saving…", "保存中…") : t("Save", "保存")}
        </button>
      </div>
      {isNumber && (
        <span className="rf-hint">
          {t("Daily goal", "每日目标")}: {habit.targetNumber} {habit.unit}
        </span>
      )}
      {dirty && (
        <span className="rf-draft-hint">
          {t(
            "Unsaved changes · select Save to keep them",
            "有未保存的更改，请点击“保存”",
          )}
        </span>
      )}
      {validation && (
        <p className="rf-error" id={`${fieldId}-error`} role="alert">
          {validation}
        </p>
      )}
    </form>
  );
}
