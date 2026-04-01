import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://mrvzoghginbbqnmjdmqr.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ydnpvZ2hnaW5iYnFubWpkbXFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MTE4MzMsImV4cCI6MjA5MDQ4NzgzM30.88Alc3vJU0zEFojk1ofWsn1X-yMY-wDXzHWO7nmfaY4';

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
