import { useMemo, useState } from 'react';

interface VideoPlayerProps {
  url: string;
}

const DIRECT_VIDEO_PATTERN = /\.(mp4|webm|ogg|mov|m4v)(?:[?#].*)?$/i;

function getSourceInfo(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const isDirectVideo = DIRECT_VIDEO_PATTERN.test(url);
    const isKnownEmbed =
      (host === 'xnxx.com' && parsed.pathname.includes('/embedframe/')) ||
      (host === 'pornhub.com' && parsed.pathname.includes('/embed/'));

    return { host, isDirectVideo, isKnownEmbed };
  } catch {
    return { host: 'unknown source', isDirectVideo: false, isKnownEmbed: false };
  }
}

export default function VideoPlayer({ url }: VideoPlayerProps) {
  const [videoFailed, setVideoFailed] = useState(false);
  const { host, isDirectVideo, isKnownEmbed } = useMemo(() => getSourceInfo(url), [url]);

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
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="space-y-2">
              <p className="text-xl font-black text-foreground">Video preview unavailable</p>
              <p className="text-sm text-muted-foreground">
                {isKnownEmbed
                  ? `This ${host} embed URL is being returned by Supabase, but many adult sites block reliable in-app playback.`
                  : 'This row does not contain a direct video file that the browser can play inline.'}
              </p>
            </div>

            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-primary px-4 py-2 text-sm font-black text-primary-foreground transition-opacity hover:opacity-90"
            >
              Open clip in new tab
            </a>

            <p className="max-w-md text-xs text-muted-foreground">
              For inline playback here, store a direct <span className="font-bold text-foreground">.mp4</span> or <span className="font-bold text-foreground">.webm</span> URL in <span className="font-bold text-foreground">video_url</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
