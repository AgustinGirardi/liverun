import { useEffect, useRef } from 'react';
import { Animated, type ViewProps } from 'react-native';

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
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(t, { toValue: 1, duration, delay, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [t, delay, duration]);

  return (
    <Animated.View
      {...rest}
      style={[
        style,
        {
          opacity: t,
          transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) }],
        },
      ]}>
      {children}
    </Animated.View>
  );
}
