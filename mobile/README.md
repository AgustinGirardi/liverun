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
