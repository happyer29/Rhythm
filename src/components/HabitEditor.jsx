import { useId, useRef, useState } from "react";
import Modal, { useDraftDirty } from "./Modal.jsx";
import { useConfirm } from "./Confirmation.jsx";

const english = (en) => en;
const COLORS = ["19796B", "E58A65", "7C83B4", "B99552", "B76B83", "4A8BBD"];
const SYMBOLS = [
  ["waveform.path", "∿", "Rhythm", "节奏"],
  ["book.closed", "▤", "Book", "书籍"],
  ["figure.mind.and.body", "◉", "Mindfulness", "正念"],
  ["sun.max", "☀", "Sun", "太阳"],
  ["drop", "◊", "Water", "水滴"],
  ["moon", "☾", "Moon", "月亮"],
  ["heart", "♡", "Heart", "爱心"],
  ["pencil", "✎", "Writing", "书写"],
  ["figure.walk", "↗", "Movement", "运动"],
  ["cup.and.saucer", "☕", "Cup", "杯子"],
  ["brain.head.profile", "✦", "Learning", "学习"],
  ["music.note", "♪", "Music", "音乐"],
];
const KINDS = [
  ["check", "✓", "Check-in", "完成打卡", "A simple daily yes", "每天完成一次"],
  [
    "duration",
    "◷",
    "Duration",
    "时长",
    "Minutes and sessions",
    "分钟数和分次记录",
  ],
  ["number", "#", "Number", "数值", "Track a daily amount", "记录每日数量"],
  ["text", "≡", "Journal", "日记", "A few words each day", "写下每日的感想"],
  ["single", "○", "Single choice", "单选", "Choose one option", "选择一个选项"],
  [
    "multiple",
    "☷",
    "Multiple choice",
    "多选",
    "Choose all that apply",
    "选择所有适用选项",
  ],
];

