import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { VideoClue } from '../lib/supabase';

// Shown after a guess: the visual clues found in the clip, each one zoomed in like a GeoGuessr breakdown.
// Tap a card to toggle between the full frame (box outlined) and the zoomed clue.
export default function ClueReveal({ clues }: { clues?: VideoClue[] | null }) {
  // Show every frame whole, with the clue outlined in yellow, then zoom in once the images are on screen.
  const [zoomed, setZoomed] = useState(false);
  const [ready, setReady] = useState(0);
  const total = clues?.filter((c) => c.frame_url && c.box && c.box.length === 4).length ?? 0;

  useEffect(() => {
    setZoomed(false);
    setReady(0);
  }, [clues]);

  useEffect(() => {
    if (total === 0 || ready < total) return;
    const timer = setTimeout(() => setZoomed(true), 1600);
    return () => clearTimeout(timer);
  }, [ready, total]);

  if (!clues || clues.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="mt-2"
    >
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Clues you could have spotted <span className="font-normal normal-case">(tap a clue to zoom in / out)</span>
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {clues.map((clue, i) => (
          <ClueCard
            key={i}
            clue={clue}
            zoomed={zoomed}
            onToggle={() => setZoomed((z) => !z)}
            onLoaded={() => setReady((n) => n + 1)}
          />
        ))}
      </div>
    </motion.div>
  );
}

function ClueCard({
  clue,
  zoomed,
  onToggle,
  onLoaded,
}: {
  clue: VideoClue;
  zoomed: boolean;
  onToggle: () => void;
  onLoaded: () => void;
}) {
  const box = clue.box && clue.box.length === 4 ? clue.box : null;
  const canZoom = !!clue.frame_url && !!box;
  if (!clue.crop_url && !clue.frame_url) {
    return (
      <figure className="flex w-44 shrink-0 select-none flex-col lg:w-56">
        <div className="flex aspect-video items-center justify-center rounded-md border border-border bg-card px-3 text-center text-2xl">
          🎧
        </div>
        <figcaption className="mt-1 text-[11px] leading-tight text-foreground">{clue.text}</figcaption>
      </figure>
    );
  }

  let target = { x: '0%', y: '0%', scale: 1 };
  let outline: { left: string; top: string; width: string; height: string } | null = null;
  if (box) {
    const [y0, x0, y1, x1] = box;
    const w = Math.max(x1 - x0, 0.06);
    const h = Math.max(y1 - y0, 0.06);
    const cx = ((x0 + x1) / 2) * 100;
    const cy = ((y0 + y1) / 2) * 100;
    const scale = Math.min(1 / w, 1 / h, 4) * 0.85;
    // translate(t) scale(s) around the centre o maps a point p to s·(p − o) + o + t: to bring the box
    // centre c to o, t must be s·(o − c) — the translation scales with the zoom.
    target = { x: `${(50 - cx) * scale}%`, y: `${(50 - cy) * scale}%`, scale };
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
              initial={false}
              animate={zoomed ? target : { x: '0%', y: '0%', scale: 1 }}
              transition={{ duration: 1.1, ease: 'easeInOut' }}
              className="h-full w-full object-cover"
              draggable={false}
              onLoad={onLoaded}
              onError={onLoaded}
            />
            {outline && (
              <motion.div
                className="pointer-events-none absolute rounded-sm border-2 border-secondary"
                style={outline}
                animate={{ opacity: zoomed ? 0 : 1 }}
                transition={{ duration: 0.4 }}
              />
            )}
          </>
        ) : (
          <img src={clue.crop_url ?? undefined} alt={clue.text} className="h-full w-full object-cover" draggable={false} />
        )}
      </div>
      <figcaption className="mt-1 text-[11px] leading-tight text-foreground">{clue.text}</figcaption>
    </figure>
  );
}
