import { useCallback, useEffect, useRef, useState } from "react";

export type MascotPhase = "fat" | "squeezing" | "skinny" | "refilling";

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

/** Timings from docs/mascot-2/squeasel-mascot.js */
const T = { bubbleIn: 720, skinny: 1100, bubbleOut: 3800, refill: 850 };

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
  const phaseRef = useRef(phase);
  const countRef = useRef(imageCount);
  const weightRef = useRef(weightMb);
  const held = useRef<{ count: number; weightMb: number } | null>(null);
  phaseRef.current = phase;
  countRef.current = imageCount;
  weightRef.current = weightMb;

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const refill = useCallback(() => {
    if (phaseRef.current !== "skinny") return;
    clearTimers();
    setLine("");
    setPhase("refilling");
    timers.current.push(window.setTimeout(() => setPhase("fat"), T.refill));
  }, [clearTimers]);

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
    if (phaseRef.current === "skinny") {
      setPhase("refilling");
      timers.current.push(window.setTimeout(() => setPhase("fat"), T.refill));
    } else {
      setPhase("fat");
    }
  }, [imageCount, weightMb, clearTimers]);

  const squeeze = useCallback(() => {
    // Allow interrupting a refill so a Squeeze that lands mid-puff still runs.
    if (phaseRef.current !== "fat" && phaseRef.current !== "refilling") return;
    clearTimers();
    held.current = { count: countRef.current, weightMb: weightRef.current };
    const spoken = nextLine(lastLine.current);
    lastLine.current = spoken;
    setLine("");
    setPhase("squeezing");
    timers.current.push(window.setTimeout(() => setLine(spoken), T.bubbleIn));
    timers.current.push(window.setTimeout(() => setPhase("skinny"), T.skinny));
    timers.current.push(window.setTimeout(() => setLine(""), T.bubbleOut));
  }, [clearTimers]);

  return { phase, line, weightMb, squeeze, refill };
}
