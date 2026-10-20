# LiveRun — app móvil

App de running de [LiveRun](../README.md): registra las salidas con GPS en
segundo plano, guarda el historial, lleva la racha semanal y muestra el ranking
entre amigos. Comparte la cuenta con el portal, así los resultados de las
carreras oficiales y los entrenamientos viven en el mismo perfil.

Expo (SDK 54) + React Native 0.81 + expo-router, en TypeScript.

```bash
npm install
npx expo start        # Expo Go, o un development build
npm test              # tests de tracking, progreso y snapshots de sesión
npm run lint
```

## Cómo está organizado

| Carpeta | Qué hay |
|---|---|
| `src/app/` | Pantallas y navegación por archivos (`expo-router`): inicio, correr, historial, ranking, perfil |
| `src/lib/` | La lógica sin UI y testeable: tracking GPS, sesión de carrera, progreso, cliente de la API, auth |
| `src/components/` | Componentes de UI (mapa de ruta, tarjetas, tabs, avatares) |
| `src/constants/theme.ts` | Tokens de marca — usar `BrandAccent` y `BrandGradient`, no hex sueltos |

El backend que consume es el portal (`cloud/`); la URL sale de
`src/lib/api.ts`.

## Publicar

`.github/workflows/eas-update.yml` publica un update OTA a EAS en cada push a
`main` que toque `mobile/`. Los cambios nativos necesitan rebuild.

### Que la OTA llegue al teléfono

Un update llega a un build solo si coinciden **el canal** y **el `runtimeVersion`**:

| Pieza | Valor | Dónde se define |
|---|---|---|
| Branch que publica el CI | `main` | `.github/workflows/eas-update.yml` |
| Canal del build `preview` | `preview` | `eas.json` (`build.preview.channel`) |
| Canal → branch | `preview` → `main` | EAS (no está en el repo): `npx eas-cli@latest channel:edit preview --branch main` |
| Política de runtime | `fingerprint` | `app.json` (`runtimeVersion.policy`) |

El fingerprint es un hash de lo nativo (dependencias nativas, plugins, `app.json`).
Cambia al tocar `package.json` con paquetes nativos o `app.json`; un cambio solo de
JS no lo cambia. Un build instalado con otro fingerprint ignora el update en silencio.

- **Primera vez, o después de cambiar algo nativo:** `npx eas-cli@latest build -p android --profile preview`
  e instalar el APK.
- **Comprobar que coinciden:** en expo.dev, el *runtime version* del build debe ser el mismo
  que el del último update del branch `main`. Si no, `npx eas-cli@latest fingerprint:compare`
  dice qué difiere.
- **Builds de tienda** (`production`): antes de publicar, `npx eas-cli@latest channel:edit production --branch main`.
- La app baja el update al abrirse y lo aplica en la apertura siguiente: abrila dos veces.
