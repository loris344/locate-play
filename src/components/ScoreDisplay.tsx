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

// Big score, one small line for the answer. Nothing else: the clues sit right under it.
export default function ScoreDisplay({ distance, score, city, country, sourceUrl }: ScoreDisplayProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      className="mt-1 rounded-lg border-2 border-primary bg-card px-3 py-2 text-center"
    >
      <div className="text-3xl font-black leading-none text-gradient-hot sm:text-4xl">{score.toLocaleString()} pts</div>
      <div className="mt-1 flex items-center justify-center gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {Math.round(distance)} km from <span className="font-bold text-secondary">{city}, {country}</span>
        </span>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 font-bold text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Original
          </a>
        )}
      </div>
    </motion.div>
  );
}
