import { useState } from 'react';
import { motion } from 'framer-motion';
import type { VideoClue } from '../lib/supabase';

// Shown after a guess: each clue is the whole frame with the clue outlined in yellow.
// Tapping a card zooms into the outline; tapping again zooms back out. Nothing moves on its own.
export default function ClueReveal({ clues }: { clues?: VideoClue[] | null }) {
  if (!clues || clues.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mt-2">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Clues <span className="font-normal normal-case">· tap a clue to zoom</span>
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
        {clues.map((clue, i) => (
          <ClueCard key={i} clue={clue} />
        ))}
      </div>
    </motion.div>
  );
}

function ClueCard({ clue }: { clue: VideoClue }) {
  const [zoomed, setZoomed] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
    // translate(t) scale(s) around the centre o maps p to s·(p − o) + o + t: bringing the box centre c
    // to o needs t = s·(o − c).
    target = { x: `${(50 - cx) * scale}%`, y: `${(50 - cy) * scale}%`, scale };
    outline = { left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` };
  }

  return (
    <figure className="w-40 shrink-0 select-none sm:w-48">
      <div
        className="relative aspect-video cursor-pointer overflow-hidden rounded-md border border-border bg-black"
        onClick={() => canZoom && setZoomed((z) => !z)}
      >
        {clue.frame_url ? (
          <>
            <motion.img
              src={clue.frame_url}
              alt={clue.text}
              initial={false}
              animate={zoomed ? target : { x: '0%', y: '0%', scale: 1 }}
              transition={{ duration: 0.8, ease: 'easeInOut' }}
              className="h-full w-full object-cover"
              draggable={false}
            />
            {outline && (
              <motion.div
                className="pointer-events-none absolute rounded-sm border-[3px] border-yellow-400 shadow-[0_0_0_2px_rgba(0,0,0,.6)]"
                style={outline}
                initial={false}
                animate={{ opacity: zoomed ? 0 : 1 }}
                transition={{ duration: 0.3 }}
              />
            )}
          </>
        ) : clue.crop_url ? (
          <img src={clue.crop_url} alt={clue.text} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl">🎧</div>
        )}
      </div>
      <figcaption
        className={`mt-1 cursor-pointer text-[11px] leading-tight text-foreground ${expanded ? '' : 'line-clamp-2'}`}
        onClick={() => setExpanded((e) => !e)}
      >
        {clue.text}
      </figcaption>
    </figure>
  );
}
