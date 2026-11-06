// Date/time helpers. CampusFlow treats Asia/Kolkata (IST) as the campus
// timezone, matching the database trigger, so "today" is the same for every
// user no matter where their browser is.

export const CAMPUS_TIMEZONE = 'Asia/Kolkata'

// Returns the parts of `date` as seen in the campus timezone.
const campusParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAMPUS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(parts.map((p) => [p.type, p.value]))
}

// Today's date in the campus timezone, as "YYYY-MM-DD".
export const getTodayStr = () => {
  const { year, month, day } = campusParts()
  return `${year}-${month}-${day}`
}

// Current time in the campus timezone, as "HH:MM:00".
export const getCurrentTimeStr = () => {
  const { hour, minute } = campusParts()
  return `${hour}:${minute}:00`
}

// Minutes since midnight in the campus timezone.
export const getCurrentMinutes = () => {
  const { hour, minute } = campusParts()
  return Number(hour) * 60 + Number(minute)
}

// Day of week (0 = Sunday ... 6 = Saturday) for a "YYYY-MM-DD" string.
// `new Date('YYYY-MM-DD')` is parsed as UTC midnight, which gives the previous
// day in timezones behind UTC, so we compute it from the parts in UTC instead.
export const getDayOfWeek = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

// Adds `days` (may be negative) to a "YYYY-MM-DD" string.
export const addDays = (dateStr, days) => {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}
