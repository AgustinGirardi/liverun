import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

// Iconos provisorios del template (home/explore); se reemplazan por los propios
// cuando se haga el pase de diseño.
const ICONS = {
  index: require('@/assets/images/tabIcons/home.png'),
  correr: require('@/assets/images/tabIcons/explore.png'),
  historial: require('@/assets/images/tabIcons/explore.png'),
  ranking: require('@/assets/images/tabIcons/explore.png'),
  perfil: require('@/assets/images/tabIcons/explore.png'),
} as const;

const TABS: { name: keyof typeof ICONS; label: string }[] = [
  { name: 'index', label: 'Inicio' },
  { name: 'correr', label: 'Correr' },
  { name: 'historial', label: 'Historial' },
  { name: 'ranking', label: 'Ranking' },
  { name: 'perfil', label: 'Perfil' },
];

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      {TABS.map(({ name, label }) => (
        <NativeTabs.Trigger key={name} name={name}>
          <NativeTabs.Trigger.Label>{label}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={ICONS[name]} renderingMode="template" />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
