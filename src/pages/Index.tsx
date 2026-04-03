import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { MapPin, Play, Globe, Trophy, LogIn, LogOut, Crown, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useGameAccess } from '@/hooks/useGameAccess';
import InfinitePhotoMosaic from '@/components/InfinitePhotoMosaic';
import ActorNameTicker from '@/components/ActorNameTicker';

export default function Index() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { isSubscribed } = useGameAccess();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Top bar */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-20">
        {user ? (
          <>
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              {isSubscribed && <Crown className="h-4 w-4 text-yellow-400" />}
              {user.user_metadata?.username || user.email}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => navigate('/auth')}>
            <LogIn className="h-4 w-4 mr-1" /> Sign in
          </Button>
        )}
      </div>

      {/* Photo mosaic background */}
      <InfinitePhotoMosaic />

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
            GEO
            <br />
            GUSHING
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
          className="flex gap-3"
        >
          <Button
            onClick={() => navigate('/game')}
            size="lg"
            className="bg-gradient-hot font-black text-xl px-12 py-6 h-auto shadow-glow animate-pulse-glow hover:scale-105 transition-transform"
          >
            PLAY NOW 🎯
          </Button>
          <Button
            onClick={() => navigate('/leaderboard')}
            size="lg"
            variant="outline"
            className="font-black text-lg px-6 py-6 h-auto hover:scale-105 transition-transform"
          >
            <Trophy className="mr-2 h-5 w-5 text-secondary" /> TOP
          </Button>
        </motion.div>

        {!user && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1 }}
            className="text-muted-foreground text-xs"
          >
            18+ only • 5 rounds per game • Sign in to save scores
          </motion.p>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.3 }}
          className="flex items-center gap-3 bg-muted/60 backdrop-blur-sm rounded-full px-6 py-3 border border-border/50"
        >
          <ShieldCheck className="h-5 w-5 text-accent shrink-0" />
          <span className="text-sm text-muted-foreground font-semibold">
            100% SFW — Stream-safe, no explicit content
          </span>
        </motion.div>
      </motion.div>
    </div>
  );
}
