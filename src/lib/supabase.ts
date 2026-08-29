import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ejdvrtflsvvylezymsft.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqZHZydGZsc3Z2eWxlenltc2Z0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4Mjc1NzAsImV4cCI6MjEwMzQwMzU3MH0.Q_RfyAxz2xs2IyuXFMRjG_8i2Hc1MO7Q7crTgVEo1EE';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Video {
  id: string;
  video_url: string;
  latitude: number;
  longitude: number;
  city: string;
  country: string;
  actor_name?: string;
  actor_photo_url?: string;
  source_url?: string;
}

export interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  instagram_handle: string | null;
  facebook_handle: string | null;
  show_social: boolean;
  username_updated_at: string | null;
}
