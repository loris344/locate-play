import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Lock, LogIn } from 'lucide-react';
import StripePricingTable from '@/components/StripePricingTable';

interface StripePaywallProps {
  reason: 'signin_required' | 'paywall';
}

export default function StripePaywall({ reason }: StripePaywallProps) {
  const navigate = useNavigate();

  if (reason === 'signin_required') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-card border border-border rounded-lg p-8 text-center max-w-md space-y-6"
        >
          <LogIn className="w-16 h-16 text-primary mx-auto" />
          <h2 className="text-3xl font-black text-gradient-hot">CREATE YOUR ACCOUNT</h2>
          <p className="text-muted-foreground">
            You've used your free game! Sign up to keep playing (2 free games per day).
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => navigate('/auth?redirect=/game')} className="bg-gradient-hot font-black text-lg px-8 py-3 h-auto">
              <LogIn className="mr-2 h-5 w-5" />
              SIGN UP
            </Button>
            <Button onClick={() => navigate('/')} variant="outline">
              Home
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-card border border-border rounded-lg p-8 text-center max-w-lg space-y-6"
      >
        <Lock className="w-16 h-16 text-secondary mx-auto" />
        <h2 className="text-3xl font-black text-gradient-hot">GAMES EXHAUSTED</h2>
        <p className="text-muted-foreground">
          You've used your 2 free daily games. Go premium for unlimited play! 🔥
        </p>

        <StripePricingTable />

        <Button onClick={() => navigate('/')} variant="outline" className="mt-4">
          Home
        </Button>
      </motion.div>
    </div>
  );
}
