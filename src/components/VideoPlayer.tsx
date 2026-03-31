interface VideoPlayerProps {
  url: string;
}

export default function VideoPlayer({ url }: VideoPlayerProps) {
  return (
    <div className="w-full aspect-video rounded-lg overflow-hidden border-2 border-border bg-card">
      <video
        src={url}
        controls
        autoPlay
        muted
        className="w-full h-full object-cover"
      >
        Your browser does not support the video tag.
      </video>
    </div>
  );
}
