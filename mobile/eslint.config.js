// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Reglas del React Compiler en "warn": flaggean el patrón estándar de
    // Animated de RN (useRef(new Animated.Value()).current en render), usado
    // en fade-in/ring/podio y hasta en el propio template de Expo. Migrar esas
    // animaciones es trabajo aparte; mientras tanto que no tapen errores reales.
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);
