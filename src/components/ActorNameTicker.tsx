import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";

export default function ActorNameTicker() {
  const [names, setNames] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    supabase
      .from("videos")
      .select("actor_name")
      .not("actor_name", "is", null)
      .then(({ data }) => {
        if (data) {
          const unique = [...new Set(data.map((d) => d.actor_name).filter(Boolean))] as string[];
          setNames(unique.sort(() => Math.random() - 0.5));
        }
      });
  }, []);

  useEffect(() => {
    if (names.length === 0) return;
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % names.length);
    }, 3500);
    return () => clearInterval(interval);
  }, [names]);

  if (names.length === 0) return null;

  return (
    <div className="h-10 flex items-center justify-center overflow-hidden relative">
      <span className="text-muted-foreground text-lg font-semibold mr-2">Find</span>
      <AnimatePresence mode="wait">
        <motion.span
          key={names[index]}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -20, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="text-lg font-black text-gradient-hot"
        >
          {names[index]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
