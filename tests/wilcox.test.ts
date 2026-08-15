import { describe, expect, it, vi } from "vitest";

import {
  WILCOX_CALENDARS,
  fetchWilcoxEvents,
  parseFinalsiteCalendar,
  toRawEvent,
} from "@/server/providers/wilcox";

/** A trimmed but structurally faithful copy of a Finalsite calendar element. */
const SAMPLE = `
<div class="fsElement fsCalendar fsGrid" id="fsEl_41393" data-calendar-ids=385>
  <div class="fsCalendarRow">
    <div class="fsCalendarDaybox fsStateHasEvents">
      <div class="fsCalendarDate" data-day="10" data-year="2026" data-month="7"><span class="fsCalendarDay">Monday,</span> August 10</div>
      <div class="fsCalendarInfo">
        <a class="fsAlertIcon" data-eventid="32540" href="#"></a>
        <span class='fsElementEventColorIcon' style='background:#000000' title='Wilcox High Calendar'></span>
        <a class="fsCalendarEventTitle fsCalendarEventLink" title="First Day of School" data-occur-id="52124970" href="#">First Day of School: 2026-2027 (Periods 1-7)</a>
        <div class="fsTimeRange"><span class="fsAllDayEvent">All Day</span></div>
      </div>
      <div class="fsCalendarInfo">
        <a class="fsAlertIcon" data-eventid="32541" href="#"></a>
        <a class="fsCalendarEventTitle fsCalendarEventLink" title="Senior Sunrise" data-occur-id="52125935" href="#">Senior Sunrise</a>
        <div class="fsTimeRange">
          <time datetime="2026-08-10T06:30:00-07:00" class="fsStartTime"><span class="fsHour">6</span>:<span class="fsMinute">30</span> AM</time>
          <time datetime="2026-08-10T07:30:00-07:00" class="fsEndTime">7:30 AM</time>
        </div>
      </div>
    </div>
    <div class="fsCalendarDaybox">
      <div class="fsCalendarDate" data-day="11" data-year="2026" data-month="7">Tuesday, August 11</div>
    </div>
    <div class="fsCalendarDaybox fsCalendarWeekendDayBox">
      <div>
        <div class="fsCalendarDate" data-day="15" data-year="2026" data-month="7">Saturday, August 15</div>
        <div class="fsCalendarInfo">
          <a class="fsCalendarEventTitle fsCalendarEventLink" title="Robotics &amp; Coding Open House" data-occur-id="9001" href="#">Robotics &amp; Coding Open House</a>
          <div class="fsTimeRange">
            <time datetime="2026-08-15T10:00:00-07:00" class="fsStartTime">10:00 AM</time>
          </div>
        </div>
      </div>
      <div>
        <div class="fsCalendarDate" data-day="16" data-year="2026" data-month="7">Sunday, August 16</div>
      </div>
    </div>
  </div>
</div>
`;

describe("parseFinalsiteCalendar", () => {
  const events = parseFinalsiteCalendar(SAMPLE);

  it("extracts every event", () => {
    expect(events).toHaveLength(3);
  });

  it("converts the zero-indexed month to a calendar month", () => {
    expect(events[0]?.date).toBe("2026-08-10");
  });

  it("attaches events to the correct day inside a shared weekend box", () => {
    const openHouse = events.find((e) => e.title.includes("Open House"));
    expect(openHouse?.date).toBe("2026-08-15");
  });

  it("reads all-day events", () => {
    expect(events[0]?.allDay).toBe(true);
    expect(events[0]?.startAt).toBeUndefined();
  });

  it("reads start and end instants from the time element", () => {
    const sunrise = events.find((e) => e.title === "Senior Sunrise");
    expect(sunrise?.allDay).toBe(false);
    expect(sunrise?.startAt).toBe("2026-08-10T13:30:00.000Z");
    expect(sunrise?.endAt).toBe("2026-08-10T14:30:00.000Z");
  });

  it("keeps the stable occurrence id for idempotent imports", () => {
    expect(events[0]?.occurrenceId).toBe("52124970");
    expect(events[0]?.eventId).toBe("32540");
  });

  it("decodes HTML entities in titles", () => {
    expect(events.find((e) => e.occurrenceId === "9001")?.title).toBe(
      "Robotics & Coding Open House",
    );
  });

  it("captures the owning calendar name when present", () => {
    expect(events[0]?.calendarName).toBe("Wilcox High Calendar");
  });

  it("returns an empty array for unrelated HTML rather than throwing", () => {
    expect(parseFinalsiteCalendar("<html><body>Nope</body></html>")).toEqual([]);
    expect(parseFinalsiteCalendar("")).toEqual([]);
  });

  it("ignores day boxes with no events", () => {
    expect(events.some((e) => e.date === "2026-08-11")).toBe(false);
  });
});

describe("toRawEvent", () => {
  const calendar = WILCOX_CALENDARS[0]!;

  it("maps a parsed event onto the shared RawEvent shape", () => {
    const parsed = parseFinalsiteCalendar(SAMPLE)[0]!;
    const rawEvent = toRawEvent(parsed, calendar);
    expect(rawEvent.source).toBe("wilcox");
    expect(rawEvent.calendarId).toBe("wilcox:school");
    expect(rawEvent.kind).toBe("school");
    expect(rawEvent.sourceRef).toBe("52124970");
    expect(rawEvent.allDay).toBe(true);
  });

  it("anchors an all-day event to local midnight", () => {
    const rawEvent = toRawEvent(parseFinalsiteCalendar(SAMPLE)[0]!, calendar);
    expect(rawEvent.startAt).toBe("2026-08-10T07:00:00.000Z");
  });
});

describe("fetchWilcoxEvents", () => {
  it("fetches every configured calendar and normalizes the result", async () => {
    const fetchImpl = vi.fn(async () => new Response(SAMPLE, { status: 200 }));
    const result = await fetchWilcoxEvents({
      months: 1,
      from: new Date("2026-08-15T00:00:00Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(WILCOX_CALENDARS.length);
    expect(result.fetchedCalendars).toHaveLength(WILCOX_CALENDARS.length);
    expect(result.events).toHaveLength(3 * WILCOX_CALENDARS.length);
    expect(result.errors).toHaveLength(0);
  });

  it("isolates a failing calendar from the others", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error("network down");
      return new Response(SAMPLE, { status: 200 });
    });

    const result = await fetchWilcoxEvents({
      months: 1,
      from: new Date("2026-09-15T00:00:00Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 2,
    });

    expect(result.errors.length).toBe(1);
    expect(result.fetchedCalendars.length).toBe(WILCOX_CALENDARS.length - 1);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("reports an HTTP error instead of returning silent nothing", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    const result = await fetchWilcoxEvents({
      months: 1,
      from: new Date("2026-10-15T00:00:00Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 3,
    });
    expect(result.events).toHaveLength(0);
    expect(result.fetchedCalendars).toHaveLength(0);
    expect(result.errors[0]?.message).toContain("503");
  });

  it("serves the second request for the same month from cache", async () => {
    const fetchImpl = vi.fn(async () => new Response(SAMPLE, { status: 200 }));
    const options = {
      months: 1,
      from: new Date("2026-11-15T00:00:00Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1_000,
    };
    await fetchWilcoxEvents(options);
    const callsAfterFirst = fetchImpl.mock.calls.length;
    await fetchWilcoxEvents(options);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
  });
});
