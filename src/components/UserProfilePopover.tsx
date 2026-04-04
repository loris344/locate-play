import { useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Crown, LogOut, User, Trophy, Gamepad2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface UserStats {
  total_score: number;
  games_played: number;
}

export default function UserProfilePopover({ isSubscribed }: { isSubscribed: boolean }) {
  const { user, signOut } = useAuth();
  const [stats, setStats] = useState<UserStats | null>(null);

  const username = user?.user_metadata?.username || user?.email || 'Joueur';

  useEffect(() => {
    if (!user) return;
    supabase
      .from('game_scores')
      .select('total_score')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data) {
          setStats({
            total_score: data.reduce((sum, r) => sum + (r.total_score || 0), 0),
            games_played: data.length,
          });
        }
      });
  }, [user]);

  if (!user) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer">
          {isSubscribed && <Crown className="h-4 w-4 text-yellow-400" />}
          {username}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4 space-y-3" align="end">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-bold text-foreground text-sm">{username}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-muted rounded-lg p-2 text-center">
            <Trophy className="h-4 w-4 text-secondary mx-auto mb-1" />
            <p className="text-lg font-black text-foreground">{stats?.total_score?.toLocaleString() ?? '—'}</p>
            <p className="text-[10px] text-muted-foreground">Points</p>
          </div>
          <div className="bg-muted rounded-lg p-2 text-center">
            <Gamepad2 className="h-4 w-4 text-primary mx-auto mb-1" />
            <p className="text-lg font-black text-foreground">{stats?.games_played ?? '—'}</p>
            <p className="text-[10px] text-muted-foreground">Parties</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="w-full" onClick={signOut}>
          <LogOut className="h-4 w-4 mr-2" /> Déconnexion
        </Button>
      </PopoverContent>
    </Popover>
  );
}
