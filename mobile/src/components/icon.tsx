/**
 * Iconos de control (SVG line, estilo Lucide) — el mismo trazo y peso que los de
 * la barra de navegación. Existen para reemplazar los glifos Unicode que hacían
 * de iconos (▶ ⏸ ⏹ ‹ › ✓ ✎ 🔍 ↗): esos se dibujan con la fuente del sistema, así
 * que cambian de forma entre iOS y Android, no comparten peso con los iconos
 * reales y los lectores de pantalla los leen en voz alta por su nombre Unicode.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import type { IconProps } from '@/components/tab-icon';

const frame = (size: number) =>
  ({ width: size, height: size, viewBox: '0 0 24 24' }) as const;

const line = (color: string, strokeWidth: number) => ({
  fill: 'none' as const,
  stroke: color,
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

/** Pausar la salida en curso. */
export function PauseIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Rect x="6" y="4" width="4" height="16" rx="1" fill={color} stroke="none" />
      <Rect x="14" y="4" width="4" height="16" rx="1" fill={color} stroke="none" />
    </Svg>
  );
}

/** Terminar la salida. */
export function StopIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Rect x="5" y="5" width="14" height="14" rx="2" fill={color} stroke="none" />
    </Svg>
  );
}

/** Mes anterior. */
export function ChevronLeftIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}

/** Mes siguiente · avanzar. */
export function ChevronRightIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Path d="M9 18l6-6-6-6" />
    </Svg>
  );
}

/** Desplegar. */
export function ChevronDownIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

/** Confirmación. */
export function CheckIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Path d="M20 6L9 17l-5-5" />
    </Svg>
  );
}

/** Editar. */
export function PencilIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <Path d="m15 5 4 4" />
    </Svg>
  );
}

/** Buscar. */
export function SearchIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Circle cx="11" cy="11" r="8" />
      <Path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

/** Compartir hacia afuera. */
export function ShareIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <Path d="M16 6l-4-4-4 4" />
      <Path d="M12 2v13" />
    </Svg>
  );
}

/** Elegir de la galería. */
export function ImageIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Rect x="3" y="3" width="18" height="18" rx="2" />
      <Circle cx="9" cy="9" r="2" />
      <Path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </Svg>
  );
}

/** Sacar una foto. */
export function CameraIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
      <Circle cx="12" cy="13" r="3" />
    </Svg>
  );
}

/** Eliminar. */
export function TrashIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Path d="M3 6h18" />
      <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <Path d="M10 11v6" />
      <Path d="M14 11v6" />
    </Svg>
  );
}
