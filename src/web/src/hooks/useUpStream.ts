import { useState, useCallback } from "react";
import { streamUp, type UpEvent } from "../api";

export type UpState = "idle" | "streaming" | "done" | "error";

export function useUpStream() {
  const [events, setEvents] = useState<UpEvent[]>([]);
  const [state, setState] = useState<UpState>("idle");
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (template: string, workspace: string) => {
    setEvents([]);
    setState("streaming");
    setError(null);

    try {
      for await (const event of streamUp(template, workspace)) {
        setEvents((prev) => [...prev, event]);

        if (event.stage === "error") {
          setState("error");
          setError(event.message);
          return;
        }

        if (event.stage === "done") {
          setState("done");
          return;
        }
      }
    } catch (err: any) {
      setState("error");
      setError(err.message);
    }
  }, []);

  const reset = useCallback(() => {
    setEvents([]);
    setState("idle");
    setError(null);
  }, []);

  return { events, state, error, start, reset };
}
