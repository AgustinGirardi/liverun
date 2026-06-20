/** Anillo de progreso (SVG). Usado para la meta semanal en el dashboard. */
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { BrandAccent } from '@/constants/theme';

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
  const dash = Math.max(0, Math.min(1, progress)) * c;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${c}`}
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
