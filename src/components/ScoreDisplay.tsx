import { motion } from 'framer-motion';

interface ScoreDisplayProps {
  distance: number;
  score: number;
  city: string;
  country: string;
}

export default function ScoreDisplay({ distance, score, city, country }: ScoreDisplayProps) {
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

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 15 }}
      className="bg-card border-2 border-primary rounded-lg p-6 text-center space-y-3"
    >
      <div className="text-4xl">{getEmoji(score)}</div>
      <div className="text-3xl font-black text-gradient-hot">{score.toLocaleString()} pts</div>
      <p className="text-lg font-bold text-foreground">{getMessage(score)}</p>
      <p className="text-muted-foreground">
        {Math.round(distance)} km away from <span className="text-secondary font-bold">{city}, {country}</span>
      </p>
    </motion.div>
  );
}
