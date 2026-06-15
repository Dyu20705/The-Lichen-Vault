import React, { useState, useEffect } from "react";
import { BookOpen, Calendar, Hourglass, ChevronLeft, RefreshCw, Layers, Sparkles } from "lucide-react";
import { LichenOrganism, ArchivalObservation } from "../types";
import { calculateGrowthState, SeededRandom } from "../utils/generator";
import { LichenRenderer } from "./LichenRenderer";

interface VaultCabinetProps {
  organisms: LichenOrganism[];
  onBackToLanding: () => void;
  onUpdateOrganism: (updated: LichenOrganism) => void;
}

export const VaultCabinet: React.FC<VaultCabinetProps> = ({
  organisms,
  onBackToLanding,
  onUpdateOrganism,
}) => {
  const [selectedLichen, setSelectedLichen] = useState<LichenOrganism | null>(null);
  const [isGeneratingMemory, setIsGeneratingMemory] = useState<boolean>(false);
  const [currentAgeStr, setCurrentAgeStr] = useState<string>("");
  const [currentStageLabel, setCurrentStageLabel] = useState<string>("");
  const [viewingMode, setViewingMode] = useState<"containment" | "deposit">("containment");

  // Helper to establish a consistent, physical "Vault Hall" location based on its seed
  const getVaultHall = (seed: number): string => {
    const halls = [
      "Hall of Whispering Volatiles, Shelf 14",
      "Sovereign Crypt, Alcove IX",
      "Forgotten biological archive, Compartment XII",
      "Monastery Cloister, Niche VII",
      "Eastern Herbarium, Drawer 03",
      "Abyssal Conservatory, Tier IV"
    ];
    return halls[seed % halls.length];
  };

  // Helper to get biological custodian notes
  const getCustodianNotes = (seed: number): string => {
    const notes = [
      "Preserved within nitrogen vacuum cylinder #107. Avoid direct solar exposure. Moisten primary membrane with distilled moisture twice per lunar cycle.",
      "Sealed under silica glass at 3.4 Pascals. Exhibits subtle expansion reactions to copper near-frequencies. Keep protective dark shutters closed.",
      "Affixed to a pre-Cambrian basalt fragment. Continuous respiration occurs at sub-audible rhythms. Physical contact is strictly restricted.",
      "Grown in clean quartz atmosphere. Custodian recommends comparing photographic plates during sequential solstice intervals.",
    ];
    return notes[seed % notes.length];
  };

  // Helper to map age to a mystery specimen status
  const getSpecimenStatus = (birthTime: number): string => {
    const ageMs = Date.now() - birthTime;
    if (ageMs < 45000) return "Active mitosis // Volatiles settling";
    if (ageMs < 300000) return "Branching hyphae established // Hermetic isolation complete";
    return "Quiescent suspension // Deep time growth active";
  };

  // Deterministic initial observations so we can show historical book timeline on launch
  const generateInitialObservations = (seed: number, birthTime: number): ArchivalObservation[] => {
    const rand = new SeededRandom(seed);
    const obsGroup1 = [
      "Respiration volatiles captured immediately after the physical exhalation. Condensation on internal glass dome settled within seconds.",
      "The initial respiratory wind was locked into the hermetic grid. Liquid dynamics of the spore show high structural density.",
      "The volatile biological breath has crossed the gate. The core cell remains locked in concentric balance."
    ];
    const obsGroup2 = [
      "A faint expansion has been registered near the lower edge of the thallus. No environmental fluctuations detected inside containment.",
      "The embryonic thallus appears to have anchored securely onto the porous rock medium. Faint gold luminescence is present in darkness.",
      "Observations show complete biological latency. The thallus has grown slightly, branching according to a non-standard Fibonacci sequence."
    ];
    
    return [
      {
        id: `obs_${birthTime}_1`,
        timestamp: birthTime,
        observationNumber: 1,
        text: rand.pick(obsGroup1)
      },
      {
        id: `obs_${birthTime}_2`,
        timestamp: birthTime + 120000, // 2 minutes later
        observationNumber: 2,
        text: rand.pick(obsGroup2)
      }
    ];
  };

  // Tick chronological age of the selected lichen to show deep time growth
  useEffect(() => {
    if (!selectedLichen) return;

    const tickAge = () => {
      const ageMs = Date.now() - selectedLichen.birthTime;
      const totalSec = Math.floor(ageMs / 1000);
      
      const days = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;

      let ageStr = "";
      if (days > 0) ageStr += `${days} days `;
      if (hours > 0 || days > 0) ageStr += `${hours}h `;
      if (mins > 0 || hours > 0 || days > 0) ageStr += `${mins}m `;
      ageStr += `${secs}s`;

      setCurrentAgeStr(ageStr);

      const growth = calculateGrowthState(selectedLichen.birthTime);
      setCurrentStageLabel(growth.stageLabel);
    };

    tickAge();
    const interval = setInterval(tickAge, 1000);
    return () => clearInterval(interval);
  }, [selectedLichen]);

  // Handle setting up initial observations if none exist for a loaded organism
  useEffect(() => {
    if (selectedLichen && (!selectedLichen.observations || selectedLichen.observations.length === 0)) {
      const initialLogs = generateInitialObservations(selectedLichen.seed, selectedLichen.birthTime);
      const updated: LichenOrganism = {
        ...selectedLichen,
        observations: initialLogs,
      };
      onUpdateOrganism(updated);
      setSelectedLichen(updated);
    }
  }, [selectedLichen]);

  // Request a fresh, calm observation log entry from the invisible Archivist narrator
  const drawNewArchivistObservation = async (lichenToUpdate: LichenOrganism) => {
    if (isGeneratingMemory) return;
    setIsGeneratingMemory(true);

    try {
      const res = await fetch("/api/generate-fragment", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           name: lichenToUpdate.name,
           age: currentAgeStr || "0s",
           growthStage: currentStageLabel || "thallus",
         }),
      });

      if (!res.ok) throw new Error("Whisper matrix failed");
      const data = await res.json();
      
      const currentLogs = lichenToUpdate.observations || [];
      const nextNum = currentLogs.length + 1;
      const newObs: ArchivalObservation = {
        id: `obs_${Date.now()}_${nextNum}`,
        timestamp: Date.now(),
        observationNumber: nextNum,
        text: data.fragment,
      };

      const updatedLichen: LichenOrganism = {
        ...lichenToUpdate,
        observations: [...currentLogs, newObs],
      };

      onUpdateOrganism(updatedLichen);
      setSelectedLichen(updatedLichen);
    } catch (err) {
      console.error("Failed to generate archivist observation:", err);
    } finally {
      setIsGeneratingMemory(false);
    }
  };

  const handleSelectLichen = (lichen: LichenOrganism) => {
    setSelectedLichen(lichen);
    setViewingMode("containment");
  };

  const handleDeselect = () => {
    setSelectedLichen(null);
    setCurrentAgeStr("");
  };

  const formatDate = (ms: number): string => {
    const d = new Date(ms);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div id="vault_master_editorial" className="w-full min-h-[500px]">
      {!selectedLichen ? (
        // STATE A: THE VAULT GRID (CABINET CABINETS Drawer)
        <div className="animate-fade-in">
          <div className="flex flex-col sm:flex-row items-center justify-between mb-8 pb-4 border-b border-[#2d4f2d]/30 gap-4">
            <div className="text-center sm:text-left font-serif">
              <h2 className="text-2xl text-[#d4d4c8] tracking-widest font-light flex items-center justify-center sm:justify-start gap-2 uppercase">
                <BookOpen className="w-5 h-5 text-[#8ba18b]" />
                SPECIMEN CATALOGUE // SEC-08
              </h2>
              <p className="italic text-xs text-[#8ba18b] mt-1">
                A total of {organisms.length} vital respirate specimens permanently sealed within vacuum cylinders.
              </p>
            </div>
            <button
              id="cabinet_back_landing_btn"
              onClick={onBackToLanding}
              className="px-6 py-2 rounded-sm border border-[#ffbf00]/20 font-mono text-[10px] uppercase tracking-[0.25em] text-[#d4d4c8] hover:text-[#ffbf00] hover:border-[#ffbf00]/50 transition-all cursor-pointer bg-transparent"
            >
              ← EXHALATION CHAMBER
            </button>
          </div>

          {organisms.length === 0 ? (
            // No organisms deposited yet
            <div className="glass-panel text-center p-12 max-w-md mx-auto my-12 border border-[#2d4f2d]/30">
              <p className="font-serif italic text-lg text-[#ffbf00]/80">
                "The ledger stands empty. No biological breath has crossed this threshold."
              </p>
              <p className="text-xs text-[#8ba18b] font-sans mt-4 leading-relaxed">
                Return to the entrance portal and perform the threefold breath deposit ritual to generate your first procedurally living organism.
              </p>
              <button
                id="empty_vault_begin_btn"
                onClick={onBackToLanding}
                className="mt-6 w-full border border-[#ffbf00]/30 py-3 px-6 text-[11px] uppercase tracking-[0.3em] hover:bg-[#ffbf00]/5 transition-colors duration-300 relative overflow-hidden text-[#ffbf00] cursor-pointer bg-transparent"
              >
                Initiate Core Deposition
              </button>
            </div>
          ) : (
            // Grid cabinet drawer
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {organisms.map((org) => {
                const growth = calculateGrowthState(org.birthTime);
                return (
                  <div
                    key={org.id}
                    id={`cabinet_card_${org.id}`}
                    onClick={() => handleSelectLichen(org)}
                    className="group glass-panel p-5 cursor-pointer hover:border-[#ffbf00]/30 transition-all duration-300 relative overflow-hidden flex flex-col justify-between border border-[#2d4f2d]/20 h-96 shadow-lg shadow-black/60 hover:shadow-[#ffbf00]/5 rounded-xl"
                  >
                    {/* Tiny spore particles background */}
                    <div className="absolute inset-0 bg-radial-gradient from-emerald-950/5 via-transparent to-transparent pointer-events-none" />

                    {/* Miniature glass sphere display */}
                    <div className="w-full h-44 rounded-full border border-[#2d4f2d]/15 bg-black/40 glow-green relative flex items-center justify-center p-2 mb-4 group-hover:border-[#ffbf00]/30 transition-all duration-300">
                      {/* Glass glare effect lines */}
                      <div className="absolute top-2 left-6 right-6 h-[1.5px] bg-gradient-to-r from-transparent via-[#8ba18b]/15 to-transparent rounded-full" />
                      <div className="w-11/12 h-11/12 overflow-hidden rounded-full flex items-center justify-center">
                        <LichenRenderer organism={org} isDetailed={false} />
                      </div>
                    </div>

                    {/* Metadata specs */}
                    <div>
                      <div className="flex justify-between items-start">
                        <h3 className="font-serif text-lg text-[#d4d4c8] group-hover:text-[#ffbf00] transition-colors tracking-wide font-medium italic">
                          {org.name}
                        </h3>
                        <span className="font-sans text-[9px] text-[#8ba18b] tracking-wider uppercase">
                          {org.structure}
                        </span>
                      </div>

                      <div className="font-sans text-[9px] text-[#8ba18b]/70 tracking-wider mt-1.5 flex flex-col gap-1 border-t border-[#2d4f2d]/20 pt-2">
                        <div className="flex justify-between">
                          <span>GERMINATION:</span>
                          <span className="text-[#d4d4c8]">{formatDate(org.birthTime)}</span>
                        </div>
                        <div className="flex justify-between text-[#8ba18b]/50">
                          <span>STAGE:</span>
                          <span className="text-[#ffbf00] font-serif italic text-xs">{growth.stageLabel}</span>
                        </div>
                        <div className="flex justify-between text-[#8ba18b]/50">
                          <span>STATUS:</span>
                          <span className="text-[#d4d4c8] uppercase tracking-wider font-light text-[8px]">Containment Stable</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        // STATE B: PRIMARY ISOLATION CHAMBER (CLOSE INSPECTION VIEW WITH ORIGINAL PHOTO COMPARISON)
        <div className="animate-fade-in grid grid-cols-1 lg:grid-cols-12 gap-8 font-serif">
          
          {/* Header row to return */}
          <div className="col-span-12 flex items-center justify-between pb-4 border-b border-[#2d4f2d]/30">
            <button
              id="inspection_chamber_back_btn"
              onClick={handleDeselect}
              className="flex items-center gap-1.5 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[#8ba18b] hover:text-[#ffbf00] transition-colors border border-[#2d4f2d]/35 hover:border-[#ffbf00]/40 rounded-sm cursor-pointer bg-transparent"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              ← RETURN TO SPECIMEN INDEX
            </button>
            <div className="font-sans text-[10px] tracking-widest text-[#8ba18b] uppercase font-light">
              CONTAINMENT SECTOR // SPECIMEN_{selectedLichen.id.slice(-8).toUpperCase()}
            </div>
          </div>

          {/* Left Column: Isolation Cylinder containing specimen and toggle */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            
            {/* Cylinder Dome wrapper */}
            <div className="w-full aspect-square md:max-w-md mx-auto rounded-full border border-[#d4d4c8]/10 bg-white/5 backdrop-blur-sm p-4 relative flex items-center justify-center glow-amber shadow-[inset_0_0_80px_rgba(255,191,0,0.05)] overflow-hidden">
              <div className="absolute inset-2 border border-[#2d4f2d]/20 rounded-full pointer-events-none" />
              <div className="absolute inset-4 border border-[#ffbf00]/5 rounded-full pointer-events-none" />
              <div className="absolute inset-0 border-[3px] border-[#2d4f2d]/10 rounded-full pointer-events-none animate-spin-slow animate-pulse" />

              <div className="absolute top-[15%] left-[20%] w-32 h-16 bg-white/5 rounded-full blur-md -rotate-44 pointer-events-none"></div>

              <div className="w-full h-full overflow-hidden rounded-full flex items-center justify-center">
                <LichenRenderer 
                  organism={selectedLichen} 
                  isDetailed={true} 
                  isInitialDeposit={viewingMode === "deposit"} 
                />
              </div>
              
              {/* Overlay Label indicating active mode */}
              <div className="absolute bottom-6 bg-black/80 px-3 py-1 border border-[#ffbf00]/25 rounded text-center select-none shadow">
                <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#ffbf00]">
                  {viewingMode === "containment" ? "CELL RADIAL SCOPE" : "GERMINATION SEED LABPLATE"}
                </p>
              </div>
            </div>

            {/* Scientific slider tab options for comparison visualization */}
            <div className="flex border border-[#2d4f2d]/40 rounded-sm overflow-hidden p-0.5 bg-black/60 max-w-sm w-full mx-auto shadow-inner">
              <button
                onClick={() => setViewingMode("containment")}
                className={`flex-1 py-2 text-[9px] uppercase tracking-[0.2em] font-sans transition-all duration-200 cursor-pointer ${
                  viewingMode === "containment"
                    ? "bg-[#ffbf00]/10 text-[#ffbf00] border border-[#ffbf00]/20 font-semibold"
                    : "text-[#8ba18b]/60 hover:text-[#d4d4c8]"
                }`}
              >
                Physical Containment View
              </button>
              <button
                onClick={() => setViewingMode("deposit")}
                className={`flex-1 py-2 text-[9px] uppercase tracking-[0.2em] font-sans transition-all duration-200 cursor-pointer ${
                  viewingMode === "deposit"
                    ? "bg-[#ffbf00]/10 text-[#ffbf00] border border-[#ffbf00]/20 font-semibold"
                    : "text-[#8ba18b]/60 hover:text-[#d4d4c8]"
                }`}
              >
                Deposit Plate Record
              </button>
            </div>

            {/* Atmosphere readings (mystery focus, non-telemetry) */}
            <div className="glass-panel p-4 max-w-md mx-auto w-full border border-[#2d4f2d]/30 flex flex-col gap-2 rounded-lg">
              <div className="flex justify-between items-center text-xs font-sans">
                <span className="text-[#8ba18b]/60 uppercase tracking-widest text-[9px]">CHAMBER HUMIDITY MATRIX</span>
                <span className="text-[#ffbf00] uppercase tracking-wider font-light text-[10px]">Optimal Suspension</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-mono mt-1 text-[#8ba18b]/50 border-t border-[#2d4f2d]/25 pt-2">
                <span>VACUUM PRESSURE SEALS: CONSTANT</span>
                <span>HYPHAE DISCHARGE: INERT</span>
              </div>
            </div>
            
            {/* Contemplative notice of Temporal Distance */}
            <div className="p-4 border border-[#2d4f2d]/25 bg-[#050805]/80 text-[#8ba18b]/80 rounded text-[11px] leading-relaxed italic max-w-md mx-auto text-center font-serif">
              "This specimen requires temporal distance. Sealed securely in quartz, growth responds solely to the slow passage of consecutive sun cycles. Return in future months to compare physical alterations of the thallus. Physical change cannot be forced."
            </div>

          </div>

          {/* Right Column: Museum Archival Cabinet records ledger */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            
            {/* Specimen Ledger Sheet */}
            <div className="glass-panel p-6 border border-[#2d4f2d]/30 relative rounded-xl bg-[#060a06]/40">
              <div className="absolute top-3 right-4 font-serif text-[42px] leading-none opacity-5 italic text-[#8ba18b] select-none font-light uppercase">
                {selectedLichen.structure}
              </div>

              <div className="font-mono text-[9px] text-[#ffbf00] tracking-[0.2em] uppercase mb-1">
                ARCHIVAL ACCESSION ID // {selectedLichen.id.slice(-8).toUpperCase()}
              </div>

              <h3 className="font-serif text-3xl text-[#ffbf00]/90 italic tracking-wide font-light">
                {selectedLichen.name}
              </h3>
              <p className="font-serif italic text-xs text-[#8ba18b] mt-1">
                Lichenized cybernetic thallus grown under cold containment from captured volatile human respiratory traces.
              </p>

              {/* Archival category listings (dashboard sections replaced with museum records) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 border-t border-[#2d4f2d]/30 pt-5">
                
                <div className="flex items-start gap-2.5">
                  <Calendar className="w-4 h-4 text-[#8ba18b]/70 mt-0.5" />
                  <div className="font-sans text-xs">
                    <div className="text-[9px] uppercase tracking-widest text-[#8ba18b]/60 font-medium">Deposit Date</div>
                    <div className="text-[#d4d4c8] font-medium mt-0.5">{formatDate(selectedLichen.birthTime)}</div>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Hourglass className="w-4 h-4 text-[#ffbf00]/70 mt-0.5 animate-pulse" />
                  <div className="font-sans text-xs">
                    <div className="text-[9px] uppercase tracking-widest text-[#8ba18b]/60 font-medium">Accumulated Time-Age</div>
                    <div className="text-[#d4d4c8] font-medium mt-0.5">{currentAgeStr || "Evolving..."}</div>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Layers className="w-4 h-4 text-[#8ba18b]/70 mt-0.5" />
                  <div className="font-sans text-xs">
                    <div className="text-[9px] uppercase tracking-widest text-[#8ba18b]/60 font-medium">Botanical Taxon Stage</div>
                    <div className="text-[#ffbf00] font-serif italic text-xs mt-0.5">{currentStageLabel || "Evolving..."}</div>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <BookOpen className="w-4 h-4 text-[#8ba18b]/70 mt-0.5" />
                  <div className="font-sans text-xs">
                    <div className="text-[9px] uppercase tracking-widest text-[#8ba18b]/60 font-medium">Vault Hall</div>
                    <div className="text-[#d4d4c8] font-medium mt-0.5">{getVaultHall(selectedLichen.seed)}</div>
                  </div>
                </div>

                <div className="col-span-1 md:col-span-2 flex items-start gap-2.5 border-t border-[#2d4f2d]/20 pt-3 mt-1">
                  <div className="font-sans text-xs w-full">
                    <div className="text-[9px] uppercase tracking-widest text-[#8ba18b]/60 font-medium flex justify-between items-center">
                      <span>Specimen Status</span>
                      <span className="w-2 h-2 rounded-full bg-[#ffbf00] animate-ping" />
                    </div>
                    <div className="text-[#ffbf00]/90 font-serif italic text-[11px] mt-1">{getSpecimenStatus(selectedLichen.birthTime)}</div>
                  </div>
                </div>

              </div>

              {/* Custodian Notes section (Replaces procedural telemetry metrics) */}
              <div className="bg-[#050805]/70 border border-[#2d4f2d]/25 rounded p-4 mt-6">
                <h4 className="font-sans text-[10px] tracking-widest text-[#ffbf00]/70 uppercase mb-2">
                  Custodian Notes // Log Section
                </h4>
                <p className="font-serif italic text-xs text-[#8ba18b] leading-relaxed">
                  {getCustodianNotes(selectedLichen.seed)}
                </p>
              </div>

            </div>

            {/* ARCHIVE JOURNAL SECTION */}
            <div className="glass-panel p-6 border border-[#2d4f2d]/30 flex-1 flex flex-col justify-between rounded-xl">
              
              <div>
                <div className="flex items-center justify-between mb-4 border-b border-[#2d4f2d]/30 pb-3">
                  <h4 className="font-serif text-[#d4d4c8] tracking-[0.08em] font-light flex items-center gap-2 uppercase">
                    <Sparkles className="w-4 h-4 text-[#ffbf00] animate-pulse" />
                    Archive Journal // Custodian Observations
                  </h4>
                  <span className="font-sans text-[8px] tracking-[0.2em] text-[#8ba18b]/60 uppercase">CHRONOLOGICAL EXAMINATIONS</span>
                </div>

                {isGeneratingMemory && (!selectedLichen.observations || selectedLichen.observations.length === 0) ? (
                  /* Loading Matrix */
                  <div className="flex flex-col items-center justify-center py-10">
                    <RefreshCw className="w-8 h-8 text-[#ffbf00] animate-spin mb-3" />
                    <p className="font-mono text-[10px] text-[#ffbf00]/80 tracking-widest animate-pulse uppercase">
                      Evoking specimen membrane echo from volatile thallus...
                    </p>
                    <p className="font-serif italic text-[11px] text-[#8ba18b]/50 mt-1 max-w-xs text-center leading-relaxed">
                      Measuring volatile cell division speed, chronicling changes...
                    </p>
                  </div>
                ) : !selectedLichen.observations || selectedLichen.observations.length === 0 ? (
                  /* Empty state */
                  <p className="font-serif italic text-sm text-[#8ba18b]/50 text-center py-8">
                    No logs have been recorded in this ledger yet.
                  </p>
                ) : (
                  /* Chronicled notebook logs from the invisible Archivist */
                  <div className="flex flex-col gap-4 max-h-80 overflow-y-auto pr-2 scrollbar-thin">
                    {[...selectedLichen.observations].reverse().map((obs) => (
                      <div
                        key={obs.id}
                        className={`p-4 rounded border relative bg-[#050805]/75 border-[#2d4f2d]/35 font-serif`}
                      >
                        <div className="flex justify-between items-center text-sans text-[8px] text-[#8ba18b]/60 mb-2 uppercase tracking-wider">
                          <span>Observation Entry #{obs.observationNumber.toString().padStart(2, "0")}</span>
                          <span>Timestamp: {formatDate(obs.timestamp)}</span>
                        </div>
                        
                        <p className="text-[13px] leading-relaxed text-[#d4d4c8]/95 font-serif">
                          {obs.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Request fresh journal log from the Archivist */}
              <div className="mt-6 pt-4 border-t border-[#2d4f2d]/20 flex items-center justify-between gap-4">
                <button
                  id="evoke_specimen_memory_btn"
                  onClick={() => drawNewArchivistObservation(selectedLichen)}
                  disabled={isGeneratingMemory}
                  className="w-full border border-[#ffbf00]/30 py-4 px-6 text-[11px] uppercase tracking-[0.3em] text-[#ffbf00] hover:bg-[#ffbf00]/5 hover:border-[#ffbf00]/50 transition-colors duration-300 group relative overflow-hidden disabled:opacity-40 select-none cursor-pointer bg-transparent"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {isGeneratingMemory && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    {isGeneratingMemory ? "Writing Observation note..." : "Request Archivist Observation Note"}
                  </span>
                  <div className="absolute inset-0 bg-[#ffbf00]/5 translate-y-full group-hover:translate-y-0 transition-transform duration-500 font-sans"></div>
                </button>
              </div>

            </div>

          </div>

        </div>
      )}
    </div>
  );
};
