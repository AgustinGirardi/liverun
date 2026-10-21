import { useEffect, useState } from 'react';
import { Animated, type ViewProps } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

/**
 * Aparición suave (fade + leve subida) al montar. Usa el Animated nativo de RN
 * (sin worklets/Reanimated) para que sea robusto en Expo Go. Pasale un `delay`
 * creciente a varios hijos para un efecto escalonado.
 */
export function FadeIn({
  delay = 0,
  offset = 12,
  duration = 380,
  style,
  children,
  ...rest
}: ViewProps & { delay?: number; offset?: number; duration?: number }) {
  const [t] = useState(() => new Animated.Value(0));
  const reduced = useReducedMotion();

  useEffect(() => {
    // Con "reducir movimiento" se conserva el fundido pero se quita el viaje:
    // sin desplazamiento, sin escalonado y en un tercio del tiempo.
    const anim = Animated.timing(t, {
      toValue: 1,
      duration: reduced ? 120 : duration,
      delay: reduced ? 0 : delay,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [t, delay, duration, reduced]);

  return (
    <Animated.View
      {...rest}
      style={[
        style,
        {
          opacity: t,
          transform: [
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : offset, 0] }) },
          ],
        },
      ]}>
      {children}
    </Animated.View>
  );
}
