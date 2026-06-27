/** Anillo de progreso (SVG) que se llena con animación al montar o al cambiar. */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { BrandAccent } from '@/constants/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Props = {
  progress: number; // 0..1
  size?: number;
  stroke?: number;
  track: string;
  color?: string;
  center: string;
  sub?: string;
};

export function Ring({ progress, size = 96, stroke = 9, track, color = BrandAccent, center, sub }: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const target = Math.max(0, Math.min(1, progress));
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // strokeDashoffset no lo soporta el native driver → JS driver (suficiente).
    const a = Animated.timing(anim, { toValue: target, duration: 800, useNativeDriver: false });
    a.start();
    return () => a.stop();
  }, [anim, target]);

  const strokeDashoffset = anim.interpolate({ inputRange: [0, 1], outputRange: [c, 0] });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <ThemedText style={styles.centerValue}>{center}</ThemedText>
        {sub ? <ThemedText type="small" themeColor="textSecondary">{sub}</ThemedText> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  centerValue: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
});
