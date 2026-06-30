export function getApiErrorMessage(error: unknown, fallback = "An error occurred."): string {
  if (!error || typeof error !== "object") {
    return fallback;
  }

  const data = (error as { data?: unknown }).data;
  if (data && typeof data === "object") {
    const apiError = (data as { error?: unknown }).error;
    if (apiError && typeof apiError === "object") {
      const message = (apiError as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}
