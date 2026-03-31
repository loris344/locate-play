import { useState, useEffect, useRef } from "react";
import { Timer } from "lucide-react";

const ROUND_TIME = 120; // seconds

interface RoundTimerProps {
  isActive: boolean;
  onTimeUp: () => void;
  onElapsedChange?: (elapsed: number) => void;
}

export default function RoundTimer({ isActive, onTimeUp, onElapsedChange }: RoundTimerProps) {
  const [timeLeft, setTimeLeft] = useState(ROUND_TIME);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    // Reset on new round
    setTimeLeft(ROUND_TIME);
    startTimeRef.current = Date.now();
  }, [isActive]);

  useEffect(() => {
    if (!isActive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    startTimeRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const remaining = Math.max(0, ROUND_TIME - elapsed);
      setTimeLeft(remaining);
      onElapsedChange?.(elapsed);

      if (remaining <= 0) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        onTimeUp();
      }
    }, 100);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, onTimeUp, onElapsedChange]);

  const percentage = (timeLeft / ROUND_TIME) * 100;
  const color =
    timeLeft > 30 ? "text-green-500" : timeLeft > 15 ? "text-yellow-500" : "text-red-500";
  const bgColor =
    timeLeft > 30 ? "bg-green-500" : timeLeft > 15 ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <Timer className={`w-4 h-4 ${color}`} />
      <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${bgColor} rounded-full transition-all duration-200`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className={`font-black text-sm tabular-nums ${color}`}>{timeLeft}s</span>
    </div>
  );
}

/**
 * Calculate time multiplier:
 * - Under 10s: 1.5x bonus
 * - 10-30s: 1.2x bonus  
 * - 30-45s: 1.0x (no change)
 * - 45-60s: 0.7x penalty
 * - Time ran out (60s): 0x
 */
export function getTimeMultiplier(elapsedSeconds: number): number {
  if (elapsedSeconds >= ROUND_TIME) return 0;
  if (elapsedSeconds < 10) return 1.5;
  if (elapsedSeconds < 30) return 1.2;
  if (elapsedSeconds < 45) return 1.0;
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
