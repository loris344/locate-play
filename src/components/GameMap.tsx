"use client";

import { useEffect, useRef, useState } from 'react';
import type { LngLatLike, Map as MapLibreMap, MapMouseEvent, Marker as MapLibreMarker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

type MapLibre = typeof import('maplibre-gl');

interface GameMapProps {
  onGuess: (lat: number, lng: number) => void;
  guessMarker: [number, number] | null;
  answerMarker: [number, number] | null;
  disabled: boolean;
}

// MapLibre works in [lng, lat] order, and its zoom levels sit one step above Google's.
const DEFAULT_CENTER: [number, number] = [0, 20];
const DEFAULT_ZOOM = 1;

// OpenFreeMap serves OpenStreetMap data for free: no API key, no account, no usage cap.
// The style carries the OpenStreetMap credit the licence requires. Swap `liberty` for `positron`
// (minimal grey), `bright` or `dark` to change the look of the board.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

const GUESS_COLOR = 'hsl(338, 90%, 56%)';
const ANSWER_COLOR = 'hsl(168, 80%, 45%)';

function toLngLat([lat, lng]: [number, number]): LngLatLike {
  return [lng, lat];
}

export default function GameMap({ onGuess, guessMarker, answerMarker, disabled }: GameMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<MapLibreMap | null>(null);
  const guessMarkerRef = useRef<MapLibreMarker | null>(null);
  const answerMarkerRef = useRef<MapLibreMarker | null>(null);
  const [maplibre, setMaplibre] = useState<MapLibre | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initializeMap() {
      try {
        // Imported on demand so the map engine only ships to players who reach a round.
        const maplibreModule = await import('maplibre-gl');

        // The tile worker is served from our own origin by scripts/copy-maplibre-worker.mjs;
        // the bundler cannot resolve the path MapLibre builds for it at runtime.
        maplibreModule.setWorkerUrl(`/maplibre/${maplibreModule.getVersion()}/maplibre-gl-worker.js`);

        if (cancelled || !mapElementRef.current) {
          return;
        }

        const map = new maplibreModule.Map({
          container: mapElementRef.current,
          style: STYLE_URL,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          maxZoom: 16,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });

        map.touchZoomRotate.disableRotation();
        map.addControl(new maplibreModule.NavigationControl({ showCompass: false }), 'top-left');
        map.addControl(new maplibreModule.FullscreenControl(), 'top-right');

        mapInstanceRef.current = map;
        setMaplibre(maplibreModule);
      } catch (error) {
        console.error('[GameMap] MapLibre failed to initialize', error);

        if (!cancelled) {
          setLoadError('The map could not load in this preview.');
        }
      }
    }

    initializeMap();

    return () => {
      cancelled = true;
      guessMarkerRef.current = null;
      answerMarkerRef.current = null;
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;

    if (!map || !maplibre) {
      return;
    }

    const handleClick = (event: MapMouseEvent) => {
      if (disabled) {
        return;
      }

      onGuess(event.lngLat.lat, event.lngLat.lng);
    };

    map.on('click', handleClick);

    return () => {
      map.off('click', handleClick);
    };
  }, [disabled, maplibre, onGuess]);

  useEffect(() => {
    const map = mapInstanceRef.current;

    if (!map || !maplibre) {
      return;
    }

    guessMarkerRef.current?.remove();
    guessMarkerRef.current = null;
    answerMarkerRef.current?.remove();
    answerMarkerRef.current = null;

    if (guessMarker) {
      const marker = new maplibre.Marker({ color: GUESS_COLOR }).setLngLat(toLngLat(guessMarker)).addTo(map);
      marker.getElement().title = 'Your guess';
      guessMarkerRef.current = marker;
    }

    if (answerMarker) {
      const marker = new maplibre.Marker({ color: ANSWER_COLOR }).setLngLat(toLngLat(answerMarker)).addTo(map);
      marker.getElement().title = 'Answer';
      answerMarkerRef.current = marker;
    }

    if (guessMarker && answerMarker) {
      const bounds = new maplibre.LngLatBounds(toLngLat(guessMarker), toLngLat(guessMarker));
      bounds.extend(toLngLat(answerMarker));
      map.fitBounds(bounds, { padding: 32, maxZoom: 6 });
      return;
    }

    if (!guessMarker && !answerMarker) {
      map.jumpTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
    }
  }, [answerMarker, guessMarker, maplibre]);

  if (loadError) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border-2 border-border bg-card px-6 py-8 text-center text-sm font-semibold text-muted-foreground">
        {loadError}
      </div>
    );
  }

  return (
    // The panel is height-constrained on phones and auto-height from `lg` up. The map is stretched
    // to whatever the panel is rather than given a height of its own, so it never overflows its
    // frame. MapLibre forces `position: relative` on its own container, hence the sizing layer.
    <div className="relative h-full w-full min-h-[180px] overflow-hidden rounded-lg border-2 border-border lg:min-h-[300px]">
      <div className="absolute inset-0">
        <div ref={mapElementRef} className="h-full w-full" />
      </div>
    </div>
  );
}
