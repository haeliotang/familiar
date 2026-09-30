export function memoryCharacterCount(text: string) {
  return Array.from(text).length
}

export function limitMemoryText(text: string) {
  return Array.from(text).slice(0, 500).join('')
}
