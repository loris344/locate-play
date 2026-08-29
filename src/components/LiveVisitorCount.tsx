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

export default function LiveVisitorCount() {
  const [count, setCount] = useState(MIN_PLAYERS);
  const countRef = useRef(count);

  useEffect(() => {
    const tick = () => {
      const base = baseCountForNow();
      const drift = (base - countRef.current) * 0.05;
      const noise = (Math.random() - 0.5) * 50;
      const next = Math.round(clamp(countRef.current + drift + noise));
      countRef.current = next;
      setCount(next);
    };

    tick();
    const interval = setInterval(tick, 1000);
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
