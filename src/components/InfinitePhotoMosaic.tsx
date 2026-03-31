const photos = Array.from({ length: 37 }, (_, i) => {
  const n = i + 1;
  const ext = [2,10,20,25,29].includes(n) ? 'avif'
    : [3,9,11,14,19,24,30,31,33,36].includes(n) ? 'webp'
    : [5,6,8,21,23].includes(n) ? 'png'
    : n === 34 ? 'jpeg'
    : 'jpg';
  return `/model/paysage${n}.${ext}`;
});

const row1 = photos.slice(0, 10);
const row2 = photos.slice(10, 20);
const row3 = photos.slice(20, 30);
const row4 = photos.slice(30, 37);

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
            className="w-40 h-28 md:w-52 md:h-36 object-cover rounded-lg shrink-0"
            loading="lazy"
          />
        ))}
      </div>
    </div>
  );
}

export default function InfinitePhotoMosaic() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
      <div className="flex flex-col gap-2 justify-center h-full -rotate-6 scale-125">
        <ScrollRow images={row1} duration={40} />
        <ScrollRow images={row2} duration={35} reverse />
        <ScrollRow images={row3} duration={45} />
        <ScrollRow images={row4} duration={38} reverse />
      </div>
    </div>
  );
}
