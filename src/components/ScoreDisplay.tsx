import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface ScoreDisplayProps {
  distance: number;
  score: number;
  city: string;
  country: string;
}

export default function ScoreDisplay({ distance, score, city, country }: ScoreDisplayProps) {
  const [dismissed, setDismissed] = useState(false);

  const getEmoji = (score: number) => {
    if (score >= 4500) return '🔥🔥🔥';
    if (score >= 3000) return '🔥🔥';
    if (score >= 1500) return '🔥';
    if (score >= 500) return '😏';
    return '💀';
  };

  const getMessage = (score: number) => {
    if (score >= 4500) return 'INSANE! You know your stuff!';
    if (score >= 3000) return 'Pretty damn good!';
    if (score >= 1500) return 'Not bad, keep grinding!';
    if (score >= 500) return 'Room for improvement...';
    return 'Bruh... way off!';
  };

  if (dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="bg-card border-2 border-primary rounded-lg p-4 text-center space-y-2 relative"
      >
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-2 right-2 bg-muted hover:bg-muted-foreground/20 rounded-full p-1.5 transition-colors"
          aria-label="Fermer"
        >
          <X className="w-5 h-5 text-foreground" />
        </button>
        <div className="text-3xl">{getEmoji(score)}</div>
        <div className="text-2xl font-black text-gradient-hot">{score.toLocaleString()} pts</div>
        <p className="text-sm font-bold text-foreground">{getMessage(score)}</p>
        <p className="text-xs text-muted-foreground">
          {Math.round(distance)} km from <span className="text-secondary font-bold">{city}, {country}</span>
        </p>
      </motion.div>
    </AnimatePresence>
  );
}
