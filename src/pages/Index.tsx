import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { MapPin, Play, Globe } from 'lucide-react';

export default function Index() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-64 h-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 w-64 h-64 rounded-full bg-secondary/10 blur-3xl" />
      </div>

      <motion.div
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-center space-y-8 relative z-10 max-w-lg"
      >
        {/* Logo */}
        <div className="space-y-2">
          <motion.h1
            className="text-6xl md:text-8xl font-black text-gradient-hot tracking-tighter leading-none"
            initial={{ scale: 0.5 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, delay: 0.2 }}
          >
            PORNO
            <br />
            GUESSR
          </motion.h1>
          <motion.p
            className="text-muted-foreground text-lg font-medium"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            Watch. Guess. Score. 🌍🔥
          </motion.p>
        </div>

        {/* How it works */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="grid grid-cols-3 gap-4 text-center"
        >
          {[
            { icon: Play, label: 'Watch a clip', color: 'text-primary' },
            { icon: MapPin, label: 'Pin the location', color: 'text-secondary' },
            { icon: Globe, label: 'Score points', color: 'text-accent' },
          ].map(({ icon: Icon, label, color }, i) => (
            <div key={i} className="space-y-2">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                <Icon className={`w-6 h-6 ${color}`} />
              </div>
              <p className="text-sm font-bold text-foreground">{label}</p>
            </div>
          ))}
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
        >
          <Button
            onClick={() => navigate('/game')}
            size="lg"
            className="bg-gradient-hot font-black text-xl px-12 py-6 h-auto shadow-glow animate-pulse-glow hover:scale-105 transition-transform"
          >
            PLAY NOW 🎯
          </Button>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
          className="text-muted-foreground text-xs"
        >
          18+ only • 5 rounds per game • No account needed
        </motion.p>
      </motion.div>
    </div>
  );
}
