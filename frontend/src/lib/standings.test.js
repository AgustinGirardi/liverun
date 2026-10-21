import { describe, expect, it } from "vitest"
import { clasificarPorDistancia } from "./standings.js"

const llegada = (bib, extra) => ({ capture_id: bib, bib_number: String(bib), capture_ns: bib * 1e9, net_time_ns: null, distance_km: null, ...extra })

describe("clasificarPorDistancia", () => {
  it("sin llegadas no hay grupos", () => {
    expect(clasificarPorDistancia([])).toEqual([])
  })

  it("agrupa por distancia ascendente y deja 'sin distancia' al final", () => {
    const grupos = clasificarPorDistancia([
      llegada(1, { distance_km: 21 }),
      llegada(2, { distance_km: null }),
      llegada(3, { distance_km: 5 }),
      llegada(4, { distance_km: 10 }),
    ])
    expect(grupos.map(g => g.distancia)).toEqual([5, 10, 21, null])
  })

  it("ordena cada grupo por tiempo neto, no por orden de llegada", () => {
    // El 7 cruzó antes que el 8, pero largó más tarde: su neto es peor.
    const [grupo] = clasificarPorDistancia([
      llegada(7, { distance_km: 10, net_time_ns: 3_000e9 }),
      llegada(8, { distance_km: 10, net_time_ns: 2_900e9 }),
    ])
    expect(grupo.filas.map(f => f.bib_number)).toEqual(["8", "7"])
  })

  it("sin largada ordena por hora de captura", () => {
    const [grupo] = clasificarPorDistancia([llegada(30), llegada(10), llegada(20)])
    expect(grupo.filas.map(f => f.bib_number)).toEqual(["10", "20", "30"])
  })

  it("un neto de cero cuenta como tiempo y no cae a la hora de captura", () => {
    const [grupo] = clasificarPorDistancia([llegada(5, { net_time_ns: 0 }), llegada(1, { net_time_ns: 10e9 })])
    expect(grupo.filas.map(f => f.bib_number)).toEqual(["5", "1"])
  })

  it("no modifica el arreglo de entrada", () => {
    const entrada = [llegada(2), llegada(1)]
    clasificarPorDistancia(entrada)
    expect(entrada.map(f => f.bib_number)).toEqual(["2", "1"])
  })
})
