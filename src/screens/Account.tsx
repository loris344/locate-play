"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Crown, Gamepad2, Loader2, Mail, Pencil, Trophy, Upload, User, X } from "lucide-react";
import lorisImg from "@/assets/loris.png";
import { supabase, Profile } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useGameAccess } from "@/hooks/useGameAccess";
import { resizeImageToBlob } from "@/lib/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";

interface Stats {
  total_score: number;
  games_played: number;
}

const USERNAME_COOLDOWN_DAYS = 30;

export default function Account() {
  const router = useRouter();
  const { user } = useAuth();
  const gameAccess = useGameAccess();
  const { toast } = useToast();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [usernameInput, setUsernameInput] = useState("");
  const [instagram, setInstagram] = useState("");
  const [facebook, setFacebook] = useState("");
  const [showSocial, setShowSocial] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;

    async function load() {
      const [{ data: profileData }, { data: scores }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle(),
        supabase.from("game_scores").select("total_score").eq("user_id", user!.id),
      ]);

      if (profileData) {
        setProfile(profileData as Profile);
        setUsernameInput(profileData.username || "");
        setInstagram(profileData.instagram_handle || "");
        setFacebook(profileData.facebook_handle || "");
        setShowSocial(!!profileData.show_social);
      }

      if (scores) {
        setStats({
          total_score: scores.reduce((sum, r) => sum + (r.total_score || 0), 0),
          games_played: scores.length,
        });
      }
      setLoading(false);
    }

    load();
  }, [user]);

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-lg p-8 text-center max-w-md space-y-4">
          <User className="w-12 h-12 text-secondary mx-auto" />
          <h2 className="text-2xl font-black text-gradient-hot">SIGN IN REQUIRED</h2>
          <p className="text-muted-foreground">Sign in to manage your account.</p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => router.push("/auth?redirect=/account")} className="bg-gradient-hot font-bold">
              Sign In
            </Button>
            <Button onClick={() => router.push("/")} variant="outline">
              Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const username = profile?.username || user.user_metadata?.username || "Player";

  const lastUsernameChange = profile?.username_updated_at ? new Date(profile.username_updated_at) : null;
  const nextUsernameChangeAt = lastUsernameChange
    ? new Date(lastUsernameChange.getTime() + USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
    : null;
  const canChangeUsername = !nextUsernameChangeAt || nextUsernameChangeAt.getTime() <= Date.now();

  const handleAvatarPick = () => fileInputRef.current?.click();

  const handleEditUsernameClick = () => {
    if (!canChangeUsername) {
      toast({
        title: "Username locked",
        description: `You can change it again on ${nextUsernameChangeAt?.toLocaleDateString()}.`,
      });
      return;
    }
    setUsernameInput(username);
    setIsEditingUsername(true);
  };

  const handleCancelUsernameEdit = () => {
    setUsernameInput(username);
    setIsEditingUsername(false);
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    try {
      const blob = await resizeImageToBlob(file);
      const path = `${user.id}/avatar.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from("avatars").getPublicUrl(path);
      const avatarUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

      const { error: dbError } = await supabase
        .from("profiles")
        .upsert({ id: user.id, username, avatar_url: avatarUrl });
      if (dbError) throw dbError;

      setProfile((prev) => (prev ? { ...prev, avatar_url: avatarUrl } : prev));
      toast({ title: "Photo updated!" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Upload failed",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleUsernameSave = async () => {
    const trimmed = usernameInput.trim();
    if (!trimmed || trimmed === profile?.username) return;

    setSavingUsername(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ data: { username: trimmed } });
      if (authError) throw authError;

      const { data: updated, error: dbError } = await supabase
        .from("profiles")
        .update({ username: trimmed })
        .eq("id", user.id)
        .select()
        .single();
      if (dbError) throw dbError;

      setProfile(updated as Profile);
      setIsEditingUsername(false);
      toast({ title: "Username updated!" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not update username",
        variant: "destructive",
      });
    } finally {
      setSavingUsername(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      username,
      instagram_handle: instagram.trim() || null,
      facebook_handle: facebook.trim() || null,
      show_social: showSocial,
    });
    setSaving(false);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Profile saved!" });
    }
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-black text-gradient-hot">MY ACCOUNT</h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            {/* Avatar + identity */}
            <div className="bg-card border border-border rounded-lg p-6 flex items-center gap-4">
              <button onClick={handleAvatarPick} className="relative shrink-0" disabled={uploading}>
                <Avatar className="h-16 w-16 border-2 border-primary/50">
                  <AvatarImage src={profile?.avatar_url || undefined} alt={username} />
                  <AvatarFallback className="text-lg font-black">
                    {username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-primary flex items-center justify-center border-2 border-card">
                  {uploading ? (
                    <Loader2 className="h-3 w-3 animate-spin text-primary-foreground" />
                  ) : (
                    <Upload className="h-3 w-3 text-primary-foreground" />
                  )}
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <div className="min-w-0 flex-1">
                {isEditingUsername ? (
                  <div className="flex items-center gap-1">
                    <Input
                      autoFocus
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      minLength={2}
                      maxLength={20}
                      className="h-8 bg-muted border-border font-bold"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleUsernameSave();
                        if (e.key === "Escape") handleCancelUsernameEdit();
                      }}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      disabled={savingUsername || !usernameInput.trim() || usernameInput.trim() === profile?.username}
                      onClick={handleUsernameSave}
                    >
                      {savingUsername ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={handleCancelUsernameEdit}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <p className="font-bold text-foreground truncate">{username}</p>
                    <button onClick={handleEditUsernameClick} className="text-muted-foreground hover:text-foreground shrink-0">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>

            {/* Stats + plan */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-muted rounded-lg p-3 text-center">
                <Trophy className="h-4 w-4 text-secondary mx-auto mb-1" />
                <p className="text-lg font-black text-foreground">
                  {stats?.total_score?.toLocaleString() ?? "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">Points</p>
              </div>
              <div className="bg-muted rounded-lg p-3 text-center">
                <Gamepad2 className="h-4 w-4 text-primary mx-auto mb-1" />
                <p className="text-lg font-black text-foreground">{stats?.games_played ?? "—"}</p>
                <p className="text-[10px] text-muted-foreground">Games</p>
              </div>
              <div className="bg-muted rounded-lg p-3 text-center">
                <Crown className="h-4 w-4 text-yellow-400 mx-auto mb-1" />
                <p className="text-sm font-black text-foreground truncate">
                  {gameAccess.isSubscribed ? gameAccess.planLabel || "Premium" : "Free"}
                </p>
                <p className="text-[10px] text-muted-foreground">Plan</p>
              </div>
            </div>

            {/* Social links */}
            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="instagram">Instagram</Label>
                <Input
                  id="instagram"
                  placeholder="@yourhandle"
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value)}
                  className="bg-muted border-border"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="facebook">Facebook</Label>
                <Input
                  id="facebook"
                  placeholder="facebook.com/yourhandle"
                  value={facebook}
                  onChange={(e) => setFacebook(e.target.value)}
                  className="bg-muted border-border"
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                <div>
                  <p className="text-sm font-bold text-foreground">Show on leaderboard</p>
                  <p className="text-xs text-muted-foreground">Your social links will be publicly visible</p>
                </div>
                <Switch checked={showSocial} onCheckedChange={setShowSocial} />
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-full bg-gradient-hot font-black">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                SAVE
              </Button>
            </div>

            <div className="pt-2 border-t border-border">
              <a
                href="mailto:lorisjsd@gmail.com"
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mx-auto w-fit text-xs pt-4"
              >
                <img src={lorisImg.src} alt="" className="w-7 h-7 rounded-full object-cover" />
                <span>Bug or question?</span>
                <Mail className="w-3.5 h-3.5" />
              </a>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
