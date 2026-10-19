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
import { BrandAccent, BrandGradient, line, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type IconComponent = (props: IconProps) => React.JSX.Element;

/** Alto mínimo de un destino normal: el objetivo táctil de 44pt del HIG. */
const NAV_HEIGHT = 44;
/** Tamaño del botón central y cuánto sobresale de la fila de destinos. */
const FAB_SIZE = 62;
const FAB_LIFT = 21;

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
      // `box-none`: el contenedor se extiende por encima de la barra visible,
      // pero no debe interceptar los toques de la pantalla en esa franja.
      pointerEvents="box-none"
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, Spacing.two) },
        style,
      ]}>
      {/* La superficie visible es un hijo absoluto, no el contenedor: así el
          contenedor puede extenderse por encima para alojar el FAB entero.
          Android no entrega toques a lo que sobresale de los límites del padre,
          y antes un tercio del botón principal quedaba muerto. */}
      <View
        pointerEvents="none"
        style={[
          styles.barSurface,
          { backgroundColor: theme.backgroundElement, borderTopColor: theme.border },
        ]}
      />
      <View style={styles.row}>{children}</View>
    </View>
  );
}

type NavButtonProps = TabTriggerSlotProps & { label: string; Icon: IconComponent };

/** Destino normal: ícono + etiqueta; mint cuando está activo. */
function NavButton({ label, Icon, isFocused, ...props }: NavButtonProps) {
  const theme = useTheme();
  const color = isFocused ? theme.accent : theme.textSecondary;
  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!isFocused }}
      style={styles.navBtn}>
      <Icon size={24} color={color} />
      <ThemedText type="small" style={[styles.label, { color }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Acción principal: botón circular elevado con gradiente de marca. Variante
 *  "minimal": sin etiqueta y con un anillo del color del fondo que lo despega
 *  de la barra. */
function RunButton({ isFocused, ...props }: TabTriggerSlotProps) {
  const theme = useTheme();
  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityLabel="Correr"
      accessibilityHint="Abre el cronómetro para iniciar una salida"
      accessibilityState={{ selected: !!isFocused }}
      style={styles.runBtn}>
      <LinearGradient
        colors={[...BrandGradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.fab, { borderColor: theme.background }, isFocused && styles.fabActive]}>
        <PlayIcon size={30} color={theme.onAccent} />
      </LinearGradient>
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
    alignItems: 'center',
  },
  // En pantallas anchas los destinos se limitan al mismo ancho que el contenido:
  // estirados sobre un iPad el FAB queda perdido en el medio de la barra.
  row: {
    width: '100%',
    maxWidth: MaxContentWidth,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingTop: FAB_LIFT + Spacing.two, // sitio para la parte elevada del FAB
    paddingHorizontal: Spacing.two,
  },
  barSurface: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: FAB_LIFT, // el borde visible arranca donde arrancaba la barra antes
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navBtn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 3, minHeight: NAV_HEIGHT },
  runBtn: { flex: 1, alignItems: 'center', marginTop: -FAB_LIFT },
  label: { fontSize: 11, lineHeight: line(14) },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3, // centrado óptico del triángulo de play
    borderWidth: 3, // anillo (borderColor = fondo, inline) que lo despega de la barra
    shadowColor: BrandAccent,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabActive: { transform: [{ scale: 1.04 }] },
});
