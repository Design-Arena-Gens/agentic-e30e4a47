"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type RecognitionAlternative = {
  transcript?: string;
};

type RecognitionResult = {
  isFinal: boolean;
  [index: number]: RecognitionAlternative | undefined;
};

type RecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: RecognitionResult | undefined;
  };
};

type RecognitionInstance = {
  start: () => void;
  stop: () => void;
  abort?: () => void;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
};

type RecognitionConstructor = new () => RecognitionInstance;

declare global {
  interface Window {
    webkitSpeechRecognition?: RecognitionConstructor;
    SpeechRecognition?: RecognitionConstructor;
  }
}

type TranscriptSegment = {
  id: string;
  text: string;
  timestamp: number;
};

type Insight = {
  id: string;
  label: string;
  detail: string;
  pulse: number;
  delta: number;
};

type Analysis = {
  keywords: string[];
  sentiment: number;
  energy: number;
  clusters: {
    label: string;
    score: number;
    summary: string;
  }[];
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "that",
  "have",
  "this",
  "with",
  "from",
  "your",
  "about",
  "there",
  "what",
  "when",
  "will",
  "would",
  "could",
  "should",
  "which",
  "into",
  "over",
  "under",
  "while",
  "where",
  "been",
  "were",
  "them",
  "they",
  "then",
  "than",
  "just",
  "like",
  "really",
  "maybe",
  "know",
  "want",
  "need",
  "please",
]);

const POSITIVE_TERMS = [
  "great",
  "good",
  "awesome",
  "excited",
  "optimistic",
  "love",
  "amazing",
  "win",
  "growth",
  "positive",
  "up",
  "better",
  "improve",
  "success",
  "increase",
];

const NEGATIVE_TERMS = [
  "bad",
  "problem",
  "issue",
  "concern",
  "stuck",
  "risk",
  "down",
  "decline",
  "worse",
  "fail",
  "fear",
  "uncertain",
  "hard",
  "difficult",
];

const BASE_INSIGHTS: Insight[] = [
  {
    id: "baseline-velocity",
    label: "Signal Velocity",
    detail: "Live trendline for how quickly the conversation is evolving.",
    pulse: 0.48,
    delta: 0.06,
  },
  {
    id: "baseline-composure",
    label: "Agent Composure",
    detail: "Ambient calm from the voice agent's prosodic fingerprint.",
    pulse: 0.62,
    delta: -0.04,
  },
  {
    id: "baseline-focus",
    label: "Focus Field",
    detail: "Dominant node describing the most coherent cluster in view.",
    pulse: 0.55,
    delta: 0.08,
  },
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const capitalize = (input: string) =>
  input.charAt(0).toUpperCase() + input.slice(1);

const analyzeText = (content: string): Analysis => {
  const clean = content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && token.length > 2 && !STOP_WORDS.has(token));

  if (!clean.length) {
    return {
      keywords: [],
      sentiment: 0,
      energy: 0,
      clusters: [],
    };
  }

  const frequency = new Map<string, number>();
  clean.forEach((token) => {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  });

  const keywords = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([token]) => token);

  const positiveHits = clean.filter((token) =>
    POSITIVE_TERMS.includes(token),
  ).length;
  const negativeHits = clean.filter((token) =>
    NEGATIVE_TERMS.includes(token),
  ).length;
  const sentiment = clamp(
    (positiveHits - negativeHits) / Math.max(clean.length, 4),
    -1,
    1,
  );

  const energy = clamp(
    clean.length / 45 + Math.abs(sentiment) * 0.45,
    0,
    1,
  );

  const clusters = keywords.slice(0, 3).map((keyword) => {
    const scoreSeed =
      (frequency.get(keyword) ?? 1) / Math.max(clean.length, 1);
    const score = clamp(scoreSeed * 2 + energy * 0.6, 0, 1);
    return {
      label: capitalize(keyword),
      score,
      summary: `Emerging signal around “${keyword}” with ${Math.round(score * 100)}% clarity.`,
    };
  });

  return {
    keywords,
    sentiment,
    energy,
    clusters,
  };
};

const generateAgentReply = (latestChunk: string, analysis: Analysis) => {
  if (!latestChunk.trim()) {
    return "Ready when you are. Share your thought and I will map the field in real-time.";
  }

  const tone =
    analysis.sentiment > 0.2
      ? "Uplifted"
      : analysis.sentiment < -0.2
        ? "Cautious"
        : "Neutral";

  const headline = analysis.keywords.slice(0, 2).map(capitalize).join(" · ");
  const trendDirection =
    analysis.sentiment > 0.15
      ? "momentum is tilting upward"
      : analysis.sentiment < -0.15
        ? "momentum is cooling down"
        : "signal is steady";

  const closing =
    analysis.energy > 0.7
      ? "Let's chase that spike before it dissipates."
      : analysis.energy < 0.3
        ? "We can probe deeper if you want to expand the field."
        : "I'm maintaining orbit. Drop another detail when ready.";

  return `${tone} Grok vector locked. ${headline || "Listening"} indicates ${trendDirection}. ${closing}`;
};

