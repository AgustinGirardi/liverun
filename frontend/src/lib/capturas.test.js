import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// El estado de la cola vive a nivel módulo: cada test arranca con una copia limpia.
async function cargar() {
  vi.resetModules()
  return await import("./capturas.js")
}

const respuesta = (status, cuerpo = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo })
const sinRed = () => Promise.reject(new TypeError("Failed to fetch"))
const cuerpoDe = (llamada) => JSON.parse(llamada[1].body)

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe("encolarCaptura", () => {
  it("manda la captura a la carrera con la demora desde el cruce", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(200, { id: 1 }))
    vi.stubGlobal("fetch", fetchMock)
    const { encolarCaptura, contarSinGuardar } = await cargar()

    encolarCaptura(7)
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/races/7/capture")
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    expect(cuerpoDe(fetchMock.mock.calls[0])).toEqual({ delay_ms: 0 })
    expect(contarSinGuardar(7)).toBe(0)
  })

  it("sin conexión queda en la cola y se reintenta a los 2 s con la demora real", async () => {
    const fetchMock = vi.fn().mockImplementationOnce(sinRed).mockResolvedValue(respuesta(200, { id: 1 }))
    vi.stubGlobal("fetch", fetchMock)
    const { encolarCaptura, contarSinGuardar } = await cargar()

    encolarCaptura(7)
    await vi.advanceTimersByTimeAsync(0)
    expect(contarSinGuardar(7)).toBe(1)

    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // El tiempo no cambia por haber reintentado: el servidor descuenta los 2 s.
    expect(cuerpoDe(fetchMock.mock.calls[1]).delay_ms).toBe(2000)
    expect(contarSinGuardar(7)).toBe(0)
  })

  it("un error 5xx no la descarta: sigue en la cola y se avisa solo cuando se guarda", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuesta(503)).mockResolvedValue(respuesta(200, { id: 9 }))
    vi.stubGlobal("fetch", fetchMock)
    const { encolarCaptura, contarSinGuardar, oyentesCapturas } = await cargar()
    const oyente = vi.fn()
    oyentesCapturas.add(oyente)

    encolarCaptura(7)
    await vi.advanceTimersByTimeAsync(0)
    expect(contarSinGuardar(7)).toBe(1)
    expect(oyente).not.toHaveBeenCalledWith(7, expect.anything())

    await vi.advanceTimersByTimeAsync(2000)
    expect(oyente).toHaveBeenCalledWith(7, { captura: { id: 9 } })
    expect(contarSinGuardar(7)).toBe(0)
  })

  it("un 4xx la saca de la cola y avisa el motivo: reintentar no sirve", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(409, { detail: "La carrera ya finalizó" })))
    const { encolarCaptura, contarSinGuardar, oyentesCapturas } = await cargar()
    const oyente = vi.fn()
    oyentesCapturas.add(oyente)

    encolarCaptura(7)
    await vi.advanceTimersByTimeAsync(0)

    expect(oyente).toHaveBeenCalledWith(7, { rechazo: "La carrera ya finalizó" })
    expect(contarSinGuardar(7)).toBe(0)
  })

  it("un 4xx sin detalle usa el código de estado como motivo", async () => {
    const sinCuerpo = { ok: false, status: 400, json: () => Promise.reject(new Error("no es JSON")) }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sinCuerpo))
    const { encolarCaptura, oyentesCapturas } = await cargar()
    const oyente = vi.fn()
    oyentesCapturas.add(oyente)

    encolarCaptura(7)
    await vi.advanceTimersByTimeAsync(0)

    expect(oyente).toHaveBeenCalledWith(7, { rechazo: "Error 400" })
  })

  it("guarda en el orden en que se cruzó la meta y cuenta por carrera", async () => {
    const fetchMock = vi.fn().mockImplementationOnce(sinRed).mockResolvedValue(respuesta(200, {}))
    vi.stubGlobal("fetch", fetchMock)
    const { encolarCaptura, contarSinGuardar } = await cargar()

    encolarCaptura(1)
    encolarCaptura(2)
    encolarCaptura(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(contarSinGuardar(1)).toBe(2)
    expect(contarSinGuardar(2)).toBe(1)

    await vi.advanceTimersByTimeAsync(2000)
    const urls = fetchMock.mock.calls.map(c => c[0])
    expect(urls.slice(1)).toEqual(["/api/v1/races/1/capture", "/api/v1/races/2/capture", "/api/v1/races/1/capture"])
    expect(contarSinGuardar(1) + contarSinGuardar(2)).toBe(0)
  })

  it("apaga el reintento cuando la cola se vacía", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(200, {})))
    const { encolarCaptura } = await cargar()

    encolarCaptura(7)
    await vi.advanceTimersByTimeAsync(0)

    expect(vi.getTimerCount()).toBe(0)
  })

  it("avisa a las pantallas cada vez que termina una pasada, aunque no haya guardado nada", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(sinRed))
    const { encolarCaptura, oyentesCapturas } = await cargar()
    const oyente = vi.fn()
    oyentesCapturas.add(oyente)

    encolarCaptura(7)
    await vi.advanceTimersByTimeAsync(0)

    expect(oyente).toHaveBeenCalledWith(null, {})
  })
})

describe("porSecuencia", () => {
  it("ordena por hora de captura y desempata por orden de secuencia", async () => {
    const { porSecuencia } = await cargar()
    const caps = [
      { id: "c", captured_ns: 300, sequence_order: 1 },
      { id: "b2", captured_ns: 200, sequence_order: 9 },
      { id: "b1", captured_ns: 200, sequence_order: 2 },
      { id: "a", captured_ns: 100, sequence_order: 5 },
    ]
    expect(caps.sort(porSecuencia).map(c => c.id)).toEqual(["a", "b1", "b2", "c"])
  })

  it("una captura reintentada (secuencia posterior) conserva su lugar por la hora real", async () => {
    const { porSecuencia } = await cargar()
    const reintentada = { id: "r", captured_ns: 100, sequence_order: 8 }
    const posterior = { id: "p", captured_ns: 200, sequence_order: 3 }
    expect([posterior, reintentada].sort(porSecuencia).map(c => c.id)).toEqual(["r", "p"])
  })
})

describe("al cerrar la ventana", () => {
  async function conVentana() {
    const oyentes = {}
    vi.stubGlobal("window", { addEventListener: (tipo, fn) => { oyentes[tipo] = fn } })
    const modulo = await cargar()
    return { ...modulo, alCerrar: oyentes.beforeunload }
  }

  it("frena el cierre si hay capturas sin guardar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(sinRed))
    const { encolarCaptura, alCerrar } = await conVentana()
    encolarCaptura(7)
    await vi.advanceTimersByTimeAsync(0)

    const evento = { preventDefault: vi.fn(), returnValue: undefined }
    alCerrar(evento)

    expect(evento.preventDefault).toHaveBeenCalled()
    expect(evento.returnValue).toBe("")
  })

  it("deja cerrar si no hay nada pendiente", async () => {
    const { alCerrar } = await conVentana()
    const evento = { preventDefault: vi.fn() }
    alCerrar(evento)
    expect(evento.preventDefault).not.toHaveBeenCalled()
  })
})
