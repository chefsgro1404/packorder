// Formats a Date as "MM/dd/yyyy HH:mm EST" (or EDT) in America/New_York, 24-hour clock, no seconds.
export function formatEst(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  const tz = get('timeZoneName'); // "EST" or "EDT"

  return `${get('month')}/${get('day')}/${get('year')} ${hour}:${get('minute')} ${tz}`;
}
