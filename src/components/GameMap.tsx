import { useCallback, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

// Fix default marker icon
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface GameMapProps {
  onGuess: (lat: number, lng: number) => void;
  guessMarker: [number, number] | null;
  answerMarker: [number, number] | null;
  disabled: boolean;
}

function ClickHandler({ onClick, disabled }: { onClick: (lat: number, lng: number) => void; disabled: boolean }) {
  useMapEvents({
    click(e) {
      if (!disabled) {
        onClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

const answerIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export default function GameMap({ onGuess, guessMarker, answerMarker, disabled }: GameMapProps) {
  return (
    <div className="w-full h-full rounded-lg overflow-hidden border-2 border-border">
      <MapContainer
        center={[20, 0]}
        zoom={2}
        className="w-full h-full"
        style={{ minHeight: '300px' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <ClickHandler onClick={onGuess} disabled={disabled} />
        {guessMarker && <Marker position={guessMarker} />}
        {answerMarker && <Marker position={answerMarker} icon={answerIcon} />}
      </MapContainer>
    </div>
  );
}
