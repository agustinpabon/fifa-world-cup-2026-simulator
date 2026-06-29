import { useEffect } from "react";

export function useEnforceDarkMode() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
}
