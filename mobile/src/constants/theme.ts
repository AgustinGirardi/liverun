/**
 * Paleta de LiveRun en sus dos apariencias.
 *
 * La oscura es la dirección "Pista nocturna": superficies de marca, nunca negro
 * puro. La clara es su equivalente de día y comparte tokens con el portal web,
 * para que un organizador que salta del navegador a la app vea el mismo producto.
 *
 * El acento vive en tres tokens porque el mint de marca no rinde igual en ambas:
 *  - `accent`        color de primer plano con significado (texto, íconos, trazos,
 *                    rellenos que comunican un valor). En claro baja a teal
 *                    profundo para llegar a 5:1; en oscuro es el mint.
 *  - `accentSurface` relleno grande que lleva su propio texto encima (CTA, FAB).
 *                    Ahí lo que importa es el contraste del texto contra el
 *                    relleno, no del relleno contra el fondo, así que el mint queda.
 *  - `onAccent`      texto e íconos sobre `accentSurface`.
 */

import '@/global.css';

import { PixelRatio, Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#28323A',
    background: '#F5F7F8',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E9EDEF',
    textSecondary: '#5A666E',
    border: '#E7ECEE',
    accent: '#00795C',
    accentSurface: '#00BF85',
    onAccent: '#06281d',
    warning: '#8A5300',
    danger: '#C1121F',
  },
  dark: {
    // Dirección A "Pista nocturna" — superficies de marca (no negro puro).
    text: '#e8eaeb',
    background: '#0d0f10',
    backgroundElement: '#141618',
    backgroundSelected: '#1c1f21',
    textSecondary: '#8a9299',
    border: '#262b2e', // --line del brand-spec
    accent: '#00e5a0',
    accentSurface: '#00e5a0',
    onAccent: '#06281d',
    warning: '#f5a524',
    danger: '#ff6b6b',
  },
} as const;

/**
 * React Native escala `fontSize` con la preferencia de texto del sistema pero
 * deja `lineHeight` fijo: con el texto al 200% los números grandes se recortan
 * contra su caja de línea. `line()` escala el alto de línea con el mismo factor
 * y conserva la proporción que se diseñó.
 *
 * Se lee al crear la hoja de estilos, así que un cambio de tamaño de texto se
 * aplica al reiniciar la app — igual que el resto de valores de `StyleSheet`.
 */
export const line = (lineHeight: number) => Math.round(lineHeight * PixelRatio.getFontScale());

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Mint de marca en crudo. Reservado para superficies que son oscuras en las dos
 * apariencias — la tarjeta para compartir, el trazo sobre el mapa, el resplandor
 * del FAB. Para todo lo demás usá `useTheme().accent`, que sí se adapta.
 */
export const BrandAccent = '#00e5a0';
export const BrandGradient = ['#00bf85', '#00e5a0'] as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