const buildInsights = (analysis: Analysis): Insight[] => {
  if (!analysis.keywords.length) {
    return BASE_INSIGHTS;
  }

  const dynamic = analysis.clusters.map((cluster, index) => ({
    id: `cluster-${cluster.label.toLowerCase()}`,
    label: `${cluster.label} Signal`,
    detail: cluster.summary,
    pulse: clamp(0.35 + cluster.score * 0.55 + index * 0.1, 0.2, 0.95),
    delta: clamp(
      analysis.sentiment * 0.6 + cluster.score * 0.3 - index * 0.05,
      -0.4,
      0.4,
    ),
  }));

  return [...dynamic, ...BASE_INSIGHTS].slice(0, 5);
};

const getRecognitionConstructor = (): RecognitionConstructor | null => {
  if (typeof window === "undefined") return null;
  const constructor =
    window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
  return constructor ?? null;
};

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));

export default function Home() {
  const [transcript, setTranscript] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [compiledText, setCompiledText] = useState("");
  const [agentReply, setAgentReply] = useState(
    "Open mic. Speak your idea and I'll plot the Grok visual in real-time.",
  );
  const [isListening, setIsListening] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(() => Date.now());
  const [manualInput, setManualInput] = useState("");
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const interimRef = useRef("");

  const speechSupported = useMemo(() => getRecognitionConstructor() !== null, []);

  const analysis = useMemo(() => analyzeText(compiledText), [compiledText]);
  const insights = useMemo(() => buildInsights(analysis), [analysis]);

  const processChunk = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    setSegments((prev) => {
      const next = [
        ...prev,
        {
          id: `${Date.now()}-${prev.length}`,
          text: trimmed,
          timestamp: Date.now(),
        },
      ];
      return next.slice(-6);
    });

    setCompiledText((prev) => {
      const next = prev ? `${prev} ${trimmed}` : trimmed;
      const computed = analyzeText(next);
      setAgentReply(generateAgentReply(trimmed, computed));
      return next;
    });

    setLastUpdate(Date.now());
    setTranscript("");
    interimRef.current = "";
  }, []);

  useEffect(() => {
    const RecognitionConstructor = getRecognitionConstructor();
    if (!RecognitionConstructor) return;
    if (recognitionRef.current) return;

    const recognition = new RecognitionConstructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let liveTranscript = "";

      const { results } = event;
      for (let i = event.resultIndex; i < results.length; i += 1) {
        const result = results[i];
        if (!result) continue;

        const textFragment = result[0]?.transcript ?? "";
        if (!textFragment) continue;

        if (result.isFinal) {
          processChunk(textFragment);
        } else {
          liveTranscript += textFragment;
        }
      }

      interimRef.current = liveTranscript;
      setTranscript(liveTranscript);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  }, [processChunk]);

  const beginListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.start();
      setIsListening(true);
      setAgentReply("Streaming... anchoring the Grok visual to your voice signal.");
    } catch {
      // Swallow duplicate start errors silently.
    }
  }, []);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.stop();
    setIsListening(false);
    setAgentReply(
      "Mic paused. Drop another thought or type it in to extend the Grok visual.",
    );
  }, []);

  const handleManualSubmit = useCallback(() => {
    if (!manualInput.trim()) return;
    processChunk(manualInput);
    setManualInput("");
  }, [manualInput, processChunk]);

  const momentumVariance = useMemo(() => {
    const base = analysis.energy * 0.45 + Math.abs(analysis.sentiment) * 0.35;
    return clamp(base, 0.2, 0.9);
  }, [analysis.energy, analysis.sentiment]);

  const listeningState = isListening
    ? "Listening"
    : transcript
      ? "Processing"
      : "Idle";

  return (
    <div className="relative min-h-screen w-full overflow-hidden text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-40 backdrop-grid" />
      <div className="absolute inset-0 -z-20 bg-gradient-to-b from-slate-950/80 via-slate-950/20 to-slate-950/90" />

      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-5 pb-16 pt-14 lg:flex-row lg:gap-16 lg:px-10 lg:pt-20">
        <section className="flex flex-1 flex-col gap-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/60 px-4 py-2 text-sm font-medium text-emerald-300 ring-1 ring-emerald-400/20">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-300" />
              Grok Ambient Voice Agent
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-50 sm:text-5xl">
              Voice into {" "}
              <span className="bg-gradient-to-r from-emerald-300 via-sky-300 to-indigo-400 bg-clip-text text-transparent">
                Grok Visual
              </span>
            </h1>
            <p className="max-w-2xl text-lg leading-7 text-slate-300/80">
              Speak your prompt. Watch the Grok field animate with live sentiment, focus,
              and momentum arcs as the voice agent parses every fragment.
            </p>
          </div>

          <div className="flex flex-col gap-6 rounded-3xl bg-white/5 p-6 backdrop-blur-xl ring-1 ring-white/10 md:flex-row">
            <div className="flex flex-1 flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/60`}
                  >
                    <span
                      className={`absolute inset-1 rounded-2xl ${
                        isListening
                          ? "bg-gradient-to-br from-emerald-500/70 via-sky-500/70 to-indigo-500/70 animate-pulse-soft"
                          : "bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950"
                      }`}
                    />
                    <span className="relative text-sm font-semibold tracking-wide text-white/90">
                      {listeningState}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-400">
                      Voice Control
                    </p>
                    <p className="text-base text-slate-200">
                      Updated {formatTime(lastUpdate)}
                    </p>
                  </div>
                </div>
                {speechSupported ? (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={beginListening}
                      disabled={isListening}
                      className="rounded-full bg-emerald-400/90 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-400/40"
                    >
                      Tap to Capture
                    </button>
                    <button
                      onClick={stopListening}
                      disabled={!isListening}
                      className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/40"
                    >
                      Hold Orbit
                    </button>
                  </div>
                ) : (
                  <span className="rounded-full border border-emerald-400/40 px-4 py-2 text-sm text-emerald-200/80">
                    Browser mic API unavailable — type below to simulate.
                  </span>
                )}
              </div>

              <div className="rounded-2xl border border-white/5 bg-slate-950/60 p-6 text-slate-200 shadow-xl shadow-black/20">
                <p className="text-sm uppercase tracking-[0.4em] text-slate-400">
                  Mic Stream
                </p>
                <p className="mt-3 text-lg leading-7 text-slate-100/90">
                  {transcript
                    ? transcript
                    : segments.length
                      ? segments[segments.length - 1]?.text
                      : "Standing by. Your audio stream routes here for instant Grok synthesis."}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-white/5 p-6 backdrop-blur-xl ring-1 ring-white/10">
            <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-400">
              Agent Response
            </p>
            <p className="mt-3 text-lg text-slate-100/90">{agentReply}</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                  Momentum
                </p>
                <div className="mt-3 flex items-end gap-3">
                  <div className="h-16 w-16 rounded-full border border-emerald-400/30 bg-emerald-500/20 p-4">
                    <div
                      className="h-full w-full rounded-full bg-gradient-to-br from-emerald-300 via-sky-300 to-indigo-400"
                      style={{
                        opacity: clamp(analysis.energy + 0.25, 0.25, 1),
                      }}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-sm text-slate-300">
                      <span>Energy</span>
                      <span>{Math.round(analysis.energy * 100)}%</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-indigo-400"
                        style={{ width: `${Math.round(Math.max(analysis.energy, 0.05) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                  Sentiment Drift
                </p>
                <div className="mt-3 flex items-end gap-3">
                  <div className="relative h-16 w-16">
                    <div className="absolute inset-0 rounded-full bg-slate-900" />
                    <div
                      className={`absolute inset-[6px] rounded-full ${
                        analysis.sentiment >= 0
                          ? "bg-gradient-to-br from-emerald-400 via-sky-400 to-indigo-400"
                          : "bg-gradient-to-br from-rose-400 via-orange-400 to-amber-400"
                      } opacity-75`}
                      style={{
                        clipPath:
                          analysis.sentiment >= 0
                            ? `inset(${Math.round((1 - analysis.sentiment) * 40)}% 0 0 0)`
                            : `inset(0 0 ${Math.round((1 + analysis.sentiment) * 40)}% 0)`,
                      }}
                    />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-slate-100">
                      {analysis.sentiment > 0.15
                        ? "Positive"
                        : analysis.sentiment < -0.15
                          ? "Negative"
                          : "Neutral"}
                    </p>
                    <p className="text-sm text-slate-400">
                      {Math.round(analysis.sentiment * 100)} sentiment index
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                Trending Topics
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(analysis.keywords.length
                  ? analysis.keywords
                  : ["voice graph", "agent choreography", "signal lattice", "grok overlay"]
                ).map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-slate-100 shadow-inner shadow-white/5"
                  >
                    #{keyword}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-slate-950/70 p-6 backdrop-blur-xl ring-1 ring-white/5">
            <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-400">
              Transcript Trail
            </p>
            <div className="mt-4 space-y-4">
              {segments.length ? (
                segments
                  .slice()
                  .reverse()
                  .map((segment) => (
                    <div
                      key={segment.id}
                      className="rounded-2xl border border-white/10 bg-white/5 p-4 text-slate-100"
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>Voice capture</span>
                        <span>{formatTime(segment.timestamp)}</span>
                      </div>
                      <p className="mt-2 text-base leading-6 text-slate-100/90">
                        {segment.text}
                      </p>
                    </div>
                  ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-6 text-slate-400">
                  No segments yet. Start speaking or type a scenario to drive the Grok visual.
                </div>
              )}
            </div>

            <div className="mt-6 space-y-3">
              <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                Manual Prompt (quick simulation)
              </label>
              <textarea
                value={manualInput}
                onChange={(event) => setManualInput(event.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-sm text-slate-100 shadow-inner shadow-black/40 focus:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                placeholder="Type a scenario if you can't use voice input..."
              />
              <button
                onClick={handleManualSubmit}
                className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-indigo-400 px-5 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:from-emerald-300 hover:via-sky-300 hover:to-indigo-300"
              >
                Inject into Grok Visual
              </button>
            </div>
          </div>
        </section>

        <aside className="flex w-full flex-col gap-6 rounded-[32px] border border-white/10 bg-white/8 p-8 shadow-2xl shadow-sky-900/30 backdrop-blur-[28px] lg:max-w-md">
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <p className="text-sm uppercase tracking-[0.4em] text-slate-200/80">
                Grok Visual
              </p>
              <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-semibold text-emerald-200">
                Real-time render
              </span>
            </div>
            <div className="relative mx-auto h-80 w-80">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400/15 via-sky-400/10 to-indigo-500/20 blur-3xl" />
              <div className="absolute inset-[12%] rounded-full border border-white/10 bg-slate-950/60 backdrop-blur-xl">
                <div className="absolute inset-6 rounded-full border border-slate-700/40" />
                <div
                  className="absolute inset-0 animate-spin-slower"
                  style={{ animationDuration: `${18 - momentumVariance * 6}s` }}
                >
                  <div className="absolute inset-[18%] rounded-full border border-white/5" />
                  <div className="absolute inset-[34%] rounded-full border border-white/10" />
                </div>
                <div className="absolute inset-0 animate-orbit">
                  {insights.slice(0, 3).map((insight, index) => (
                    <div
                      key={insight.id}
                      className="absolute flex w-[120px] -translate-y-1/2 items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-xs text-slate-200 shadow-lg shadow-black/40"
                      style={{
                        top: `${32 + index * 22}%`,
                        left: index === 0 ? "-8%" : index === 1 ? "70%" : "-4%",
                        transform: `rotate(${index === 1 ? "6" : "-5"}deg)`,
                      }}
                    >
                      <span
                        className="h-2 w-2 rounded-full bg-gradient-to-br from-emerald-400 via-sky-400 to-indigo-400"
                        style={{ opacity: clamp(insight.pulse + 0.2, 0.4, 1) }}
                      />
                      <div>
                        <p className="font-semibold text-white/90">
                          {insight.label}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {Math.round(insight.pulse * 100)} pulse
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="absolute inset-[28%] rounded-full border border-white/5">
                  <div className="relative h-full w-full">
                    <div
                      className="absolute inset-4 rounded-full bg-gradient-to-br from-emerald-300/30 via-sky-300/20 to-indigo-400/25 blur-2xl"
                      style={{ opacity: clamp(momentumVariance + 0.3, 0.4, 0.9) }}
                    />
                    <div className="absolute inset-6 rounded-full border border-white/10 bg-slate-950/80 p-6">
                      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
                          Core Vector
                        </p>
                        <p className="text-lg font-semibold text-slate-100">
                          {analysis.keywords[0]
                            ? capitalize(analysis.keywords[0])
                            : "Awaiting Signal"}
                        </p>
                        <p className="text-sm text-slate-400">
                          {Math.round(momentumVariance * 100)}% coherence
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {insights.map((insight) => (
              <div
                key={insight.id}
                className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-200 shadow-lg shadow-black/30"
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-slate-100">{insight.label}</p>
                  <span
                    className={`text-xs font-semibold ${
                      insight.delta > 0
                        ? "text-emerald-300"
                        : insight.delta < 0
                          ? "text-rose-300"
                          : "text-slate-300"
                    }`}
                  >
                    {insight.delta > 0 ? "+" : ""}
                    {Math.round(insight.delta * 100)} drift
                  </span>
                </div>
                <p className="mt-2 text-slate-300/90">{insight.detail}</p>
                <div className="mt-3 h-2 rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-indigo-400"
                    style={{ width: `${Math.round(insight.pulse * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
