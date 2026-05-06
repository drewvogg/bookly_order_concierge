import { ConciergeApp } from "@/components/ConciergeApp";

export default function Home() {
  const initialMode = process.env.LLM_MODE === "live" ? "live" : "demo";
  return <ConciergeApp initialMode={initialMode} />;
}
