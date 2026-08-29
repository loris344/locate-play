import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Crown, LogOut, Settings, Trophy, Gamepad2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface UserStats {
  total_score: number;
  games_played: number;
}

export default function UserProfilePopover({ isSubscribed }: { isSubscribed: boolean }) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const username = user?.user_metadata?.username || user?.email || 'Player';

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
    supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => setAvatarUrl(data?.avatar_url ?? null));
  }, [user]);

  if (!user) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 rounded-full border border-border bg-card pl-1 pr-3 py-1 text-sm font-bold text-foreground hover:border-primary/50 transition-colors cursor-pointer">
          <Avatar className="h-6 w-6">
            <AvatarImage src={avatarUrl || undefined} alt={username} />
            <AvatarFallback className="bg-primary/20 text-primary text-[10px] font-black">
              {username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {isSubscribed && <Crown className="h-4 w-4 text-yellow-400" />}
          {username}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4 space-y-3" align="end">
        <div className="flex items-center gap-2">
          <Avatar className="h-9 w-9">
            <AvatarImage src={avatarUrl || undefined} alt={username} />
            <AvatarFallback className="bg-primary/20 text-primary text-xs font-black">
              {username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
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
        <Button variant="ghost" size="sm" className="w-full" onClick={() => router.push('/account')}>
          <Settings className="h-4 w-4 mr-2" /> My Account
        </Button>
        <Button variant="ghost" size="sm" className="w-full" onClick={signOut}>
          <LogOut className="h-4 w-4 mr-2" /> Sign Out
        </Button>
      </PopoverContent>
    </Popover>
  );
}
