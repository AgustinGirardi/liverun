// Agrupa a los que llegaron por distancia (ascendente; los que no tienen
// distancia van al final) y ordena cada grupo por tiempo neto o, sin largada,
// por hora de captura. Devuelve [{ distancia, filas }].
export function clasificarPorDistancia(finishers) {
  const timeOf = f => f.net_time_ns ?? f.capture_ns
  const porDistancia = new Map()
  finishers.forEach(f => {
    const k = f.distance_km ?? null
    if (!porDistancia.has(k)) porDistancia.set(k, [])
    porDistancia.get(k).push(f)
  })
  const claves = [...porDistancia.keys()].sort((a, b) => (a === null) - (b === null) || a - b)
  return claves.map(distancia => ({
    distancia,
    filas: porDistancia.get(distancia).slice().sort((a, b) => timeOf(a) - timeOf(b)),
  }))
}
