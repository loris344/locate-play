import { motion } from 'framer-motion';
import { ExternalLink } from 'lucide-react';

interface ScoreDisplayProps {
  distance: number;
  score: number;
  city: string;
  country: string;
  timeMultiplier?: number;
  baseScore?: number;
  sourceUrl?: string;
}

// One compact line: the score, the distance and the answer. The clues (ClueReveal) sit right under it.
export default function ScoreDisplay({ distance, score, city, country, sourceUrl }: ScoreDisplayProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="mt-1 flex items-center gap-3 rounded-lg border border-primary bg-card px-3 py-1.5"
    >
      <span className="shrink-0 whitespace-nowrap text-base font-black leading-none text-gradient-hot sm:text-lg">{score.toLocaleString()} pts</span>
      <span className="min-w-0 truncate text-xs text-muted-foreground">
        {Math.round(distance)} km from <span className="font-bold text-secondary">{city}, {country}</span>
      </span>
      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-bold text-primary hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Original
        </a>
      )}
    </motion.div>
  );
}
