import { useState, useEffect, useCallback } from "react";
import { Timer } from "lucide-react";

const ROUND_TIME = 120;

interface RoundTimerProps {
  roundId: number;
  stopped: boolean;
  onTimeUp: () => void;
  onElapsedChange?: (elapsed: number) => void;
}

export default function RoundTimer({ roundId, stopped, onTimeUp, onElapsedChange }: RoundTimerProps) {
  const [deadline, setDeadline] = useState(() => Date.now() + ROUND_TIME * 1000);
  const [timeLeft, setTimeLeft] = useState(ROUND_TIME);

  // Reset deadline only when round changes
  useEffect(() => {
    setDeadline(Date.now() + ROUND_TIME * 1000);
    setTimeLeft(ROUND_TIME);
  }, [roundId]);

  useEffect(() => {
    if (stopped) return;

    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      const elapsed = ROUND_TIME - remaining;
      onElapsedChange?.(elapsed);

      if (remaining <= 0) {
        clearInterval(id);
        onTimeUp();
      }
    }, 250);

    return () => clearInterval(id);
  }, [deadline, stopped, onTimeUp, onElapsedChange]);

  const percentage = (timeLeft / ROUND_TIME) * 100;
  const color =
    timeLeft > 60 ? "text-green-500" : timeLeft > 30 ? "text-yellow-500" : "text-red-500";
  const bgColor =
    timeLeft > 60 ? "bg-green-500" : timeLeft > 30 ? "bg-yellow-500" : "bg-red-500";

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;

  return (
    <div className="flex items-center gap-2">
      <Timer className={`w-4 h-4 ${color}`} />
      <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${bgColor} rounded-full transition-all duration-200`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className={`font-black text-sm tabular-nums ${color}`}>
        {mins}:{secs.toString().padStart(2, "0")}
      </span>
    </div>
  );
}

export function getTimeMultiplier(elapsedSeconds: number): number {
  if (elapsedSeconds >= ROUND_TIME) return 0;
  if (elapsedSeconds < 20) return 1.5;
  if (elapsedSeconds < 60) return 1.2;
  if (elapsedSeconds < 90) return 1.0;
  return 0.7;
}

export function getTimeLabel(multiplier: number): string {
  if (multiplier >= 1.5) return "⚡ LIGHTNING FAST!";
  if (multiplier >= 1.2) return "🔥 Quick!";
  if (multiplier >= 1.0) return "";
  if (multiplier > 0) return "🐌 Too slow...";
  return "⏰ Time's up!";
}

export { ROUND_TIME };
