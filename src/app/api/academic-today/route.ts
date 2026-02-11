export const dynamic = "force-dynamic";

interface IEvent {
  dtstart?: string;
  dtend?: string;
  summary?: string;
}

function parseICS(icsText: string): IEvent[] {
  const lines = icsText.split(/\r?\n/);
  const unfolded: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.trim();
    } else {
      unfolded.push(line);
    }
  }

  const events: IEvent[] = [];
  let current: IEvent | null = null;

  for (const line of unfolded) {
    if (line.startsWith("BEGIN:VEVENT")) current = {};
    else if (line.startsWith("END:VEVENT")) {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const keyPart = line.slice(0, idx);
      const val = line.slice(idx + 1).trim();
      const key = keyPart.split(";")[0];
      if (key === "DTSTART") current.dtstart = val;
      if (key === "DTEND") current.dtend = val;
      if (key === "SUMMARY") current.summary = val;
    }
  }

  return events;
}

function yyyymmdd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function isAllDay(v?: string): boolean {
  return /^\d{8}$/.test(v || "");
}

function occursToday(todayStr: string, ev?: IEvent): boolean {
  if (!ev?.dtstart || !ev?.summary) return false;

  if (isAllDay(ev.dtstart)) {
    const s = ev.dtstart;
    const e = ev.dtend || s;
    return todayStr >= s && todayStr < e; // DTEND exclusive
  }

  const s = String(ev.dtstart).slice(0, 8);
  const e = String(ev.dtend || ev.dtstart).slice(0, 8);
  return todayStr >= s && todayStr <= e;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date"); // YYYY-MM-DD
    const baseDate = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
    const todayStr = yyyymmdd(baseDate);

    const urls = [
      "https://calendar.google.com/calendar/ical/fiunapy%40gmail.com/public/basic.ics",
      "https://calendar.google.com/calendar/ical/es-419.py%23holiday%40group.v.calendar.google.com/public/basic.ics",
    ];

    const res = await Promise.allSettled(
      urls.map((u) =>
        fetch(u, { next: { revalidate: 60 } }).then((r) => r.text())
      )
    );

    const all: string[] = [];
    for (const item of res) {
      if (item.status === "fulfilled") {
        for (const ev of parseICS(item.value)) {
          if (occursToday(todayStr, ev)) all.push(ev.summary!);
        }
      }
    }

    return Response.json({ date: todayStr, events: Array.from(new Set(all)) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ date: null, events: [], error: msg }, { status: 200 });
  }
}
