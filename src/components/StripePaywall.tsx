import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Lock, LogIn } from 'lucide-react';

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
          <h2 className="text-3xl font-black text-gradient-hot">CRÉE TON COMPTE</h2>
          <p className="text-muted-foreground">
            Tu as joué ta partie gratuite ! Connecte-toi pour continuer à jouer (2 parties gratuites par jour).
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => navigate('/auth')} className="bg-gradient-hot font-black text-lg px-8 py-3 h-auto">
              <LogIn className="mr-2 h-5 w-5" />
              S'INSCRIRE
            </Button>
            <Button onClick={() => navigate('/')} variant="outline">
              Accueil
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
        <h2 className="text-3xl font-black text-gradient-hot">PARTIES ÉPUISÉES</h2>
        <p className="text-muted-foreground">
          Tu as utilisé tes 2 parties gratuites du jour. Passe en premium pour jouer sans limite ! 🔥
        </p>

        <div className="w-full" dangerouslySetInnerHTML={{
          __html: `
            <script async src="https://js.stripe.com/v3/pricing-table.js"></script>
            <stripe-pricing-table
              pricing-table-id="prctbl_1TH1mMGxRwR5OjMT5TlwsDZf"
              publishable-key="pk_test_51TH15hGxRwR5OjMTKbMwEepA3ww5XKmUSimKNa8jWhoy35Zv2GzZ0914oSpKPpwASrksruRs98cMlewLTCLKLgRB00UgIEaiaJ">
            </stripe-pricing-table>
          `
        }} />

        <Button onClick={() => navigate('/')} variant="outline" className="mt-4">
          Accueil
        </Button>
      </motion.div>
    </div>
  );
}
