import { useEffect, useMemo, useRef, useState } from "react";
import { formatItemWindow } from "./dates.js";
import { itemKindLabel } from "./format.js";
import {
  addDays,
  addMonths,
  dayKey,
  entriesByDay,
  formatDayKey,
  formatLocalTime,
  monthGrid,
  monthStart,
  participationBadgeClass,
  participationStatusLabel,
  shiftMonth,
  weekdayIndex,
} from "./myQuests.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
// Items listed in a day cell before the rest collapse into "+N more".
const VISIBLE_PER_DAY = 3;

function cellLabel(key, entries, today) {
  const parts = [formatDayKey(key)];
  if (key === today) parts.push("today");
  parts.push(
    entries.length === 0
      ? "nothing scheduled"
      : `${entries.length} ${entries.length === 1 ? "item" : "items"}`
  );
  return parts.join(", ");
}

// A month of the student's quests and events, placed on the viewer's local days. Multi-day
// items appear on every day they cover. Arrow keys move between days, Page Up/Down between
// months, and Enter selects a day; the selected day's items are listed beside the grid.
function MonthCalendar({ entries, timeZone, now = Date.now(), onOpenItem }) {
  const today = dayKey(now, timeZone);
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(monthStart(today));
  const [focused, setFocused] = useState(today);
  const gridRef = useRef(null);
  const moveFocus = useRef(false);

  const days = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => entriesByDay(entries, days, timeZone), [entries, days, timeZone]);
  const selectedEntries = useMemo(
    () => entriesByDay(entries, [selected], timeZone).get(selected) || [],
    [entries, selected, timeZone]
  );
  const tabStop = days.includes(focused) && focused.slice(0, 7) === month.slice(0, 7)
    ? focused
    : days.includes(selected) && selected.slice(0, 7) === month.slice(0, 7)
      ? selected
      : month;

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector(`[data-day="${focused}"]`)?.focus();
  }, [focused, month]);

  function goTo(key, { select = false } = {}) {
    setFocused(key);
    if (select) setSelected(key);
    if (key.slice(0, 7) !== month.slice(0, 7)) setMonth(monthStart(key));
  }

  function changeMonth(step) {
    const next = addMonths(month, step);
    setMonth(next);
    setFocused(next);
  }

  function showToday() {
    goTo(today, { select: true });
    setMonth(monthStart(today));
  }

  function handleKeyDown(event, key) {
    const moves = {
      ArrowLeft: () => addDays(key, -1),
      ArrowRight: () => addDays(key, 1),
      ArrowUp: () => addDays(key, -7),
      ArrowDown: () => addDays(key, 7),
      Home: () => addDays(key, -weekdayIndex(key)),
      End: () => addDays(key, 6 - weekdayIndex(key)),
      PageUp: () => shiftMonth(key, -1),
      PageDown: () => shiftMonth(key, 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveFocus.current = true;
    goTo(move());
  }

  const weeks = [];
  for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));

  return (
    <div className="calendar-layout">
      <div className="calendar panel">
        <div className="calendar-toolbar">
          <h3 className="calendar-month" id="calendar-month" aria-live="polite">
            {formatDayKey(month, { month: "long", year: "numeric" })}
          </h3>
          <div className="calendar-nav">
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => changeMonth(-1)}
              aria-label="Previous month"
            >
              ‹ Prev
            </button>
            <button type="button" className="button button-secondary button-small" onClick={showToday}>
              Today
            </button>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => changeMonth(1)}
              aria-label="Next month"
            >
              Next ›
            </button>
          </div>
        </div>
        <table className="calendar-grid" role="grid" aria-labelledby="calendar-month" ref={gridRef}>
          <thead>
            <tr>
              {WEEKDAYS.map((name, index) => (
                <th key={name} scope="col" abbr={WEEKDAY_NAMES[index]}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((key) => {
                  const dayEntries = byDay.get(key) || [];
                  const overflow = dayEntries.length > VISIBLE_PER_DAY;
                  const shown = overflow ? dayEntries.slice(0, VISIBLE_PER_DAY - 1) : dayEntries;
                  const classes = ["calendar-day"];
                  if (key.slice(0, 7) !== month.slice(0, 7)) classes.push("is-outside");
                  if (key === today) classes.push("is-today");
                  if (key === selected) classes.push("is-selected");
                  return (
                    <td key={key} role="gridcell" aria-selected={key === selected}>
                      <button
                        type="button"
                        className={classes.join(" ")}
                        data-day={key}
                        tabIndex={key === tabStop ? 0 : -1}
                        aria-label={cellLabel(key, dayEntries, today)}
                        aria-current={key === today ? "date" : undefined}
                        onClick={() => goTo(key, { select: true })}
                        onFocus={() => setFocused(key)}
                        onKeyDown={(event) => handleKeyDown(event, key)}
                      >
                        <span className="calendar-date" aria-hidden="true">
                          {Number(key.slice(8))}
                          {key === today && <span className="calendar-today-tag">Today</span>}
                        </span>
                        <span className="calendar-items" aria-hidden="true">
                          {shown.map(({ item }) => {
                            const continues = dayKey(Date.parse(item.startsAt), timeZone) !== key;
                            return (
                              <span
                                key={item.id}
                                className={`calendar-item calendar-item-${item.kind}${
                                  continues ? " is-continuation" : ""
                                }`}
                              >
                                <span className="calendar-item-time">
                                  {continues ? "cont." : formatLocalTime(item.startsAt, timeZone)}
                                </span>{" "}
                                {item.title}
                              </span>
                            );
                          })}
                          {overflow && (
                            <span className="calendar-more">
                              +{dayEntries.length - shown.length}
                              <span className="calendar-more-word"> more</span>
                            </span>
                          )}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint calendar-hint">
          Times are shown in your time zone ({timeZone.replace(/_/g, " ")}). Use the arrow keys
          to move between days and Enter to select one.
        </p>
      </div>
      <section className="calendar-day-panel panel" aria-labelledby="calendar-day-title">
        <h3 className="section-title" id="calendar-day-title">
          {formatDayKey(selected)}
        </h3>
        {selectedEntries.length === 0 ? (
          <p className="muted small">Nothing scheduled on this day.</p>
        ) : (
          <ul className="calendar-day-list">
            {selectedEntries.map(({ item, participation }) => (
              <li key={item.id} className="calendar-day-entry">
                <div className="quest-card-meta">
                  <span className="badge badge-category">{itemKindLabel(item.kind)}</span>
                  <span className={participationBadgeClass(participation.status)}>
                    {participationStatusLabel(participation.status)}
                  </span>
                </div>
                <p className="calendar-day-entry-title">{item.title}</p>
                <p className="small muted">
                  {formatItemWindow(item.startsAt, item.endsAt, timeZone, timeZone)}
                </p>
                {item.timeZone && item.timeZone !== timeZone ? (
                  <p className="small muted">
                    Local to the item:{" "}
                    {formatItemWindow(item.startsAt, item.endsAt, item.timeZone, "")}
                  </p>
                ) : (
                  <p className="small muted">Time zone: {timeZone.replace(/_/g, " ")}</p>
                )}
                <p className="small muted">{item.location}</p>
                <button
                  type="button"
                  className="link-button small"
                  onClick={() => onOpenItem(item)}
                  aria-label={`View details: ${item.title}`}
                >
                  View details
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default MonthCalendar;
