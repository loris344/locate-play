import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGameAccess } from '@/hooks/useGameAccess';
import { motion } from 'framer-motion';
import { ArrowLeft, Crown, CheckCircle, XCircle, Loader2, Clock, Instagram, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StripePricingTable from '@/components/StripePricingTable';
import { useState, useEffect } from 'react';
import lorisImg from '@/assets/loris.png';

function ResetCountdown() {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    function calc() {
      const now = new Date();
      const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
      const diff = tomorrow.getTime() - now.getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`);
    }
    calc();
    const interval = setInterval(calc, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Clock className="w-4 h-4" />
      <span>New free games in <span className="font-bold text-foreground">{timeLeft}</span></span>
    </div>
  );
}

export default function Subscription() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isSubscribed, gamesPlayedToday, loading } = useGameAccess();

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-lg p-8 text-center max-w-md space-y-4">
          <Crown className="w-12 h-12 text-secondary mx-auto" />
          <h2 className="text-2xl font-black text-gradient-hot">SIGN IN REQUIRED</h2>
          <p className="text-muted-foreground">Sign in to manage your subscription.</p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => navigate('/auth?redirect=/subscription')} className="bg-gradient-hot font-bold">
              Sign In
            </Button>
            <Button onClick={() => navigate('/')} variant="outline">Home</Button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-black text-gradient-hot">MY PLAN</h1>
        </div>

        {/* Current status */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-xl border-2 p-6 space-y-3 ${
            isSubscribed ? 'border-green-500 bg-green-500/10' : 'border-border bg-card'
          }`}
        >
          <div className="flex items-center gap-3">
            {isSubscribed ? (
              <CheckCircle className="w-8 h-8 text-green-500" />
            ) : (
              <XCircle className="w-8 h-8 text-muted-foreground" />
            )}
            <div>
              <p className="text-xl font-black text-foreground">
                {isSubscribed ? 'PREMIUM — Unlimited Games 🔥' : 'FREE PLAN'}
              </p>
              <p className="text-sm text-muted-foreground">
                {isSubscribed
                  ? 'You have unlimited access to all games.'
                  : gamesPlayedToday >= 2
                    ? `Daily free limit reached (${Math.min(gamesPlayedToday, 2)}/2).`
                    : `${gamesPlayedToday}/2 free daily games used`}
              </p>
            </div>
          </div>
          {!isSubscribed && gamesPlayedToday >= 2 && <ResetCountdown />}
        </motion.div>

        {/* Pricing table if not subscribed */}
        {!isSubscribed && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-4"
          >
            <h2 className="text-xl font-black text-foreground text-center">
              Go Premium for Unlimited Play 👑
            </h2>
            <StripePricingTable />
          </motion.div>
        )}

        <p className="text-xs text-muted-foreground text-center">
          {user.email}
        </p>

        {/* Contact discret */}
        <div className="pt-4 border-t border-border">
          <a
            href="https://instagram.com/loris_dtg"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mx-auto w-fit text-xs"
          >
            <img src={lorisImg} alt="" className="w-7 h-7 rounded-full object-cover" />
            <span>Bug or question?</span>
            <Instagram className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
