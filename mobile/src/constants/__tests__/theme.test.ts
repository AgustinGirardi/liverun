/** Contraste WCAG de la paleta en las dos apariencias, y escalado de line(). */
import { PixelRatio } from 'react-native';

import { Colors, line } from '../theme';

// theme.ts importa estilos web (CSS) que jest no sabe interpretar.
jest.mock('@/global.css', () => ({}), { virtual: true });

const canal = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function luminancia(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function contraste(a: string, b: string) {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

describe.each(['light', 'dark'] as const)('paleta %s', (modo) => {
  const c = Colors[modo];
  const fondos = [c.background, c.backgroundElement];

  it.each(['text', 'textSecondary', 'accent', 'danger', 'warning'] as const)(
    '%s llega a 4.5:1 sobre los fondos',
    (token) => {
      for (const fondo of fondos) {
        expect(contraste(c[token], fondo)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('onAccent llega a 4.5:1 sobre accentSurface', () => {
    expect(contraste(c.onAccent, c.accentSurface)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('line', () => {
  afterEach(() => jest.restoreAllMocks());

  it('escala el alto de línea con el tamaño de texto del sistema', () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
    expect(line(80)).toBe(160);
  });

  it('sin escala especial lo deja igual', () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
    expect(line(30)).toBe(30);
  });
});
