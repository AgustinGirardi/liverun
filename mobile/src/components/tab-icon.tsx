/**
 * Iconos de la barra de navegación (SVG line, estilo Lucide). Un trazo propio por
 * pestaña para que cada destino se distinga de un vistazo — antes 4 de 5 pestañas
 * compartían el mismo icono del template. Reusa react-native-svg (como el Ring),
 * sin sumar dependencias, y toma el color del estado activo/inactivo.
 */
import Svg, { Circle, Path } from 'react-native-svg';

export type IconProps = { size?: number; color: string; strokeWidth?: number };

const frame = (size: number) =>
  ({ width: size, height: size, viewBox: '0 0 24 24' }) as const;

const line = (color: string, strokeWidth: number) =>
  ({
    fill: 'none' as const,
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  });

/** Hoy — resumen del día (casa). */
export function HomeIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <Path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  );
}

/** Salidas — historial de carreras (lista). */
export function ListIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Path d="M8 6h13" />
      <Path d="M8 12h13" />
      <Path d="M8 18h13" />
      <Path d="M3 6h.01" />
      <Path d="M3 12h.01" />
      <Path d="M3 18h.01" />
    </Svg>
  );
}

/** Ranking — entre amigos (trofeo). */
export function TrophyIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <Path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <Path d="M4 22h16" />
      <Path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <Path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <Path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </Svg>
  );
}

/** Perfil — la persona (avatar). */
export function UserIcon({ size = 24, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...frame(size)} {...line(color, strokeWidth)}>
      <Path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <Circle cx={12} cy={7} r={4} />
    </Svg>
  );
}

/** Correr — la acción principal (play). Relleno, va dentro del botón central. */
export function PlayIcon({ size = 24, color }: IconProps) {
  return (
    <Svg {...frame(size)} fill={color}>
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}
