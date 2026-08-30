const photos = Array.from({ length: 25 }, (_, i) => `/mosaic/${i + 1}.webp`);

const row1 = photos.slice(0, 9);
const row2 = photos.slice(9, 17);
const row3 = photos.slice(17, 25);

function ScrollRow({ images, duration, reverse = false }: { images: string[]; duration: number; reverse?: boolean }) {
  const doubled = [...images, ...images];
  return (
    <div className="flex overflow-hidden">
      <div
        className={`flex gap-2 shrink-0 ${reverse ? 'animate-scroll-reverse' : 'animate-scroll'}`}
        style={{ animationDuration: `${duration}s` }}
      >
        {doubled.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            width={160}
            height={90}
            className="w-40 h-28 md:w-52 md:h-36 object-cover rounded-lg shrink-0"
            loading="lazy"
            decoding="async"
          />
        ))}
      </div>
    </div>
  );
}

export default function InfinitePhotoMosaic() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
      <div className="flex flex-col gap-2 justify-center h-full -rotate-6 scale-125">
        <ScrollRow images={row1} duration={40} />
        <ScrollRow images={row2} duration={35} reverse />
        <ScrollRow images={row3} duration={45} />
      </div>
    </div>
  );
}
