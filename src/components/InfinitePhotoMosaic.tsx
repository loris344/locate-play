import paris from '@/assets/mosaic/paris.jpg';
import tokyo from '@/assets/mosaic/tokyo.jpg';
import newyork from '@/assets/mosaic/newyork.jpg';
import beach from '@/assets/mosaic/beach.jpg';
import machupicchu from '@/assets/mosaic/machupicchu.jpg';
import dubai from '@/assets/mosaic/dubai.jpg';
import rio from '@/assets/mosaic/rio.jpg';
import iceland from '@/assets/mosaic/iceland.jpg';

const row1 = [paris, tokyo, newyork, beach, machupicchu, dubai, rio, iceland];
const row2 = [dubai, beach, iceland, paris, rio, newyork, machupicchu, tokyo];
const row3 = [machupicchu, rio, dubai, tokyo, paris, iceland, beach, newyork];

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
      </div>
    </div>
  );
}
