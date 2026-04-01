import { motion } from "framer-motion";
import { MapPin } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

interface RoundIntroProps {
  actorName?: string;
  actorPhotoUrl?: string;
  round: number;
  totalRounds: number;
}

export default function RoundIntro({ actorName, actorPhotoUrl, round, totalRounds }: RoundIntroProps) {
  const displayName = actorName || "this location";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
        className="flex flex-col items-center gap-5 text-center px-6"
      >
        <span className="text-sm font-bold text-muted-foreground tracking-widest uppercase">
          Round {round}/{totalRounds}
        </span>

        {actorPhotoUrl && (
          <Avatar className="h-28 w-28 border-4 border-primary shadow-glow">
            <AvatarImage src={actorPhotoUrl} alt={actorName || "Actor"} />
            <AvatarFallback className="text-3xl font-black">
              {actorName?.[0] ?? "?"}
            </AvatarFallback>
          </Avatar>
        )}

        <h2 className="text-3xl md:text-5xl font-black text-foreground">
          Find{" "}
          <span className="text-gradient-hot">{displayName}</span>
        </h2>

        <MapPin className="h-8 w-8 text-primary animate-bounce" />
      </motion.div>
    </motion.div>
  );
}
