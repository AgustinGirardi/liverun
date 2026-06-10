// Permite que `tsc --noEmit` acepte los imports de CSS del template
// (Metro/Expo los resuelve en build; acá solo se declaran los tipos).
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

declare module '*.css';
