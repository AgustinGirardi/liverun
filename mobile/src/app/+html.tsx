/**
 * Cáscara HTML del target web.
 *
 * Existe para que la app se pueda "Agregar a la pantalla de inicio" y se abra
 * como una app: sin barra del navegador, con su ícono y su color de marca.
 * `viewport-fit=cover` deja usar el área bajo la muesca. No se bloquea el zoom
 * (`user-scalable=no`) a propósito: quien necesita agrandar la pantalla puede.
 */
import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />

        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0d0f10" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="LiveRun" />
        <link rel="apple-touch-icon" href="/icon-192.png" />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
