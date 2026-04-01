import { useMemo } from 'react';

interface VideoPlayerProps {
  url: string;
}

function getSourceInfo(url: string): { type: 'iframe' | 'video' | 'unsupported'; src: string } {
  try {
    const u = new URL(url.trim());
    const h = u.hostname.replace(/^www\./, '');
    const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/i);

    if (yt) return { type: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}` };
    if (/\.(mp4|webm|ogg|mov|m4v)(?:[?#].*)?$/i.test(url)) return { type: 'video', src: url };
    if (/supabase\.co\/storage\/v1\/object\/(public|sign)/i.test(url)) return { type: 'video', src: url };

    if (
      (h === 'xnxx.com' && /^\/embedframe\/[A-Za-z0-9]+/i.test(u.pathname)) ||
      (h === 'pornhub.com' && /^\/embed\/[A-Za-z0-9]+/i.test(u.pathname)) ||
      /\/(embed|player|iframe|embedframe)\//i.test(u.pathname)
    ) {
      return { type: 'iframe', src: url };
    }

    return { type: 'unsupported', src: url };
  } catch {
    return { type: 'unsupported', src: url };
  }
}

export default function VideoPlayer({ url }: VideoPlayerProps) {
  const source = useMemo(() => getSourceInfo(url), [url]);

  return (
    <div className="overflow-hidden rounded-lg border-2 border-border bg-card shadow-neon">
      <div className="aspect-video w-full bg-muted">
        {source.type === 'iframe' ? (
          <iframe
            src={source.src}
            title="Video preview"
            className="h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : source.type === 'video' ? (
          <video
            key={source.src}
            src={source.src}
            controls
            playsInline
            loop
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="space-y-2">
              <p className="text-xl font-black text-foreground">Video preview unavailable</p>
              <p className="text-sm text-muted-foreground">
                This URL format is not recognized as a playable embed or direct video file.
              </p>
            </div>
            <a
              href={source.src}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-primary px-4 py-2 text-sm font-black text-primary-foreground transition-opacity hover:opacity-90"
            >
              Open clip in new tab
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
