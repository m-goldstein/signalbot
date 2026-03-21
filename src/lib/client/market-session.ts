export function getEasternSessionParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number.parseInt(read("year"), 10),
    month: Number.parseInt(read("month"), 10),
    day: Number.parseInt(read("day"), 10),
    weekday: read("weekday"),
    hour: Number.parseInt(read("hour"), 10),
    minute: Number.parseInt(read("minute"), 10),
  };
}

function formatDayKey(date: Date) {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}

function previousTradingDay(date: Date) {
  const next = new Date(date.getTime());

  do {
    next.setUTCDate(next.getUTCDate() - 1);
  } while (next.getUTCDay() === 0 || next.getUTCDay() === 6);

  return next;
}

export function isTradingSessionOpen(date: Date = new Date()) {
  const parts = getEasternSessionParts(date);

  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return false;
  }

  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function getActiveTradingDayKey(date: Date = new Date()) {
  const parts = getEasternSessionParts(date);
  let day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  if (parts.weekday === "Sat") {
    day = previousTradingDay(day);
  } else if (parts.weekday === "Sun") {
    day = previousTradingDay(previousTradingDay(day));
  } else {
    const minutes = parts.hour * 60 + parts.minute;

    if (minutes < 9 * 60 + 30) {
      day = previousTradingDay(day);
    }
  }

  return formatDayKey(day);
}
