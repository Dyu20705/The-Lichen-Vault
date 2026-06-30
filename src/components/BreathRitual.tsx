import React, { useState, useRef, useEffect } from "react";
import { Mic, CheckCircle2, Wind, ShieldAlert } from "lucide-react";
import { BreathRecording } from "../types";

interface BreathRitualProps {
  onCompleted: (recordings: BreathRecording[]) => void;
  onCancel: () => void;
}

export const BreathRitual: React.FC<BreathRitualProps> = ({
  onCompleted,
  onCancel,
}) => {
  const [step, setStep] = useState<number>(0); // 0, 1, 2 representing breaths 1, 2, 3
  const [isPressing, setIsPressing] = useState<boolean>(false);
  const [recordings, setRecordings] = useState<BreathRecording[]>([]);
  const [micAllowed, setMicAllowed] = useState<boolean | null>(null);
  const [micVolume, setMicVolume] = useState<number>(10);

  // Audio Context refs for real Web Audio API exhalation measurement
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  // Keep a mutable ref in sync with isPressing state to bypass React closure limitations
  const isPressingRef = useRef<boolean>(false);

  // Timing state
  const pressStartTimeRef = useRef<number>(0);
  const currentIntensityValuesRef = useRef<number[]>([]);

  // Request Microphone permissions on mount
  useEffect(() => {
    const requestMic = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioCtx;
        
        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;
        
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.4;
        analyserRef.current = analyser;
        
        source.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        dataArrayRef.current = new Uint8Array(bufferLength);
        
        setMicAllowed(true);
      } catch (err) {
        console.warn("Microphone access declined or unavailable:", err);
        setMicAllowed(false); // Fallback to simulated breath
      }
    };

    requestMic();

    return () => {
      // Cleanup audio tracks on unmount
      cleanupAudio();
    };
  }, []);

  const cleanupAudio = () => {
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
    }
  };

  // Track microphone amplitude
  const updateMicLevel = () => {
    if (!analyserRef.current || !dataArrayRef.current || !isPressingRef.current) {
      // Slowly decay if not pressing
      setMicVolume((prev) => Math.max(0, prev - 4));
      return;
    }

    analyserRef.current.getByteFrequencyData(dataArrayRef.current);
    
    // Average the frequencies together to get current raw volume
    let total = 0;
    for (let i = 0; i < dataArrayRef.current.length; i++) {
      total += dataArrayRef.current[i];
    }
    const avgVolume = Math.min(100, Math.round((total / dataArrayRef.current.length) * 0.9));
    
    // Smooth peak values to keep interface looking organic and steady
    const mappedVolume = Math.max(12, avgVolume);
    setMicVolume(mappedVolume);
    currentIntensityValuesRef.current.push(mappedVolume);

    animationFrameIdRef.current = requestAnimationFrame(updateMicLevel);
  };

  const handlePressDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (isPressingRef.current) return;

    // Wake audioContext in case of browser security locks
    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }

    isPressingRef.current = true;
    setIsPressing(true);
    pressStartTimeRef.current = Date.now();
    currentIntensityValuesRef.current = [12]; // Initial base level

    if (micAllowed && analyserRef.current) {
      animationFrameIdRef.current = requestAnimationFrame(updateMicLevel);
    } else {
      // Simulate glowing wave values if mic is not active
      let val = 12;
      const simInterval = setInterval(() => {
        if (!isPressingRef.current) {
          clearInterval(simInterval);
          return;
        }
        val = 25 + Math.round(Math.random() * 55 + Math.sin(Date.now() / 200) * 15);
        setMicVolume(val);
        currentIntensityValuesRef.current.push(val);
      }, 50);
      (handlePressDown as any).simInterval = simInterval;
    }
  };

  const handleRelease = (e: React.MouseEvent | React.TouchEvent | React.FocusEvent) => {
    e.preventDefault();
    if (!isPressingRef.current) return;

    isPressingRef.current = false;
    setIsPressing(false);
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
    }
    if ((handlePressDown as any).simInterval) {
      clearInterval((handlePressDown as any).simInterval);
    }

    const durationMs = Date.now() - pressStartTimeRef.current;
    const durationSec = durationMs / 1000;

    // Gently warn if exhalation is too short to seed organic growth patterns
    if (durationSec < 1.0) {
      setMicVolume(10);
      return;
    }

    // Capture stats
    const list = currentIntensityValuesRef.current;
    const averageIntensity = list.length > 0 ? list.reduce((a, b) => a + b, 0) / list.length : 30;
    
    // Count rhythm spikes (variance spikes)
    let pikes = 0;
    for (let i = 1; i < list.length - 1; i++) {
      if (list[i] > list[i-1] && list[i] > list[i+1] && list[i] > 35) {
        pikes++;
      }
    }

    const newRecord: BreathRecording = {
      duration: Number(durationSec.toFixed(2)),
      intensity: averageIntensity,
      pikes,
      captureMode: micAllowed ? "microphone" : "simulated",
    };

    const updatedRecords = [...recordings, newRecord];
    setRecordings(updatedRecords);
    setMicVolume(10);

    // Proceed to next level or finish capture
    if (step < 2) {
      setStep((prev) => prev + 1);
    } else {
      // All three breaths deposited successfully!
      cleanupAudio();
      onCompleted(updatedRecords);
    }
  };

  return (
    <div
      id="breath_ritual_viewport"
      className="max-w-2xl mx-auto flex flex-col items-center justify-center p-6 sm:p-10 text-center relative"
    >
      {/* Decorative Observatory Coordinates */}
      <div className="absolute top-0 opacity-20 font-sans text-[10px] tracking-[0.25em] text-[#8ba18b] select-none text-center">
        SPECPM DECK-03 COLD ROOM AUDITING // CHAMBER 0.08b
      </div>

      <div className="mb-6">
        <div className="w-16 h-16 rounded-full border border-[#2d4f2d]/40 flex items-center justify-center bg-[#050805]/40 text-[#d4d4c8] glow-green mb-3 mx-auto">
          <Wind className={`w-7 h-7 ${isPressing ? "animate-pulse text-[#ffbf00]" : "text-[#d4d4c8]"}`} />
        </div>
        <h2 className="font-serif text-3xl sm:text-4xl text-[#d4d4c8] tracking-wide font-light">
          Digital Breath Ritual
        </h2>
        <p className="font-serif italic text-[#8ba18b]/80 text-sm mt-1">
          Each specimen uses three distinct breath measurements to seed its procedural form.
        </p>
      </div>

      {/* Progress Spores Indicator */}
      <div className="flex gap-4 mb-10 w-full justify-center max-w-sm">
        {[0, 1, 2].map((idx) => {
          const completed = recordings.length > idx;
          const active = step === idx;
          return (
            <div
              key={idx}
              className={`flex-1 p-3 rounded-lg border flex flex-col items-center transition-all duration-700 ${
                active
                  ? "glass-panel bg-[#ffbf00]/5 border-[#ffbf00]/30 text-[#ffbf00] scale-102"
                  : completed
                  ? "glass-panel bg-[#050805]/40 border-[#2d4f2d]/50 text-[#8ba18b]"
                  : "glass-panel bg-black/10 border-[#2d4f2d]/10 text-[#8ba18b]/30"
              }`}
            >
              <span className="font-sans text-[10px] tracking-wider mb-1">BREATH {idx + 1}</span>
              {completed ? (
                <CheckCircle2 className="w-4 h-4 text-[#ffbf00]" />
              ) : (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    active ? "bg-[#ffbf00] animate-ping" : "bg-[#2d4f2d]/20"
                  }`}
                />
              )}
              {completed && (
                <div className="font-sans text-[9px] text-[#8ba18b] mt-1">
                  {recordings[idx].duration}s exhalation
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Live Wave Visualizer Area */}
      <div className="w-full max-w-md h-32 glass-panel border border-[#2d4f2d]/20 rounded-lg flex items-center justify-center relative overflow-hidden mb-8">
        <div className="absolute inset-0 bg-radial-gradient from-emerald-950/10 via-transparent to-transparent pointer-events-none" />
        
        {/* Horizontal reference line */}
        <div className="absolute left-0 right-0 h-[1px] bg-[#2d4f2d]/30 top-1/2 -translate-y-1/2" />

        {/* Waves responsive to mic amplitude */}
        <div className="absolute flex items-end justify-center gap-[4px] w-full px-12 h-20 bottom-6">
          {Array.from({ length: 15 }).map((_, i) => {
            // Seed spacing
            const factor = Math.sin((i / 14) * Math.PI) * 1.5;
            const volumeHeight = Math.max(2, (micVolume * factor * (isPressing ? 0.9 : 0.1)));
            const delay = i * 0.03;
            
            return (
              <div
                key={i}
                className={`w-[6px] rounded-full transition-all duration-75 ${
                  isPressing ? "bg-[#ffbf00]/75" : "bg-[#2d4f2d]/30"
                }`}
                style={{
                  height: `${volumeHeight}%`,
                  transitionDelay: isPressing ? "0ms" : `${delay}s`,
                  boxShadow: isPressing
                    ? "0 0 10px rgba(255,191,0, 0.4)"
                    : "none",
                }}
              />
            );
          })}
        </div>

        {/* HUD Overlay Label */}
        <div className="absolute bottom-2 left-3 font-sans text-[9px] text-[#8ba18b] opacity-60">
          {isPressing ? "CHAMBER PRESSURE: RESPIRATION INJECTED" : "ATMOSPHERE: CALM & DUSTY"}
        </div>
        <div className="absolute bottom-2 right-3 font-sans text-[9px] text-[#8ba18b] opacity-60">
          {isPressing ? "PRESSURE DETECTED" : "VACUUM STABLE"}
        </div>
      </div>

      {/* Dynamic guidance words based on step */}
      <div className="mb-8 min-h-[4rem]">
        {!isPressing ? (
          <div className="animate-fade-in">
            <p className="font-serif text-lg text-[#ffbf00]/90 italic font-light">
              {step === 0 && '“Take a deep exhalation, press the plate, and let go your breath.”'}
              {step === 1 && '“The soil accepts the spore. Exhale again, slow and deep.”'}
              {step === 2 && '“One third remains. Commit your final breath to the local ledger.”'}
            </p>
            <p className="text-xs text-[#8ba18b] font-sans font-light mt-2">
              (Press and hold the deposition control below for at least 1.5 seconds)
            </p>
          </div>
        ) : (
          <div className="text-[#ffbf00] animate-slow-breathing">
            <span className="font-sans text-sm tracking-widest uppercase">Capturing Derived Breath Metrics...</span>
            <p className="text-xs text-[#ffbf00]/70 font-serif italic mt-1">Keep exhalation sustained.</p>
          </div>
        )}
      </div>

      {/* Large interactive Press-to-Exhale Pad */}
      <button
        id="breath_ritual_capture_pad"
        onMouseDown={handlePressDown}
        onMouseUp={handleRelease}
        onMouseLeave={handleRelease}
        onTouchStart={handlePressDown}
        onTouchEnd={handleRelease}
        className={`w-36 h-36 rounded-full flex flex-col items-center justify-center p-4 border transition-all duration-500 select-none cursor-pointer relative ${
          isPressing
            ? "bg-[#181308] border-[#ffbf00] scale-95 glow-amber text-[#ffbf00] shadow-[inset_0_0_20px_rgba(255,191,0,0.3)]"
            : "glass-panel border-[#ffbf00]/10 text-[#8ba18b] hover:border-[#ffbf00]/30 hover:text-[#ffbf00] hover:scale-103"
        }`}
        style={{ touchAction: "none" }}
      >
        {/* Subtle circular lines */}
        <div className="absolute inset-2 border border-[#8ba18b]/5 rounded-full" />
        <div className={`absolute inset-4 border border-[#8ba18b]/10 rounded-full ${isPressing ? "animate-ping" : ""}`} />
        
        <Mic className={`w-8 h-8 mb-2 transition-transform ${isPressing ? "scale-110" : ""}`} />
        
        <span className="font-sans text-[9px] tracking-widest text-[#8ba18b] uppercase font-semibold">
          {isPressing ? "RETAIN" : "PRESS & HOLD"}
        </span>
        <span className="font-sans text-[9px] tracking-widest text-[#2d4f2d] mt-0.5">
          {isPressing ? "BREATH" : "EXHALATION"}
        </span>
      </button>

      {/* Mic status check indicator */}
      {micAllowed === false && (
        <div className="mt-8 flex items-center gap-2 px-4 py-2 border border-[#ffbf00]/20 bg-white/5 rounded text-[#ffbf00] max-w-sm text-left">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span className="font-mono text-[10px] leading-relaxed">
            Microphone permission declined. The cabinet will use simulated breath metrics to proceed.
          </span>
        </div>
      )}

      {/* Decline deposit / return */}
      <button
        id="breath_ritual_abort_btn"
        onClick={onCancel}
        className="mt-12 font-sans text-[10px] tracking-[0.2em] uppercase text-[#8ba18b]/50 hover:text-[#ffbf00] transition-colors cursor-pointer border-b border-[#2d4f2d]/25 pb-0.5"
      >
        Abort Breath Capture
      </button>
    </div>
  );
};
