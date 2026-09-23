import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { VideoClue } from '../lib/supabase';

// Shown after a guess: the visual clues found in the clip, each one zoomed in like a GeoGuessr breakdown.
// Tap a card to toggle between the full frame (box outlined) and the zoomed clue.
export default function ClueReveal({ clues }: { clues?: VideoClue[] | null }) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    setZoomed(false);
    const timer = setTimeout(() => setZoomed(true), 900);
    return () => clearTimeout(timer);
  }, [clues]);

  if (!clues || clues.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="mt-2"
    >
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Clues you could have spotted
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {clues.map((clue, i) => (
          <ClueCard key={i} clue={clue} zoomed={zoomed} onToggle={() => setZoomed((z) => !z)} />
        ))}
      </div>
    </motion.div>
  );
}

function ClueCard({ clue, zoomed, onToggle }: { clue: VideoClue; zoomed: boolean; onToggle: () => void }) {
  const box = clue.box && clue.box.length === 4 ? clue.box : null;
  const canZoom = !!clue.frame_url && !!box;

  let target = { x: '0%', y: '0%', scale: 1 };
  let outline: { left: string; top: string; width: string; height: string } | null = null;
  if (box) {
    const [y0, x0, y1, x1] = box;
    const w = Math.max(x1 - x0, 0.06);
    const h = Math.max(y1 - y0, 0.06);
    const cx = ((x0 + x1) / 2) * 100;
    const cy = ((y0 + y1) / 2) * 100;
    const scale = Math.min(1 / w, 1 / h, 4) * 0.85;
    // translate the box centre to the middle of the card, then scale around the middle
    target = { x: `${50 - cx}%`, y: `${50 - cy}%`, scale };
    outline = { left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` };
  }

  return (
    <figure className="w-44 shrink-0 cursor-pointer select-none lg:w-56" onClick={onToggle}>
      <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-black">
        {canZoom ? (
          <>
            <motion.img
              src={clue.frame_url}
              alt={clue.text}
              animate={zoomed ? target : { x: '0%', y: '0%', scale: 1 }}
              transition={{ duration: 1.1, ease: 'easeInOut' }}
              className="h-full w-full object-cover"
              draggable={false}
            />
            {outline && !zoomed && (
              <div className="pointer-events-none absolute rounded-sm border-2 border-secondary" style={outline} />
            )}
          </>
        ) : (
          <img src={clue.crop_url} alt={clue.text} className="h-full w-full object-cover" draggable={false} />
        )}
      </div>
      <figcaption className="mt-1 text-[11px] leading-tight text-foreground">{clue.text}</figcaption>
    </figure>
  );
}
