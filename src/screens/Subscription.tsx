"use client";

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useGameAccess } from '@/hooks/useGameAccess';
import { motion } from 'framer-motion';
import { ArrowLeft, Crown, CheckCircle, XCircle, Loader2, Clock, Mail, Calendar, Settings, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StripePricingTable from '@/components/StripePricingTable';
import { useState, useEffect } from 'react';
import lorisImg from '@/assets/loris.png';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

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
  const router = useRouter();
  const navigate = router.push;
  const { user } = useAuth();
  const { isSubscribed, subscriptionEnd, cancelAt, planLabel, gamesPlayedToday, loading } = useGameAccess();
  const { toast } = useToast();
  const [openingPortal, setOpeningPortal] = useState<'update' | 'cancel' | null>(null);

  const handleManageSubscription = async (flow: 'update' | 'cancel') => {
    setOpeningPortal(flow);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-portal', { body: { flow } });
      if (error || !data?.url) throw error || new Error('Could not open the billing portal');
      window.location.href = data.url;
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Could not open the billing portal',
        variant: 'destructive',
      });
      setOpeningPortal(null);
    }
  };

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
            isSubscribed
              ? cancelAt
                ? 'border-yellow-500 bg-yellow-500/10'
                : 'border-green-500 bg-green-500/10'
              : 'border-border bg-card'
          }`}
        >
          <div className="flex items-center gap-3">
            {isSubscribed ? (
              <CheckCircle className={`w-8 h-8 ${cancelAt ? 'text-yellow-500' : 'text-green-500'}`} />
            ) : (
              <XCircle className="w-8 h-8 text-muted-foreground" />
            )}
            <div>
              <p className="text-xl font-black text-foreground">
                {isSubscribed ? `${planLabel || 'PREMIUM'} 👑` : 'FREE PLAN'}
              </p>
              <p className="text-sm text-muted-foreground">
                {isSubscribed
                  ? cancelAt
                    ? `Unlimited games • Cancels ${new Date(cancelAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
                    : subscriptionEnd
                      ? `Unlimited games • Renews ${new Date(subscriptionEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
                      : 'Unlimited games'
                  : gamesPlayedToday >= 2
                    ? `Daily free limit reached (${Math.min(gamesPlayedToday, 2)}/2).`
                    : `${gamesPlayedToday}/2 free daily games used`}
              </p>
              {isSubscribed && subscriptionEnd && (() => {
                const days = Math.max(0, Math.ceil((new Date(subscriptionEnd).getTime() - Date.now()) / 86400000));
                return (
                  <div className="flex items-center gap-1.5 mt-1 text-xs text-green-400">
                    <Calendar className="w-3 h-3" />
                    <span>{days} {days === 1 ? 'day' : 'days'} remaining</span>
                  </div>
                );
              })()}
            </div>
          </div>
          {!isSubscribed && gamesPlayedToday >= 2 && <ResetCountdown />}
        </motion.div>

        {isSubscribed && (
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={() => handleManageSubscription('update')}
              disabled={openingPortal !== null}
              variant="outline"
              className="font-bold"
            >
              {openingPortal === 'update' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Settings className="mr-2 h-4 w-4" />}
              Change Plan
            </Button>
            <Button
              onClick={() => handleManageSubscription('cancel')}
              disabled={openingPortal !== null}
              variant="outline"
              className="font-bold text-destructive hover:text-destructive"
            >
              {openingPortal === 'cancel' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
              Cancel Subscription
            </Button>
          </div>
        )}

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
            href="mailto:lorisjsd@gmail.com"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mx-auto w-fit text-xs"
          >
            <img src={lorisImg.src} alt="" className="w-7 h-7 rounded-full object-cover" />
            <span>Bug or question?</span>
            <Mail className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
