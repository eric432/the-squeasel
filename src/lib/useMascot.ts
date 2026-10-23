import { useCallback, useEffect, useRef, useState } from "react";

export type MascotPhase = "fat" | "squeezing" | "skinny";

const LINES = [
  "I've been working out!",
  "Beach body ready!",
  "Check out these abs!",
  "Same pixels, less me!",
  "Hello, page speed!",
  "My jeans fit again!",
  "Cardio pays off!",
  "Squeezed and pleased!",
  "I can fit in an email now!",
  "Lighter than a GIF!",
  "Who wants a hug? Careful.",
  "Do I look faster?",
];

function nextLine(previous: string): string {
  const choices = LINES.filter((line) => line !== previous);
  const index = Math.floor(Math.random() * choices.length);
  return choices[index] ?? LINES[0];
}

export function useMascot(imageCount: number, weightMb: number) {
  const [phase, setPhase] = useState<MascotPhase>(imageCount > 0 ? "fat" : "skinny");
  const [line, setLine] = useState("");
  const timers = useRef<number[]>([]);
  const lastLine = useRef("");
  const countRef = useRef(imageCount);
  const weightRef = useRef(weightMb);
  const held = useRef<{ count: number; weightMb: number } | null>(null);
  countRef.current = imageCount;
  weightRef.current = weightMb;

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (imageCount <= 0) {
      clearTimers();
      held.current = null;
      setLine("");
      setPhase("skinny");
      return;
    }
    const snapshot = held.current;
    if (snapshot && snapshot.count === imageCount && snapshot.weightMb === weightMb) return;
    clearTimers();
    held.current = null;
    setLine("");
    setPhase("fat");
  }, [imageCount, weightMb, clearTimers]);

  const squeeze = useCallback(() => {
    clearTimers();
    held.current = { count: countRef.current, weightMb: weightRef.current };
    const spoken = nextLine(lastLine.current);
    lastLine.current = spoken;
    setLine("");
    setPhase("squeezing");
    timers.current.push(window.setTimeout(() => setLine(spoken), 620));
    timers.current.push(window.setTimeout(() => setLine(""), 620 + 3600));
    timers.current.push(window.setTimeout(() => setPhase("skinny"), 950));
  }, [clearTimers]);

  return { phase, line, weightMb, squeeze };
}
