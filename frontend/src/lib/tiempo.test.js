import { describe, expect, it } from "vitest"
import { formatCronometro, formatDate, formatNs, formatPace, formatTiempo, horaANs, horaDeCaptura } from "./tiempo.js"

// Instante local (la hora del día depende de la zona de la PC) en epoch ns.
const epochNs = (y, mo, d, h, mi, s, ms) => new Date(y, mo, d, h, mi, s, ms).getTime() * 1_000_000
const aFecha = (ns) => new Date(Math.round(ns / 1_000_000))

describe("formatNs", () => {
  it("sin valor muestra el placeholder, pero 0 es un tiempo válido", () => {
    expect(formatNs(null)).toBe("--:--:--.---")
    expect(formatNs(undefined)).toBe("--:--:--.---")
    expect(formatNs(0)).toBe("00:00:00.000")
  })

  it("formatea horas, minutos, segundos y milésimas", () => {
    expect(formatNs(3_661_005_000_000)).toBe("01:01:01.005")
  })

  it("acepta el valor como string (llega así del servidor)", () => {
    expect(formatNs("1000000000")).toBe("00:00:01.000")
  })

  it("no se corta a las 24 horas", () => {
    expect(formatNs(90_000 * 1e9)).toBe("25:00:00.000")
  })
})

describe("formatCronometro", () => {
  it("cero y negativos (reloj atrasado respecto de la largada) muestran cero", () => {
    expect(formatCronometro(0)).toBe("00:00:00.00")
    expect(formatCronometro(-500)).toBe("00:00:00.00")
  })

  it("muestra centésimas truncadas, no redondeadas", () => {
    expect(formatCronometro(3_723_450)).toBe("01:02:03.45")
    expect(formatCronometro(3_723_459)).toBe("01:02:03.45")
  })

  it("pasa los 99 minutos y las 100 horas sin romper el formato", () => {
    expect(formatCronometro(99 * 60_000 + 59_990)).toBe("01:39:59.99")
    expect(formatCronometro(100 * 3_600_000)).toBe("100:00:00.00")
  })
})

describe("horaDeCaptura y formatTiempo", () => {
  it("sin captura muestra una raya", () => {
    expect(horaDeCaptura(null)).toBe("—")
    expect(horaDeCaptura(0)).toBe("—")
  })

  it("muestra la hora del día con centésimas, no una duración absurda", () => {
    expect(horaDeCaptura(epochNs(2026, 9, 18, 13, 45, 7, 235))).toBe("13:45:07.23")
  })

  it("con largada usa el tiempo neto; sin largada, la hora de llegada", () => {
    const captura = epochNs(2026, 9, 18, 9, 5, 0, 505)
    expect(formatTiempo(61_000_000_000, captura)).toBe("00:01:01.000")
    expect(formatTiempo(0, captura)).toBe("00:00:00.000")
    expect(formatTiempo(null, captura)).toBe("09:05:00.50")
    expect(formatTiempo(null, null)).toBe("—")
  })
})

describe("horaANs", () => {
  const base = epochNs(2026, 5, 15, 8, 0, 0, 0)

  it("arma el instante en el mismo día que la base", () => {
    const f = aFecha(horaANs("12:30:15", base))
    expect([f.getFullYear(), f.getMonth(), f.getDate()]).toEqual([2026, 5, 15])
    expect([f.getHours(), f.getMinutes(), f.getSeconds(), f.getMilliseconds()]).toEqual([12, 30, 15, 0])
  })

  it("acepta hh:mm, una sola cifra de hora y espacios alrededor", () => {
    const f = aFecha(horaANs("  9:05  ", base))
    expect([f.getHours(), f.getMinutes(), f.getSeconds()]).toEqual([9, 5, 0])
  })

  it("interpreta la fracción con punto o coma como decimales de segundo", () => {
    expect(aFecha(horaANs("12:30:15.5", base)).getMilliseconds()).toBe(500)
    expect(aFecha(horaANs("12:30:15,25", base)).getMilliseconds()).toBe(250)
    expect(aFecha(horaANs("12:30:15.123", base)).getMilliseconds()).toBe(123)
  })

  it("rechaza texto inválido y horas fuera de rango", () => {
    for (const malo of ["", null, undefined, "abc", "25:00", "12:60", "12:30:60", "12:30:15.1234", "1230"]) {
      expect(horaANs(malo, base)).toBeNull()
    }
  })
})

describe("formatPace", () => {
  it("devuelve vacío si falta el tiempo neto o la distancia", () => {
    expect(formatPace(null, 10)).toBe("")
    expect(formatPace(0, 10)).toBe("")
    expect(formatPace(1e12, null)).toBe("")
  })

  it("calcula min/km redondeando los segundos", () => {
    expect(formatPace(1_500e9, 5)).toBe("5:00 /km")
    expect(formatPace(2_922e9, 10)).toBe("4:52 /km")
  })
})

describe("formatDate", () => {
  it("formatea sin correr el día por la zona horaria", () => {
    expect(formatDate("2026-09-13")).toBe("13 sep 2026")
    expect(formatDate("2026-01-01T00:00:00")).toBe("1 ene 2026")
  })

  it("devuelve el texto tal cual si no es una fecha válida", () => {
    expect(formatDate("2026-13-01")).toBe("2026-13-01")
    expect(formatDate("mañana")).toBe("mañana")
    expect(formatDate(null)).toBe("")
  })
})
