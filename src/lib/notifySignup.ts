import { supabase } from "@/lib/supabase";

export function notifyNewSignup(username: string) {
  supabase.functions.invoke("notify-signup", { body: { username } }).catch(() => {});
}
