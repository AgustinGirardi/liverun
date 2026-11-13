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

Comandos, en orden (desde `mobile/`):

```bash
# 1. Confirmar que el canal apunta a main
npx eas-cli@latest channel:view preview
# 2. Ver qué difiere entre un build y un update (ids en expo.dev o con build:list / update:list)
npx eas-cli@latest fingerprint:compare --build-id <ID-DEL-BUILD> --update-id <ID-DEL-GRUPO>
# 3. Solo si difiere algo nativo real (package.json, app.json, plugins): build nuevo e instalar el APK
npx eas-cli@latest build -p android --profile preview
# 4. Publicar un update (o GitHub → Actions → "EAS Update (OTA)" → Run workflow)
npx eas-cli@latest update --branch main --message "<mensaje>"
# 5. Verificar: el runtime del update de la plataforma del build debe ser el del build
npx eas-cli@latest update:list --branch main --limit 5
```

Después, abrir la app dos veces: baja el update al abrirse y lo aplica en la apertura siguiente.

> **El fingerprint no es igual en todos lados.** El mismo código puede dar otro hash según
> dónde se calcule (esta PC con Windows, la CI con Linux, el servidor de builds de EAS) o
> por qué fuentes incluya. La fuente de verdad es el `runtimeVersion` **del build instalado**
> contra el **del último update de esa plataforma** en el branch (`update:list` muestra una
> fila por plataforma). Antes de pedir un build, comprobá que la diferencia sea nativa: si
> `package.json`, el lock y `app.json` no cambiaron desde el commit del build, un build nuevo
> no arregla nada. `npx expo-updates fingerprint:generate --platform android` calcula el hash
> local para comparar.

- **Builds de tienda** (`production`): antes de publicar, `npx eas-cli@latest channel:edit production --branch main`.
- La app baja el update al abrirse y lo aplica en la apertura siguiente: abrila dos veces.
