export function formatOllamaError(status: number, responseText: string): Error {
  if (status === 403) {
    return new Error(
      "Ollama отклонила Origin приложения. Перезапусти Ollama после настройки OLLAMA_ORIGINS.",
    );
  }

  const detail = responseText.trim()
    ? ` ${responseText.slice(0, 300)}`
    : "";

  if (/failed to load model|llama-server process has terminated/i.test(responseText)) {
    return new Error(
      `Ollama не смогла загрузить модель. Проверь папку моделей в настройках Ari и перезапусти Ollama.${detail}`,
    );
  }

  return new Error(`Ollama вернула HTTP ${status}.${detail}`);
}
