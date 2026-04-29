/** Instrukcja dla Ollama: modele w niestandardowym katalogu (zmienna OLLAMA_MODELS). */

export function buildPowerShellSetUserEnv(path: string): string {
  const escaped = path.replace(/'/g, "''");
  return `[Environment]::SetEnvironmentVariable('OLLAMA_MODELS', '${escaped}', 'User')`;
}

export function buildCmdSetUserEnv(path: string): string {
  return `setx OLLAMA_MODELS "${path.replace(/"/g, '\\"')}"`;
}
