/**
 * Preferencia de "reducir movimiento" del sistema (Ajustes › Accesibilidad).
 *
 * Quien la activa lo hace por vértigo, migraña o mareo por movimiento: las
 * apariciones con desplazamiento y los barridos largos le dan síntomas. No
 * significa quitar el cambio de estado, sino llegar al mismo sitio sin viaje —
 * un corte o un fundido en lugar de un recorrido.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
