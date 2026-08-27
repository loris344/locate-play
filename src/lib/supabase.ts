import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://ejdvrtflsvvylezymsft.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqZHZydGZsc3Z2eWxlenltc2Z0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4Mjc1NzAsImV4cCI6MjEwMzQwMzU3MH0.Q_RfyAxz2xs2IyuXFMRjG_8i2Hc1MO7Q7crTgVEo1EE';

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
