"use client";

import { useEffect, useRef, useState } from "react";

const MIN_PLAYERS = 340;
const MAX_PLAYERS = 13700;
const MID_PLAYERS = (MIN_PLAYERS + MAX_PLAYERS) / 2;
const AMPLITUDE = (MAX_PLAYERS - MIN_PLAYERS) / 2;
// Quietest around 9am US Eastern, peaking 12h later at 9pm.
const TROUGH_HOUR = 9;

function getUSHourFraction() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 12);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const second = Number(parts.find((p) => p.type === "second")?.value ?? 0);

  return hour + minute / 60 + second / 3600;
}

function baseCountForNow() {
  const angle = ((getUSHourFraction() - TROUGH_HOUR) / 24) * 2 * Math.PI;
  return MID_PLAYERS - AMPLITUDE * Math.cos(angle);
}

function clamp(value: number) {
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, value));
}

// Weighted so most seconds are quiet (no change, or ±1), with the occasional
// bigger swing — closer to how a real concurrent-user count actually moves.
function randomStep() {
  const r = Math.random();
  if (r < 0.3) return 0;
  if (r < 0.5) return 1;
  if (r < 0.7) return -1;
  if (r < 0.82) return 2;
  if (r < 0.94) return -2;
  if (r < 0.98) return 3;
  return -3;
}

export default function LiveVisitorCount() {
  const [count, setCount] = useState(MIN_PLAYERS);
  const countRef = useRef(count);

  useEffect(() => {
    // Seed immediately at the realistic value for "right now" rather than easing into it.
    const seeded = Math.round(baseCountForNow());
    countRef.current = seeded;
    setCount(seeded);

    const interval = setInterval(() => {
      const base = baseCountForNow();
      const current = countRef.current;
      const diff = base - current;

      let step = randomStep();
      // Only occasionally nudge toward the time-of-day baseline, so the
      // count drifts there over minutes instead of ticking the same way every second.
      if (diff !== 0 && Math.random() < 0.3) {
        step += Math.sign(diff);
      }

      const next = clamp(current + step);
      countRef.current = next;
      setCount(next);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
      </span>
      <span>
        <span className="font-bold text-foreground">{count.toLocaleString("en-US")}</span> people are currently playing
      </span>
    </div>
  );
}