function localDay() {
  const date = new Date();
  return `${date.getFullYear().toString().padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export default function HabitEditor({
  habit = null,
  initialDay,
  today = localDay(),
  onSave,
  onClose,
  onDirtyChange,
  t = english,
}) {
  const formId = useId();
  const confirm = useConfirm();
  const confirmingClose = useRef(false);
  const editing = Boolean(habit);
  // The store retains an optimistic draft after a failed network save. Reusing
  // this ID makes a second submission update that draft instead of duplicating it.
  const [habitId] = useState(
    () => habit?.id ?? crypto.randomUUID().toUpperCase(),
  );
  const original = useRef({
    title: habit?.title ?? "",
    note: habit?.note ?? "",
    kind: habit?.kind ?? "check",
    colorHex: (habit?.colorHex ?? "19796B").replace("#", "").toUpperCase(),
    symbol: habit?.symbol ?? "waveform.path",
    startDay:
      habit?.startDay ??
      (validDay(initialDay ?? "") && initialDay <= today ? initialDay : today),
    targetMinutes: String(habit?.targetMinutes ?? 30),
    targetNumber: String(habit?.targetNumber ?? 1),
    unit: habit?.unit ?? "",
    addedOptions: "",
  });
  const [draft, setDraft] = useState(original.current);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original.current);
  useDraftDirty(dirty, onDirtyChange);
  const choice = draft.kind === "single" || draft.kind === "multiple";
  const duration = draft.kind === "duration";
  const existingOptions = habit?.options ?? [];
  const set = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError("");
  };
  const close = async () => {
    if (saving.current || confirmingClose.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    confirmingClose.current = true;
    try {
      const discard = await confirm({
        title: t("Discard changes?", "放弃更改？"),
        message: t(
          "Your unsubmitted changes in this form will be lost.",
          "此表单中尚未提交的更改将丢失。",
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
  };

  async function save(event) {
    event.preventDefault();
    if (saving.current) return;
    const options = [
      ...existingOptions,
      ...draft.addedOptions
        .split("\n")
        .map((option) => option.trim())
        .filter(Boolean),
    ];
    const minutes = Number(draft.targetMinutes);
    const number = Number(draft.targetNumber.trim().replace(",", "."));
    let message = "";
    if (!draft.title.trim())
      message = t("Give this habit a name.", "请为习惯命名。");
    else if ([...draft.title.trim()].length > 100)
      message = t(
        "Keep the name under 101 characters.",
        "名称不能超过 100 个字符。",
      );
    else if ([...draft.note].length > 10000)
      message = t(
        "Keep the description under 10,001 characters.",
        "描述不能超过 10,000 个字符。",
      );
    else if (!validDay(draft.startDay) || draft.startDay > today)
      message = t(
        "Choose today or an earlier start date.",
        "请选择今天或更早的开始日期。",
      );
    else if (editing && draft.startDay > habit.startDay)
      message = t(
        "Keep the original start date or move it earlier to preserve your history.",
        "请保留原始开始日期或将其提前，以保留历史记录。",
      );
    else if ((choice || duration) && options.length > 30)
      message = t(
        "You can have up to 30 options or categories.",
        "最多可添加 30 个选项或类别。",
      );
    else if ((choice || duration) && new Set(options).size !== options.length)
      message = t(
        "Each option or category needs a unique name.",
        "选项或类别名称不能重复。",
      );
    else if (
      (choice || duration) &&
      options.some((option) => [...option].length > 200)
    )
      message = t(
        "Use up to 200 characters per option or category.",
        "每个选项或类别最多 200 个字符。",
      );
    else if (choice && !options.length)
      message = t("Add at least one option.", "请至少添加一个选项。");
    else if (
      duration &&
      (!/^\d+$/.test(draft.targetMinutes) ||
        !Number.isSafeInteger(minutes) ||
        minutes < 1 ||
        minutes > 59999)
    )
      message = t(
        "The goal must be a whole number from 1 to 59,999 minutes.",
        "目标须为 1 至 59,999 分钟的整数。",
      );
    else if (
      draft.kind === "number" &&
      (!Number.isFinite(number) || number <= 0 || number > 1e9)
    )
      message = t(
        "The goal must be above 0 and at most 1 billion.",
        "目标须大于 0，且不超过 10 亿。",
      );
    if (message) {
      setError(message);
      return;
    }
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const updated = {
        ...(habit ?? {}),
        id: habitId,
        title: draft.title.trim(),
        note: draft.note.trim(),
        kind: draft.kind,
        colorHex: draft.colorHex,
        symbol: draft.symbol,
        startDay: draft.startDay,
        targetMinutes: duration ? minutes : (habit?.targetMinutes ?? 30),
        targetNumber:
          draft.kind === "number" ? number : (habit?.targetNumber ?? 1),
        unit: draft.unit.trim(),
        options: choice || duration ? options : (habit?.options ?? []),
      };
      const result = await onSave(updated);
      if (result === false) {
        setError(
          t(
            "Could not save. Your changes are still here; please try again.",
            "保存失败。更改已保留，请重试。",
          ),
        );
      } else {
        onDirtyChange?.(false);
        onClose();
      }
    } catch {
      setError(
        t(
          "Could not save. Your changes are still here; please try again.",
          "保存失败。更改已保留，请重试。",
        ),
      );
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return (
    <Modal
      title={
        editing
          ? t("Edit habit", "编辑习惯")
          : t("Make room for a new habit", "开始一个新习惯")
      }
      subtitle={t(
        "Start small. Make it your own.",
        "从小事开始，找到自己的节奏。",
      )}
      onClose={close}
      wide
      flush
      busy={pending}
      t={t}
    >
      <form onSubmit={save} className="rf-form">
        <fieldset disabled={pending} className="rf-fields">
          <label className="rf-field" htmlFor={`${formId}-title`}>
            <span>{t("Habit name", "习惯名称")}</span>
            <input
              id={`${formId}-title`}
              value={draft.title}
              onChange={(event) => set("title", event.target.value)}
              placeholder={t("e.g. Read a little", "例如：读一会儿书")}
              maxLength={200}
              autoFocus
              required
            />
          </label>
          <label className="rf-field" htmlFor={`${formId}-note`}>
            <span>
              {t("A little reminder", "一句小提醒")}{" "}
              <small>{t("optional", "选填")}</small>
            </span>
            <input
              id={`${formId}-note`}
              value={draft.note}
              onChange={(event) => set("note", event.target.value)}
              placeholder={t(
                "What makes this worth doing?",
                "为什么想养成这个习惯？",
              )}
              maxLength={10000}
            />
          </label>

          <fieldset className="rf-choice-fieldset">
            <legend>
              {t("How would you like to track it?", "你想如何记录？")}
            </legend>
            <div className="rf-kind-grid">
              {KINDS.map(([kind, icon, en, zh, detailEn, detailZh]) => (
                <label
                  key={kind}
                  className={`rf-kind${draft.kind === kind ? " is-selected" : ""}${editing && draft.kind !== kind ? " is-disabled" : ""}`}
                >
                  <input
                    type="radio"
                    name={`${formId}-kind`}
                    value={kind}
                    checked={draft.kind === kind}
                    disabled={editing}
                    onChange={() => set("kind", kind)}
                  />
                  <span className="rf-kind-icon" aria-hidden="true">
                    {icon}
                  </span>
                  <span>
                    <strong>{t(en, zh)}</strong>
                    <small>{t(detailEn, detailZh)}</small>
                  </span>
                </label>
              ))}
            </div>
            {editing && (
              <p className="rf-hint">
                {t(
                  "The tracking type stays the same so your history stays intact.",
                  "记录方式保持不变，以保留历史数据。",
                )}
              </p>
            )}
          </fieldset>

          {(choice || duration) && (
            <div className="rf-field">
              {existingOptions.length > 0 && (
                <div className="rf-existing-options">
                  <span className="rf-field-label">
                    {duration
                      ? t("Your categories", "已有类别")
                      : t("Your options", "已有选项")}
                  </span>
                  <div className="rf-tags">
                    {existingOptions.map((option) => (
                      <span key={option} className="rf-tag">
                        {option}
                      </span>
                    ))}
                  </div>
                  <p className="rf-hint">
                    {t(
                      "Existing names are kept to preserve past entries.",
                      "保留已有名称，以保留历史记录。",
                    )}
                  </p>
                </div>
              )}
              <label htmlFor={`${formId}-options`}>
                {duration
                  ? t(
                      editing ? "Add categories" : "Categories",
                      editing ? "添加类别" : "类别",
                    )
                  : t(
                      editing ? "Add options" : "Options",
                      editing ? "添加选项" : "选项",
                    )}{" "}
                <small>{duration && t("optional", "选填")}</small>
              </label>
              <textarea
                id={`${formId}-options`}
                value={draft.addedOptions}
                onChange={(event) => set("addedOptions", event.target.value)}
                rows={3}
                placeholder={
                  duration
                    ? t("Reading\nPractice\nCoursework", "阅读\n练习\n课程")
                    : t("One option per line", "每行一个选项")
                }
              />
              <p className="rf-hint">
                {t(
                  "One per line · up to 30 in total",
                  "每行一个，共最多 30 个",
                )}
                {duration &&
                  ` · ${t("Track separate sessions for each category.", "按类别分别记录每次时长。")}`}
              </p>
            </div>
          )}

          <div className="rf-form-row">
            {duration && (
              <label className="rf-field" htmlFor={`${formId}-minutes`}>
                <span>
                  {t("Daily goal", "每日目标")}{" "}
                  <small>{t("minutes", "分钟")}</small>
                </span>
                <input
                  id={`${formId}-minutes`}
                  type="number"
                  min="1"
                  max="59999"
                  step="1"
                  inputMode="numeric"
                  required
                  value={draft.targetMinutes}
                  onChange={(event) => set("targetMinutes", event.target.value)}
                />
              </label>
            )}
            {draft.kind === "number" && (
              <>
                <label className="rf-field" htmlFor={`${formId}-number`}>
                  <span>{t("Daily goal", "每日目标")}</span>
                  <input
                    id={`${formId}-number`}
                    type="text"
                    inputMode="decimal"
                    required
                    value={draft.targetNumber}
                    onChange={(event) =>
                      set("targetNumber", event.target.value)
                    }
                  />
                </label>
                <label className="rf-field" htmlFor={`${formId}-unit`}>
                  <span>
                    {t("Unit", "单位")} <small>{t("optional", "选填")}</small>
                  </span>
                  <input
                    id={`${formId}-unit`}
                    value={draft.unit}
                    onChange={(event) => set("unit", event.target.value)}
                    placeholder={t("pages, glasses, steps…", "页、杯、步…")}
                    maxLength={100}
                  />
                </label>
              </>
            )}
            <label className="rf-field" htmlFor={`${formId}-start`}>
              <span>{t("Start date", "开始日期")}</span>
              <input
                id={`${formId}-start`}
                type="date"
                min="0001-01-01"
                max={editing && habit.startDay < today ? habit.startDay : today}
                required
                value={draft.startDay}
                onChange={(event) => set("startDay", event.target.value)}
              />
            </label>
          </div>

          <div className="rf-appearance">
            <fieldset className="rf-choice-fieldset">
              <legend>{t("Color", "颜色")}</legend>
              <div className="rf-swatches">
                {[...new Set([...COLORS, draft.colorHex])].map((color) => (
                  <label
                    key={color}
                    className={`rf-swatch${draft.colorHex === color ? " is-selected" : ""}`}
                    style={{ "--swatch": `#${color}` }}
                  >
                    <input
                      type="radio"
                      name={`${formId}-color`}
                      checked={draft.colorHex === color}
                      onChange={() => set("colorHex", color)}
                      aria-label={`${t("Color", "颜色")} #${color}`}
                    />
                    <span aria-hidden="true">
                      {draft.colorHex === color ? "✓" : ""}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="rf-choice-fieldset">
              <legend>{t("Symbol", "图标")}</legend>
              <div className="rf-symbols">
                {SYMBOLS.map(([symbol, icon, en, zh]) => (
                  <label
                    key={symbol}
                    className={`rf-symbol${draft.symbol === symbol ? " is-selected" : ""}`}
                    title={t(en, zh)}
                  >
                    <input
                      type="radio"
                      name={`${formId}-symbol`}
                      checked={draft.symbol === symbol}
                      onChange={() => set("symbol", symbol)}
                      aria-label={t(en, zh)}
                    />
                    <span aria-hidden="true">{icon}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </fieldset>
        {error && (
          <p className="rf-error" role="alert">
            {error}
          </p>
        )}
        <div className="rf-form-actions">
          <button
            className="rf-button rf-button-quiet"
            type="button"
            disabled={pending}
            onClick={close}
          >
            {t("Cancel", "取消")}
          </button>
          <button
            className="rf-button rf-button-primary"
            type="submit"
            disabled={pending}
          >
            {pending && <span className="rf-spinner" aria-hidden="true" />}
            {pending
              ? t("Saving…", "保存中…")
              : editing
                ? t("Save changes", "保存更改")
                : t("Create habit", "创建习惯")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
