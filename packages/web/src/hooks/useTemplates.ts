import { useState, useEffect } from "react";
import { fetchTemplates, type TemplateEntry } from "../api";

export function useTemplates() {
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplates()
      .then((res) => setTemplates(res.templates))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { templates, loading, error };
}
