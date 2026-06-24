/**
 * Barra de navegación de la app (native). Distribución "Correr al centro":
 * cuatro destinos (Hoy · Salidas · Ranking · Perfil) alrededor de un botón
 * central elevado para la acción principal — salir a correr.
 *
 * No se puede con `NativeTabs` (la barra nativa del sistema no admite un botón
 * elevado propio), así que usa la tab bar custom de `expo-router/ui`. La barra
 * va absoluta al fondo, ocupando el alto que las pantallas ya reservan con
 * `BottomTabInset`; por eso el rediseño no toca ninguna de las 5 pantallas.
 */
import { LinearGradient } from 'expo-linear-gradient';
import {
  TabList,
  TabSlot,
  TabTrigger,
  Tabs,
  type TabTriggerSlotProps,
} from 'expo-router/ui';
import { Pressable, StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  HomeIcon,
  ListIcon,
  PlayIcon,
  TrophyIcon,
  UserIcon,
  type IconProps,
} from '@/components/tab-icon';
import { ThemedText } from '@/components/themed-text';
import { BrandAccent, BrandGradient, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type IconComponent = (props: IconProps) => React.JSX.Element;

const ON_ACCENT = '#06281d'; // verde de marca para íconos/texto sobre el mint

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <BottomBar>
          <TabTrigger name="index" href="/" asChild>
            <NavButton label="Hoy" Icon={HomeIcon} />
          </TabTrigger>
          <TabTrigger name="historial" href="/historial" asChild>
            <NavButton label="Salidas" Icon={ListIcon} />
          </TabTrigger>
          <TabTrigger name="correr" href="/correr" asChild>
            <RunButton />
          </TabTrigger>
          <TabTrigger name="ranking" href="/ranking" asChild>
            <NavButton label="Ranking" Icon={TrophyIcon} />
          </TabTrigger>
          <TabTrigger name="perfil" href="/perfil" asChild>
            <NavButton label="Perfil" Icon={UserIcon} />
          </TabTrigger>
        </BottomBar>
      </TabList>
    </Tabs>
  );
}

/** Contenedor de la barra: TabList le pasa sus props vía `asChild`. */
function BottomBar({ children, style, ...props }: ViewProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      {...props}
      style={[
        styles.bar,
        {
          backgroundColor: theme.backgroundElement,
          borderTopColor: theme.border,
          paddingBottom: Math.max(insets.bottom, Spacing.two),
        },
        style,
      ]}>
      {children}
    </View>
  );
}

type NavButtonProps = TabTriggerSlotProps & { label: string; Icon: IconComponent };

/** Destino normal: ícono + etiqueta; mint cuando está activo. */
function NavButton({ label, Icon, isFocused, ...props }: NavButtonProps) {
  const theme = useTheme();
  const color = isFocused ? BrandAccent : theme.textSecondary;
  return (
    <Pressable {...props} style={styles.navBtn}>
      <Icon size={24} color={color} />
      <ThemedText type="small" style={[styles.label, { color }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Acción principal: botón circular elevado con gradiente de marca. */
function RunButton({ isFocused, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable {...props} style={styles.runBtn}>
      <LinearGradient
        colors={[...BrandGradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.fab, isFocused && styles.fabActive]}>
        <PlayIcon size={28} color={ON_ACCENT} />
      </LinearGradient>
      <ThemedText type="small" style={[styles.label, styles.runLabel]}>
        Correr
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1 },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navBtn: { flex: 1, alignItems: 'center', gap: 3 },
  runBtn: { flex: 1, alignItems: 'center', gap: 3 },
  label: { fontSize: 11, lineHeight: 14 },
  runLabel: { color: BrandAccent, fontWeight: '800' },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -26, // sobresale por encima de la barra
    paddingLeft: 3, // centrado óptico del triángulo de play
    shadowColor: BrandAccent,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabActive: { transform: [{ scale: 1.04 }] },
});
