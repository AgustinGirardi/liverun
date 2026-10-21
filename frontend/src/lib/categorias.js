export function calcAge(birthDate) {
  if (!birthDate) return null
  const today = new Date()
  const birth = new Date(birthDate + "T12:00:00")
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

export function autoCategory(birthDate, gender) {
  if (!birthDate || !gender || gender === "X") return ""
  const age = calcAge(birthDate)
  if (age === null) return ""
  const p = gender === "F" ? "F" : "M"
  if (age < 18)  return `${p}-Sub18`
  if (age <= 24) return `${p}18-24`
  if (age <= 29) return `${p}25-29`
  if (age <= 34) return `${p}30-34`
  if (age <= 39) return `${p}35-39`
  if (age <= 44) return `${p}40-44`
  if (age <= 49) return `${p}45-49`
  if (age <= 54) return `${p}50-54`
  if (age <= 59) return `${p}55-59`
  return `${p}60+`
}
