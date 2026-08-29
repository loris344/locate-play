"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LiveVisitorCount() {
  const [count, setCount] = useState(1);

  useEffect(() => {
    const key = crypto.randomUUID();
    const channel = supabase.channel("homepage-presence", {
      config: { presence: { key } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      setCount(Math.max(1, Object.keys(state).length));
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ online_at: new Date().toISOString() });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
      </span>
      <span>
        <span className="font-bold text-foreground">{count}</span> {count === 1 ? "person" : "people"} here right now
      </span>
    </div>
  );
}
