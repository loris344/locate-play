import { useEffect, useRef, useState } from 'react';

interface GameMapProps {
  onGuess: (lat: number, lng: number) => void;
  guessMarker: [number, number] | null;
  answerMarker: [number, number] | null;
  disabled: boolean;
}

declare global {
  interface Window {
    google?: any;
  }
}

const DEFAULT_CENTER = { lat: 20, lng: 0 };
const DEFAULT_ZOOM = 2;
const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-script';
const GOOGLE_MAPS_API_KEY =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyCc89CKlNNcOhvrUIrCmAB4app2WoFM1Q8';

let googleMapsPromise: Promise<any> | null = null;

function loadGoogleMapsApi() {
  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;

    const handleLoad = () => {
      if (window.google?.maps) {
        resolve(window.google.maps);
        return;
      }

      googleMapsPromise = null;
      reject(new Error('Google Maps loaded without the maps namespace.'));
    };

    const handleError = () => {
      googleMapsPromise = null;
      reject(new Error('Failed to load the Google Maps script.'));
    };

    if (existingScript) {
      existingScript.addEventListener('load', handleLoad, { once: true });
      existingScript.addEventListener('error', handleError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

export default function GameMap({ onGuess, guessMarker, answerMarker, disabled }: GameMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const guessMarkerRef = useRef<any>(null);
  const answerMarkerRef = useRef<any>(null);
  const [mapsApi, setMapsApi] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initializeMap() {
      try {
        const maps = await loadGoogleMapsApi();

        if (cancelled || !mapElementRef.current) {
          return;
        }

        setMapsApi(maps);
        mapInstanceRef.current = new maps.Map(mapElementRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          clickableIcons: false,
          disableDefaultUI: true,
          fullscreenControl: true,
          gestureHandling: 'greedy',
          mapTypeControl: false,
          streetViewControl: false,
          zoomControl: true,
        });
      } catch (error) {
        console.error('[GameMap] Google Maps failed to initialize', error);

        if (!cancelled) {
          setLoadError('Google Maps could not load in this preview.');
        }
      }
    }

    initializeMap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapsApi) {
      return;
    }

    const listener = mapInstanceRef.current.addListener('click', (event: any) => {
      if (disabled || !event.latLng) {
        return;
      }

      onGuess(event.latLng.lat(), event.latLng.lng());
    });

    return () => {
      listener.remove();
    };
  }, [disabled, mapsApi, onGuess]);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapsApi) {
      return;
    }

    if (guessMarkerRef.current) {
      guessMarkerRef.current.setMap(null);
      guessMarkerRef.current = null;
    }

    if (answerMarkerRef.current) {
      answerMarkerRef.current.setMap(null);
      answerMarkerRef.current = null;
    }

    if (guessMarker) {
      guessMarkerRef.current = new mapsApi.Marker({
        map: mapInstanceRef.current,
        position: { lat: guessMarker[0], lng: guessMarker[1] },
        title: 'Your guess',
      });
    }

    if (answerMarker) {
      answerMarkerRef.current = new mapsApi.Marker({
        icon: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
        map: mapInstanceRef.current,
        position: { lat: answerMarker[0], lng: answerMarker[1] },
        title: 'Answer',
      });
    }

    if (guessMarker && answerMarker) {
      const bounds = new mapsApi.LatLngBounds();
      bounds.extend({ lat: guessMarker[0], lng: guessMarker[1] });
      bounds.extend({ lat: answerMarker[0], lng: answerMarker[1] });
      mapInstanceRef.current.fitBounds(bounds);
      return;
    }

    if (!guessMarker && !answerMarker) {
      mapInstanceRef.current.setCenter(DEFAULT_CENTER);
      mapInstanceRef.current.setZoom(DEFAULT_ZOOM);
    }
  }, [answerMarker, guessMarker, mapsApi]);

  if (loadError) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border-2 border-border bg-card px-6 py-8 text-center text-sm font-semibold text-muted-foreground">
        {loadError}
      </div>
    );
  }

  return (
    <div className="w-full h-full rounded-lg overflow-hidden border-2 border-border">
      <div ref={mapElementRef} className="h-full min-h-[300px] w-full" />
    </div>
  );
}
