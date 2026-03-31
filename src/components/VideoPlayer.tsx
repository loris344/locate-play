import { useMemo, useState } from 'react';

interface VideoPlayerProps {
  url: string;
}

const DIRECT_VIDEO_PATTERN = /\.(mp4|webm|ogg|mov|m4v)(?:[?#].*)?$/i;

function getEmbedUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');

    if (host === 'xnxx.com' && parsed.pathname.includes('/embedframe/')) {
      return parsed.toString();
    }

    if (host === 'pornhub.com' && parsed.pathname.includes('/embed/')) {
      return parsed.toString();
    }

    return null;
  } catch {
    return null;
  }
}

export default function VideoPlayer({ url }: VideoPlayerProps) {
  const [videoFailed, setVideoFailed] = useState(false);
  const isDirectVideo = useMemo(() => DIRECT_VIDEO_PATTERN.test(url), [url]);
  const embedUrl = useMemo(() => getEmbedUrl(url), [url]);

  return (
    <div className="overflow-hidden rounded-lg border-2 border-border bg-card shadow-neon">
      <div className="aspect-video w-full bg-muted">
        {isDirectVideo && !videoFailed ? (
          <video
            src={url}
            controls
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
            onError={() => setVideoFailed(true)}
          >
            Your browser does not support the video tag.
          </video>
        ) : embedUrl ? (
          <iframe
            src={embedUrl}
            title="Game video"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            className="h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-lg font-black text-foreground">Unsupported video source</p>
            <p className="max-w-md text-sm text-muted-foreground">
              This row contains a page URL instead of a direct video file or supported embed URL.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-primary underline underline-offset-4"
            >
              Open source in a new tab
            </a>
          </div>
        )}
      </div>

      {!isDirectVideo && embedUrl && (
        <div className="border-t border-border bg-card px-4 py-3 text-center text-sm text-muted-foreground">
          Embedded source loaded from the URL stored in Supabase.
        </div>
      )}
    </div>
  );
}
