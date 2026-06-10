export function utcClockString() {
  const now = new Date();
  return now.toLocaleTimeString('en-GB', {
    hour12: false,
    timeZone: 'UTC',
  });
}
